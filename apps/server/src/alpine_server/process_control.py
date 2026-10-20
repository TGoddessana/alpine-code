"""Process stop operations never equate a cancellation request with actual exit."""

import asyncio

from alpine_core.processes import process_manager
from alpine_protocol.process_control import (
    ProcessesListParams,
    ProcessesListResult,
    ProcessesStopParams,
)
from alpine_protocol.terminals import TerminalProcess

from .methods import INVALID_PARAMS, MethodError


async def list_processes(params: ProcessesListParams) -> ProcessesListResult:
    return ProcessesListResult(
        processes=[
            TerminalProcess(**p.snapshot())
            for p in process_manager().list(params.cwd, params.session_id)
            if params.kind is None or p.kind == params.kind
        ],
    )


async def stop_processes(params: ProcessesStopParams) -> ProcessesListResult:
    if not params.cwd and not params.session_id:
        raise MethodError(INVALID_PARAMS, "Choose a project or a session to stop")
    await asyncio.gather(
        *(
            p.stop(force=params.force)
            for p in process_manager().list(params.cwd, params.session_id)
            if p.status in ("running", "stopping") and (params.kind is None or p.kind == params.kind)
        )
    )
    return await list_processes(params)


HANDLERS = {"processes/list": list_processes, "processes/stop": stop_processes}
