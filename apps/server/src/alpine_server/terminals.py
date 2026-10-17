"""Async methods sharing the same registry as the agent's bash tool."""

from alpine_core.processes import process_manager
from alpine_protocol.terminals import (
    TerminalProcess,
    TerminalsListParams,
    TerminalsListResult,
    TerminalsProcessResult,
    TerminalsReadParams,
    TerminalsReadResult,
    TerminalsResizeParams,
    TerminalsStartParams,
    TerminalsStopParams,
    TerminalsWriteParams,
)

from .methods import INVALID_PARAMS, MethodError


def _get(process_id: str):
    try:
        return process_manager().get(process_id)
    except LookupError as exc:
        raise MethodError(INVALID_PARAMS, str(exc)) from exc


def _result(process) -> TerminalsProcessResult:
    return TerminalsProcessResult(process=TerminalProcess(**process.snapshot()))


async def list_terminals(params: TerminalsListParams) -> TerminalsListResult:
    return TerminalsListResult(
        processes=[TerminalProcess(**p.snapshot()) for p in process_manager().list(params.cwd, params.session_id)]
    )


async def start_terminal(params: TerminalsStartParams) -> TerminalsProcessResult:
    try:
        process = await process_manager().start(
            params.command, params.cwd, session_id=params.session_id, title=params.title, pty=params.pty
        )
    except (OSError, ValueError) as exc:
        raise MethodError(INVALID_PARAMS, str(exc)) from exc
    return _result(process)


async def read_terminal(params: TerminalsReadParams) -> TerminalsReadResult:
    process = _get(params.process_id)
    return TerminalsReadResult(
        **process.read(params.offset, params.limit), process=TerminalProcess(**process.snapshot())
    )


async def write_terminal(params: TerminalsWriteParams) -> TerminalsProcessResult:
    process = _get(params.process_id)
    try:
        await process.write(params.data)
    except (OSError, ValueError, BrokenPipeError) as exc:
        raise MethodError(INVALID_PARAMS, str(exc)) from exc
    return _result(process)


async def resize_terminal(params: TerminalsResizeParams) -> TerminalsProcessResult:
    process = _get(params.process_id)
    process.resize(params.cols, params.rows)
    return _result(process)


async def stop_terminal(params: TerminalsStopParams) -> TerminalsProcessResult:
    process = _get(params.process_id)
    await process.stop(force=params.force)
    return _result(process)


HANDLERS = {
    "terminals/list": list_terminals,
    "terminals/start": start_terminal,
    "terminals/read": read_terminal,
    "terminals/write": write_terminal,
    "terminals/resize": resize_terminal,
    "terminals/stop": stop_terminal,
}
