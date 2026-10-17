import asyncio
import shlex
import sys

import pytest

from alpine_core.processes import process_manager
from alpine_protocol.terminals import (
    TerminalsListParams,
    TerminalsReadParams,
    TerminalsStartParams,
    TerminalsWriteParams,
)
from alpine_server.methods import MethodError
from alpine_server.terminals import list_terminals, read_terminal, start_terminal, write_terminal


def test_terminal_methods_persist_and_return_camel_case_wire_data(tmp_path):
    async def scenario():
        command = f"{shlex.quote(sys.executable)} -u -c {shlex.quote('print(input())')}"
        started = await start_terminal(TerminalsStartParams(command=command, cwd=str(tmp_path), pty=False))
        process_id = started.process.id
        await write_terminal(TerminalsWriteParams(process_id=process_id, data="hello\n"))
        await process_manager().get(process_id).wait()
        listed = await list_terminals(TerminalsListParams(cwd=str(tmp_path)))
        assert process_id in [p.id for p in listed.processes]
        result = await read_terminal(TerminalsReadParams(process_id=process_id))
        assert result.text == "hello\n"
        wire = result.model_dump(by_alias=True)
        assert wire["nextOffset"] == 6
        assert wire["process"]["exitCode"] == 0
        with pytest.raises(MethodError, match="no longer accepting input"):
            await write_terminal(TerminalsWriteParams(process_id=process_id, data="late\n"))

    asyncio.run(scenario())


def test_unknown_process_and_invalid_working_directory():
    async def scenario():
        with pytest.raises(MethodError, match="Unknown process"):
            await read_terminal(TerminalsReadParams(process_id="missing-process"))
        with pytest.raises(MethodError):
            await start_terminal(TerminalsStartParams(command="true", cwd="/missing-alpine-directory"))

    asyncio.run(scenario())
