"""JSON-RPC 2.0 over stdin/stdout, one JSON object per line.

One asyncio loop reads the lines and runs every request as its own task, so a run in progress or a slow method
(cloning, listing models) never holds up another. Blocking handlers run in a thread. Everything that reaches stdout
is written on the loop's thread, one line at a time; logs go to stderr.
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
import threading
import traceback
from collections.abc import AsyncIterator, Callable
from typing import Any, TextIO

from pydantic import ValidationError

from alpine_protocol import METHODS, ChatGPTSignInFinishedParams, ErrorObject, Request, Response, SessionEventParams

from .chatgpt import ChatGPTSignIns
from .methods import HANDLERS, INVALID_PARAMS, MethodError
from .sessions import SessionManager

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603

Write = Callable[[str], None]


class _Failure(Exception):
    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.error = ErrorObject(code=code, message=message, data=data)


class Server:
    """Answers requests and sends notifications (session events, the end of a sign-in) through ``write``, which
    takes one finished line."""

    def __init__(
        self, write: Write, manager: SessionManager | None = None, sign_ins: ChatGPTSignIns | None = None
    ) -> None:
        self._write = write
        self.sessions = manager or SessionManager(self._send_event)
        self.sign_ins = sign_ins or ChatGPTSignIns(self._send_sign_in_finished)
        self._async_handlers = self.sessions.handlers() | self.sign_ins.handlers()

    def _send_event(self, params: SessionEventParams) -> None:
        self._notify("session/event", params)

    def _send_sign_in_finished(self, params: ChatGPTSignInFinishedParams) -> None:
        self._notify("chatgpt/signInFinished", params)

    def _notify(self, method: str, params: Any) -> None:
        message = {"jsonrpc": "2.0", "method": method, "params": params.model_dump(by_alias=True, mode="json")}
        self._write(json.dumps(message) + "\n")

    async def handle_line(self, line: str) -> None:
        """Answers one request line."""
        response = await self._respond(line)
        if response is not None:
            self._write(response.model_dump_json(by_alias=True, exclude_none=True) + "\n")

    async def _respond(self, line: str) -> Response | None:
        try:
            data = json.loads(line)
        except json.JSONDecodeError as exc:
            return Response(id=None, error=ErrorObject(code=PARSE_ERROR, message=str(exc)))
        try:
            request = Request.model_validate(data)
        except ValidationError as exc:
            request_id = data.get("id") if isinstance(data, dict) else None
            return Response(id=request_id, error=ErrorObject(code=INVALID_REQUEST, message=str(exc)))
        try:
            result = await self._call(request)
        except _Failure as failure:
            response = Response(id=request.id, error=failure.error)
        else:
            response = Response(id=request.id, result=result)
        return None if request.id is None else response

    async def _call(self, request: Request) -> Any:
        """Runs the method and returns its result as JSON data.

        Raises:
            _Failure: With the error object to send back.
        """
        method = request.method
        sync = HANDLERS.get(method)
        handler = self._async_handlers.get(method)
        if sync is None and handler is None:
            raise _Failure(METHOD_NOT_FOUND, f"Unknown method: {method}")
        params_model, _ = METHODS[method]
        try:
            params = params_model.model_validate(request.params or {})
        except ValidationError as e:
            raise _Failure(INVALID_PARAMS, str(e)) from e
        try:
            result = await handler(params) if handler is not None else await asyncio.to_thread(sync, params)
        except MethodError as e:
            raise _Failure(e.code, str(e), e.data.model_dump(by_alias=True) if e.data else None) from e
        except Exception as e:
            # A bug in one method must not end the server, which every window shares.
            traceback.print_exc(file=sys.stderr)
            raise _Failure(INTERNAL_ERROR, f"{type(e).__name__}: {e}") from e
        return result.model_dump(by_alias=True, mode="json")

    async def close(self) -> None:
        """Stops running sessions so they are saved ending in ``run_stopped: interrupted``, and waiting sign-ins."""
        await self.sign_ins.shutdown()
        await self.sessions.shutdown()


async def serve_async(lines: AsyncIterator[str], write: Write, manager: SessionManager | None = None) -> None:
    """Handles every line as its own task until ``lines`` ends, then finishes them and closes the server."""
    server = Server(write, manager)
    tasks: set[asyncio.Task[None]] = set()
    _close_on_signals(asyncio.current_task())
    try:
        async for line in lines:
            if line.strip():
                task = asyncio.create_task(server.handle_line(line))
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        if tasks:
            await asyncio.gather(*tasks)
    except asyncio.CancelledError:  # SIGTERM or SIGINT: the app is quitting
        for task in tasks:
            task.cancel()
    await server.close()


def _close_on_signals(main: asyncio.Task[Any] | None) -> None:
    """SIGTERM and SIGINT end the server the way a closed stdin does, so running sessions are saved as interrupted.
    A second signal while closing is ignored."""
    if main is None:
        return
    loop = asyncio.get_running_loop()
    signals = (signal.SIGTERM, signal.SIGINT)

    def stop() -> None:
        main.cancel()

    for sig in signals:
        try:
            loop.add_signal_handler(sig, stop)
        except (NotImplementedError, RuntimeError, ValueError):  # not the main thread, or a platform without them
            pass


async def read_lines(stdin: TextIO) -> AsyncIterator[str]:
    """The lines of ``stdin``, read on a thread so the loop never blocks on it."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    def read() -> None:
        try:
            for line in stdin:
                loop.call_soon_threadsafe(queue.put_nowait, line)
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=read, name="alpine-stdin", daemon=True).start()
    while (line := await queue.get()) is not None:
        yield line


def serve(stdin: TextIO, stdout: TextIO) -> None:
    def write(text: str) -> None:
        stdout.write(text)
        stdout.flush()

    asyncio.run(serve_async(read_lines(stdin), write))


def main() -> None:
    # Whatever else writes to fd 1 (a library, a child process) must not corrupt the protocol: keep the real stdout
    # for ourselves and point fd 1 at stderr.
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    serve(sys.stdin, protocol)
