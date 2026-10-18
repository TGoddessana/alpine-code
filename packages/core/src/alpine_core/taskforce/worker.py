"""Runs one TF script inside the sandbox. Standard library only: it is started with
``python -s -S -B -P`` and nothing but ``sandbox.ENV`` in its environment.

The first line on stdin is ``{"script": ..., "args": ...}``. Every request to Alpine is one JSON line on stdout with
an ``id``; Alpine answers each with one line on stdin carrying the same ``id``. ``agent()`` is such a request: the
real agent runs in Alpine, under the session's permissions, never here. The script ends with ``{"op": "done"}`` or
``{"op": "error"}``.

The script gets these names, nothing to import:

- ``await agent(prompt, agent=None, model=None, tools=None, returns=None, label=None, phase=None)``: the answer, the
  parsed JSON with ``returns``, or ``None`` when the agent failed or was stopped. ``phase`` is the step it counts in
  (default: the latest ``phase()``). Once the user stopped the whole TF it raises ``Stopped`` instead, which ends
  the script.
- ``await parallel(awaitables)``: their results, in order.
- ``await pipeline(items, *stages)``: each item through the stages in turn (``await stage(value)``), items at once.
- ``phase(title)``: the step the next agents belong to (조사, 작성, 검토...).
- ``log(text)``: one line for the user; ``print`` does the same.
- ``budget()``: how many more agents the plan allows.
- ``args``: what the call passed.
- ``result = ...``: what the session's model gets when the script ends.
"""

from __future__ import annotations

import ast
import asyncio
import json
import sys
import threading
import traceback
from typing import Any


class Stopped(BaseException):
    """The user stopped the TF: the script ends where it is (a ``BaseException``, so ``except Exception`` in a script
    does not keep it going)."""


class _Channel:
    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._next = 0
        self._waiting: dict[int, asyncio.Future[Any]] = {}
        self.remaining = 0
        self._lock = threading.Lock()

    def send(self, message: dict[str, Any]) -> None:
        line = json.dumps(message, ensure_ascii=False)
        with self._lock:
            sys.stdout.write(line + "\n")
            sys.stdout.flush()

    async def ask(self, message: dict[str, Any]) -> Any:
        self._next += 1
        future: asyncio.Future[Any] = self._loop.create_future()
        self._waiting[self._next] = future
        self.send({"id": self._next, **message})
        return await future

    def listen(self) -> None:
        """Reads Alpine's answers on a thread of its own and hands them to the loop."""
        for line in sys.stdin:
            try:
                answer = json.loads(line)
            except ValueError:
                continue
            self._loop.call_soon_threadsafe(self._answer, answer)

    def _answer(self, answer: dict[str, Any]) -> None:
        if "remaining" in answer:
            self.remaining = int(answer["remaining"])
        future = self._waiting.pop(answer.get("id", -1), None)
        if future is None or future.done():
            return
        if answer.get("stopped"):
            future.set_exception(Stopped("The user stopped the TF"))
        else:
            future.set_result(answer.get("value"))


def _api(channel: _Channel, args: Any) -> dict[str, Any]:
    async def agent(
        prompt: str,
        *,
        agent: str | None = None,
        model: str | None = None,
        tools: list[str] | None = None,
        returns: Any = None,
        label: str | None = None,
        phase: str | None = None,
    ) -> Any:
        if not isinstance(prompt, str) or not prompt.strip():
            raise TypeError("agent() needs a prompt: what this agent should do, with everything it needs to know")
        request = {
            "op": "agent",
            "prompt": prompt,
            "agent": agent,
            "model": model,
            "tools": list(tools) if tools is not None else None,
            "returns": returns,
            "label": label,
            "phase": phase,
        }
        return await channel.ask(request)

    async def parallel(items: Any) -> list[Any]:
        return list(await asyncio.gather(*(item() if callable(item) else item for item in items)))

    async def pipeline(items: Any, *stages: Any) -> list[Any]:
        async def through(value: Any) -> Any:
            for stage in stages:
                value = await stage(value)
            return value

        return list(await asyncio.gather(*(through(item) for item in items)))

    def phase(title: str) -> None:
        channel.send({"op": "phase", "title": str(title)})

    def log(text: Any) -> None:
        channel.send({"op": "log", "text": str(text)})

    def show(*values: Any, **_: Any) -> None:
        """``print`` would break the lines to Alpine: what a script prints is a ``log`` line."""
        log(" ".join(str(value) for value in values))

    def budget() -> int:
        return channel.remaining

    return {
        "agent": agent,
        "parallel": parallel,
        "pipeline": pipeline,
        "phase": phase,
        "log": log,
        "print": show,
        "budget": budget,
        "args": args,
    }


def _plain(result: Any) -> Any:
    try:
        json.dumps(result)
    except (TypeError, ValueError):
        return repr(result)
    return result


def main() -> None:
    start = json.loads(sys.stdin.readline())
    loop = asyncio.new_event_loop()
    channel = _Channel(loop)
    channel.remaining = int(start.get("remaining", 0))
    threading.Thread(target=channel.listen, daemon=True).start()
    scope: dict[str, Any] = {"__name__": "__taskforce__", **_api(channel, start.get("args"))}
    try:
        code = compile(start["script"], "<script>", "exec", flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
        outcome = eval(code, scope)  # a coroutine when the script awaits at the top level
        if asyncio.iscoroutine(outcome):
            loop.run_until_complete(outcome)
        channel.send({"op": "done", "result": _plain(scope.get("result"))})
    except Stopped:
        channel.send({"op": "done", "result": _plain(scope.get("result"))})
    except BaseException as e:  # the script's own error: the model fixes the script
        frames = [frame for frame in traceback.extract_tb(e.__traceback__) if frame.filename == "<script>"]
        shown = traceback.format_list(frames) + traceback.format_exception_only(type(e), e)
        channel.send({"op": "error", "message": f"{type(e).__name__}: {e}", "traceback": "".join(shown)})


if __name__ == "__main__":
    main()
