import asyncio
import json
import shlex
import sys

import pytest
from alpineagents import Agent, ToolError
from alpineagents.testing import FakeModel

from alpine_core.cancellation import current_session
from alpine_core.permissions import Mode, PermissionPolicy
from alpine_core.processes import ProcessManager
from alpine_core.tools import Workspace, default_tools
from alpine_core.tools.bash import Bash
from alpine_core.tools.process import Processes


def test_background_handle_can_be_read_written_and_stopped(tmp_path, monkeypatch):
    manager = ProcessManager()
    monkeypatch.setattr("alpine_core.tools.bash.process_manager", lambda: manager)
    monkeypatch.setattr("alpine_core.tools.process.process_manager", lambda: manager)

    async def scenario():
        workspace = Workspace(tmp_path)
        tools = Processes(workspace)
        token = current_session.set("chat-1")
        try:
            source = "print('ready',flush=True); print('received:'+input(),flush=True)"
            command = f"{shlex.quote(sys.executable)} -u -c {shlex.quote(source)}"
            handle = json.loads(await Bash(workspace).bash.invoke(dict(command=command, background=True), None))
            process_id = handle["process_id"]
            assert handle["background"] and handle["process"]["status"] == "running"
            assert handle["process"]["session_id"] == "chat-1"
            listed = json.loads(await tools.process_list.invoke({}, None))
            assert listed["processes"][0]["id"] == process_id
            await tools.process_write.invoke(dict(process_id=process_id, data="hello\n"), None)
            await manager.get(process_id).wait()
            read = json.loads(await tools.process_read.invoke(dict(process_id=process_id, limit=4), None))
            rest = json.loads(
                await tools.process_read.invoke(dict(process_id=process_id, offset=read["next_offset"]), None)
            )
            assert read["text"] + rest["text"] == "ready\nreceived:hello\n"
            assert rest["process"]["status"] == "exited"
            sleeping = await manager.start("sleep 60", tmp_path, pty=False)
            stopped = json.loads(await tools.process_stop.invoke(dict(process_id=sleeping.id), None))
            assert stopped["process"]["status"] == "cancelled"
        finally:
            current_session.reset(token)
            await manager.shutdown()

    asyncio.run(scenario())


def test_process_tools_deny_other_projects_and_other_sessions(tmp_path, monkeypatch):
    manager = ProcessManager()
    monkeypatch.setattr("alpine_core.tools.process.process_manager", lambda: manager)

    async def scenario():
        project = tmp_path / "project"
        project.mkdir()
        outside = await manager.start("true", tmp_path, pty=False, session_id="same-chat")
        other_session = await manager.start("true", project, pty=False, session_id="other-chat")
        visible = await manager.start("true", project, pty=False, session_id="same-chat")
        shared_job = await manager.start("true", project, pty=False)
        tools = Processes(Workspace(project))
        token = current_session.set("same-chat")
        try:
            result = json.loads(await tools.process_list.invoke({}, None))
            assert {p["id"] for p in result["processes"]} == {visible.id, shared_job.id}
            for process in (outside, other_session):
                with pytest.raises(ToolError, match="No accessible process"):
                    await tools.process_read.invoke(dict(process_id=process.id), None)
                with pytest.raises(ToolError, match="No accessible process"):
                    await tools.process_write.invoke(dict(process_id=process.id, data="x\n"), None)
                with pytest.raises(ToolError, match="No accessible process"):
                    await tools.process_stop.invoke(dict(process_id=process.id), None)
        finally:
            current_session.reset(token)
            await manager.shutdown()

    asyncio.run(scenario())


def test_process_input_and_stop_require_execution_permission(tmp_path):
    workspace = Workspace(tmp_path)
    tools = Agent(FakeModel([]), tools=default_tools(workspace)).tool_map
    policy = PermissionPolicy(workspace, mode=Mode.ACCEPT_EDITS)
    assert policy.evaluate("process_list", {}, tools["process_list"]).allowed
    assert policy.evaluate("process_read", {"process_id": "id"}, tools["process_read"]).allowed
    assert not policy.evaluate("process_write", {"process_id": "id", "data": "rm x\n"}, tools["process_write"]).allowed
    assert not policy.evaluate("process_stop", {"process_id": "id"}, tools["process_stop"]).allowed


def test_cancelled_foreground_command_is_not_success_even_when_it_exits_zero(tmp_path, monkeypatch):
    manager = ProcessManager()
    monkeypatch.setattr("alpine_core.tools.bash.process_manager", lambda: manager)

    async def scenario():
        source = (
            "import signal,time,sys; signal.signal(signal.SIGTERM,lambda *_:sys.exit(0)); "
            "print('ready'); time.sleep(60)"
        )
        command = f"exec {shlex.quote(sys.executable)} -u -c {shlex.quote(source)}"
        task = asyncio.create_task(Bash(Workspace(tmp_path)).bash.invoke(dict(command=command), None))
        try:
            for _ in range(200):
                processes = manager.list()
                if processes and "ready" in processes[0].read()["text"]:
                    break
                await asyncio.sleep(0.01)
            else:
                pytest.fail("command did not start")
            await processes[0].stop()
            with pytest.raises(ToolError) as stopped:
                await task
            result = json.loads(str(stopped.value))
            assert result["cancelled"] and not result["timed_out"]
            assert result["exit_code"] == 0
        finally:
            await manager.shutdown()
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())
