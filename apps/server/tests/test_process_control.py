import asyncio
import shlex
import sys

import pytest

from alpine_core.processes import process_manager
from alpine_protocol.process_control import ProcessesListParams, ProcessesStopParams
from alpine_server.methods import MethodError
from alpine_server.process_control import list_processes, stop_processes


def test_work_stop_is_session_scoped_and_output_survives(tmp_path):
    async def scenario():
        manager = process_manager()
        command = f"exec {shlex.quote(sys.executable)} -u -c " + shlex.quote(
            "import time; print('before cancellation'); time.sleep(60)"
        )
        first = await manager.start(command, tmp_path, session_id="chat-a", pty=False)
        other = await manager.start(command, tmp_path, session_id="chat-b", pty=False)
        try:
            for _ in range(200):
                if first.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            result = await stop_processes(ProcessesStopParams(cwd=str(tmp_path), session_id="chat-a"))
            assert len(result.processes) == 1
            assert result.processes[0].status == "cancelled"
            assert first.read()["text"] == "before cancellation\n"
            assert other.status == "running"
            assert len((await list_processes(ProcessesListParams(cwd=str(tmp_path)))).processes) == 2
            with pytest.raises(MethodError):
                await stop_processes(ProcessesStopParams())
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


def test_command_filter_and_stop_leave_user_shell_running(tmp_path):
    async def scenario():
        manager = process_manager()
        command = await manager.start("sleep 60", tmp_path, pty=False, session_id="agent")
        shell = await manager.start("sleep 60", tmp_path, pty=False, session_id="agent", kind="shell")
        try:
            result = await list_processes(ProcessesListParams(cwd=str(tmp_path), session_id="agent", kind="command"))
            assert [p.id for p in result.processes] == [command.id]
            await stop_processes(ProcessesStopParams(cwd=str(tmp_path), session_id="agent", kind="command", force=True))
            assert command.status == "cancelled"
            assert shell.status == "running"
        finally:
            await manager.shutdown()

    asyncio.run(scenario())
