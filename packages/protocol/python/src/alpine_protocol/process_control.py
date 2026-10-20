"""The processes a project's or a session's work started, and stopping them."""

from typing import Literal

from .base import Message
from .terminals import TerminalProcess


class ProcessesListParams(Message):
    kind: Literal["command", "shell"] | None = None
    cwd: str | None = None
    session_id: str | None = None


class ProcessesListResult(Message):
    processes: list[TerminalProcess]


class ProcessesStopParams(ProcessesListParams):
    force: bool = False


PROCESS_METHODS = {
    "processes/list": (ProcessesListParams, ProcessesListResult),
    "processes/stop": (ProcessesStopParams, ProcessesListResult),
}
