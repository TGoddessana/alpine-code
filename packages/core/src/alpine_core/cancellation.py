"""Cancellation context and truthful tracking for user tools running in this process.

Python worker threads cannot be killed safely. They stay in this registry until their
function really returns. User tools may check ``cancellation_requested()`` cooperatively.
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from collections.abc import Callable
from contextvars import ContextVar
from dataclasses import asdict, dataclass
from typing import Any

from alpineagents import State, Tool

current_session: ContextVar[str | None] = ContextVar("alpine_session", default=None)
current_cancellation: ContextVar[threading.Event | None] = ContextVar("alpine_cancellation", default=None)
#: Who inside a session starts the processes, e.g. one TF agent, so stopping it can end what it started.
current_owner: ContextVar[str | None] = ContextVar("alpine_owner", default=None)
#: Shows a notice to the user from inside a tool call (the session's ``Notice`` event), when a session is running it.
current_notice: ContextVar[Callable[[str, str | None], None] | None] = ContextVar("alpine_notice", default=None)
_current_call: ContextVar[str | None] = ContextVar("alpine_tool_call", default=None)


@dataclass
class ToolExecution:
    id: str
    session_id: str | None
    name: str
    created_at: float
    status: str = "running"
    cancellable: bool = False


class ToolExecutions:
    def __init__(self) -> None:
        self._calls: dict[str, ToolExecution] = {}
        self._lock = threading.Lock()

    def begin(self, tool: Tool) -> ToolExecution:
        event = current_cancellation.get()
        if event is not None and event.is_set():
            raise asyncio.CancelledError("Run was stopped before this tool started")
        call = ToolExecution(uuid.uuid4().hex, current_session.get(), tool.name, time.time(), cancellable=tool.is_async)
        with self._lock:
            self._calls[call.id] = call
        return call

    def finish(self, call: ToolExecution, *, cancelled: bool = False) -> None:
        with self._lock:
            call.status = "cancelled" if cancelled else "finished"

    def cancel(self, session_id: str) -> None:
        with self._lock:
            for call in self._calls.values():
                if call.session_id == session_id and call.status == "running":
                    call.status = "stopping"

    def list(self, session_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            return [asdict(c) for c in self._calls.values() if session_id is None or c.session_id == session_id]

    def requested(self) -> bool:
        with self._lock:
            call = self._calls.get(_current_call.get() or "")
            return call is not None and call.status == "stopping"


executions = ToolExecutions()


def cancellation_requested() -> bool:
    """Cooperative cancellation contract for a synchronous user tool's loop."""
    event = current_cancellation.get()
    return (event is not None and event.is_set()) or executions.requested()


class _Tracked(Tool):
    def __init__(self, original: Tool) -> None:
        super().__init__(
            name=original.name,
            description=original.description,
            input_schema=original.input_schema,
            parallel=original.parallel,
            read_only=original.read_only,
            destructive=original.destructive,
            idempotent=original.idempotent,
            open_world=original.open_world,
        )
        self.original = original

    def hints_for(self, args):
        return self.original.hints_for(args)

    def run(self, args: dict[str, Any], state: State) -> Any:
        call = executions.begin(self.original)
        token = _current_call.set(call.id)
        try:
            return self.original.run(args, state)
        finally:
            executions.finish(call)
            _current_call.reset(token)


class _AsyncTracked(_Tracked):
    async def run(self, args: dict[str, Any], state: State) -> Any:
        call = executions.begin(self.original)
        token = _current_call.set(call.id)
        cancelled = False
        try:
            return await self.original.run(args, state)
        except asyncio.CancelledError:
            cancelled = True
            raise
        finally:
            executions.finish(call, cancelled=cancelled)
            _current_call.reset(token)


def track_user_tool(tool: Tool) -> Tool:
    return (_AsyncTracked if tool.is_async else _Tracked)(tool)
