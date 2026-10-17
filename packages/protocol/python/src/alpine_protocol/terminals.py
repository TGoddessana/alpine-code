"""Managed terminal requests; output offsets are UTF-8 byte positions."""

from typing import Literal

from pydantic import Field

from .base import Message


class TerminalProcess(Message):
    id: str
    command: str
    cwd: str
    session_id: str | None = None
    title: str
    pty: bool
    pid: int
    status: Literal["running", "stopping", "exited", "failed", "cancelled"]
    exit_code: int | None = None
    stop_error: str | None = None
    cancelled: bool = False
    created_at: float
    output_size: int


class TerminalsListParams(Message):
    cwd: str | None = None
    session_id: str | None = None


class TerminalsListResult(Message):
    processes: list[TerminalProcess]


class TerminalsStartParams(Message):
    command: str = Field(min_length=1, max_length=65536)
    cwd: str
    session_id: str | None = None
    title: str | None = None
    pty: bool = True


class TerminalsProcessParams(Message):
    process_id: str


class TerminalsProcessResult(Message):
    process: TerminalProcess


class TerminalsReadParams(TerminalsProcessParams):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=65536, ge=4, le=262144)


class TerminalsReadResult(Message):
    text: str
    next_offset: int
    total: int
    process: TerminalProcess


class TerminalsWriteParams(TerminalsProcessParams):
    data: str = Field(max_length=65536)


class TerminalsResizeParams(TerminalsProcessParams):
    cols: int = Field(ge=1, le=1000)
    rows: int = Field(ge=1, le=1000)


class TerminalsStopParams(TerminalsProcessParams):
    force: bool = False


TERMINAL_METHODS = {
    "terminals/list": (TerminalsListParams, TerminalsListResult),
    "terminals/start": (TerminalsStartParams, TerminalsProcessResult),
    "terminals/read": (TerminalsReadParams, TerminalsReadResult),
    "terminals/write": (TerminalsWriteParams, TerminalsProcessResult),
    "terminals/resize": (TerminalsResizeParams, TerminalsProcessResult),
    "terminals/stop": (TerminalsStopParams, TerminalsProcessResult),
}
