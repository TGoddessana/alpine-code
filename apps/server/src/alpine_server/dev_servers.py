"""JSON-RPC adapter for project development servers."""
from collections.abc import Awaitable, Callable
from typing import Any

from alpine_core.dev_servers import DevelopmentServerManager
from alpine_protocol.dev_servers import (
    DevServersListParams,
    DevServersListResult,
    DevServersLogsParams,
    DevServersLogsResult,
    DevServersRestartParams,
    DevServersRestartResult,
    DevServersStartParams,
    DevServersStartResult,
    DevServersStopParams,
    DevServersStopResult,
)

from .methods import APP_ERROR, MethodError


class DevelopmentServers:
    def __init__(self) -> None:
        self.manager = DevelopmentServerManager()

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {"devServers/list": self.list, "devServers/start": self.start, "devServers/stop": self.stop,
                "devServers/restart": self.restart, "devServers/logs": self.logs}

    async def list(self, params: DevServersListParams) -> DevServersListResult:
        return DevServersListResult(servers=await self.manager.list(params.cwd))

    async def start(self, params: DevServersStartParams) -> DevServersStartResult:
        try:
            return DevServersStartResult(**await self.manager.start(**params.model_dump()))
        except (OSError, ValueError) as exc:
            raise MethodError(APP_ERROR, str(exc)) from exc

    async def stop(self, params: DevServersStopParams) -> DevServersStopResult:
        try:
            return DevServersStopResult(server=await self.manager.stop(params.id))
        except (KeyError, OSError, ValueError) as exc:
            raise MethodError(APP_ERROR, str(exc)) from exc

    async def restart(self, params: DevServersRestartParams) -> DevServersRestartResult:
        try:
            return DevServersRestartResult(**await self.manager.restart(params.id))
        except (KeyError, OSError, ValueError) as exc:
            raise MethodError(APP_ERROR, str(exc)) from exc

    async def logs(self, params: DevServersLogsParams) -> DevServersLogsResult:
        try:
            return DevServersLogsResult(**self.manager.logs(params.id, params.offset, params.limit))
        except KeyError as exc:
            raise MethodError(APP_ERROR, "Development server was not found") from exc
