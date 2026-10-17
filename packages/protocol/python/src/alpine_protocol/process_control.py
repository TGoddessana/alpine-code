"""Work stop status includes tools that continue executing after their awaiting task was cancelled."""

from typing import Literal

from .base import Message
from .terminals import TerminalProcess


class ToolExecution(Message):
    id: str
    session_id: str | None = None
    name: str
    created_at: float
    status: Literal["running", "stopping", "finished", "cancelled"]
    cancellable: bool


class ProcessesListParams(Message):
    cwd: str | None = None
    session_id: str | None = None


class ProcessesListResult(Message):
    processes: list[TerminalProcess]
    tools: list[ToolExecution]


class ProcessesStopParams(ProcessesListParams):
    force: bool = False


PROCESS_METHODS = {
    "processes/list": (ProcessesListParams, ProcessesListResult),
    "processes/stop": (ProcessesStopParams, ProcessesListResult),
}
