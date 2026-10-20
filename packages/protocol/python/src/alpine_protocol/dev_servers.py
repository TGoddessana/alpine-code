"""Project development servers, backed by the shared process registry."""

from typing import Literal

from pydantic import Field

from .base import Message


class DevServerInfo(Message):
    id: str
    cwd: str
    command: str
    port: int
    url: str | None = None
    process_id: str | None = None
    status: Literal["starting", "running", "stopping", "stopped", "failed"]
    external: bool = False


class DevServerConflict(Message):
    port: int
    pid: int | None = None
    cwd: str | None = None
    can_reuse: bool = False


class DevServersListParams(Message):
    cwd: str


class DevServersListResult(Message):
    servers: list[DevServerInfo]


class DevServersStartParams(Message):
    cwd: str
    command: str = Field(min_length=1, max_length=8192)
    port: int = Field(ge=1, le=65535)
    session_id: str | None = None
    reuse: bool = False


class DevServersStartResult(Message):
    server: DevServerInfo | None = None
    conflict: DevServerConflict | None = None


class DevServersStopParams(Message):
    id: str


class DevServersStopResult(Message):
    server: DevServerInfo


class DevServersRestartParams(Message):
    id: str


class DevServersRestartResult(DevServersStartResult):
    pass


class DevServersLogsParams(Message):
    id: str
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=65536, ge=1, le=262144)


class DevServersLogsResult(Message):
    text: str
    next_offset: int
    total: int


DEV_SERVER_METHODS = {
    "devServers/list": (DevServersListParams, DevServersListResult),
    "devServers/start": (DevServersStartParams, DevServersStartResult),
    "devServers/stop": (DevServersStopParams, DevServersStopResult),
    "devServers/restart": (DevServersRestartParams, DevServersRestartResult),
    "devServers/logs": (DevServersLogsParams, DevServersLogsResult),
}
