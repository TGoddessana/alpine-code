import asyncio
import shlex
import sys
import threading
import time

import pytest
from alpineagents import State, tool

from alpine_core.cancellation import current_session, executions, track_user_tool
from alpine_core.processes import ProcessManager
from alpine_core.toolbox import Toolbox


def test_uncooperative_group_requires_force_and_keeps_partial_output(tmp_path):
    async def scenario():
        manager = ProcessManager()
        # exec means the process PID itself ignores TERM rather than only its child.
        command = f"exec {shlex.quote(sys.executable)} -u -c " + shlex.quote(
            "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('partial'); time.sleep(60)"
        )
        token = current_session.set("stop-chat")
        try:
            process = await manager.start(command, tmp_path, pty=False)
        finally:
            current_session.reset(token)
        try:
            for _ in range(200):
                if process.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            assert manager.list(session_id="stop-chat") == [process]
            await process.stop(grace=0.05)
            assert process.status == "stopping"
            assert process.process.returncode is None
            assert process.read()["text"] == "partial\n"
            await process.stop(force=True)
            assert process.status == "cancelled"
            assert process.process.returncode is not None
            assert process.read()["text"] == "partial\n"
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


def test_sync_worker_remains_visible_until_actual_late_side_effect(tmp_path):
    entered, release = threading.Event(), threading.Event()
    marker = tmp_path / "side-effect"

    @tool
    def slow_export() -> str:
        entered.set()
        release.wait(3)
        marker.write_text("finished")
        return "done"

    wrapped = track_user_tool(slow_export)
    token = current_session.set("residual-chat")
    try:
        import contextvars

        context = contextvars.copy_context()
    finally:
        current_session.reset(token)
    worker = threading.Thread(target=lambda: context.run(wrapped.run, {}, State()))
    worker.start()
    assert entered.wait(2)
    executions.cancel("residual-chat")
    assert executions.list("residual-chat")[-1]["status"] == "stopping"
    assert not marker.exists()
    release.set()
    worker.join(2)
    assert marker.read_text() == "finished"
    assert executions.list("residual-chat")[-1]["status"] == "finished"


def test_tool_test_timeout_kills_before_late_side_effect(tmp_path, monkeypatch):
    import alpine_core.toolbox as module

    monkeypatch.setattr(module, "TEST_TIMEOUT", 1)
    marker = tmp_path / "late"
    ready = tmp_path / "ready"
    release = tmp_path / "release"
    original_wait = module.subprocess.Popen.wait

    def wait_after_tool_started(worker, timeout=None):
        # Importing the worker can exceed the short test timeout on a cold CI host.
        # Arm that timeout only once the real tool has printed and reached its gate.
        if not getattr(worker, "_tool_test_ready", False):
            deadline = time.monotonic() + 20
            while not ready.exists() and worker.poll() is None and time.monotonic() < deadline:
                time.sleep(0.01)
            if not ready.exists():
                worker.kill()
                original_wait(worker)
                pytest.fail("Tool worker did not reach the execution gate")
            worker._tool_test_ready = True
            release.touch()
        return original_wait(worker, timeout=timeout)

    monkeypatch.setattr(module.subprocess.Popen, "wait", wait_after_tool_started)
    source = f"""from alpineagents import tool
import time
from pathlib import Path
@tool
def slow() -> str:
    print("partial progress", flush=True)
    Path({str(ready)!r}).touch()
    while not Path({str(release)!r}).exists():
        time.sleep(0.01)
    time.sleep(2)
    Path({str(marker)!r}).write_text("should not happen")
    return "done"
"""
    result = Toolbox(tmp_path / "home").test(source, "slow", {})
    assert not result.ok
    assert "Stopped after" in result.output
    assert "partial progress" in result.output
    time.sleep(2.1)
    assert not marker.exists()


def test_tool_test_subprocess_returns_result(tmp_path):
    source = """from alpineagents import tool
@tool
def plus(value: int) -> int:
    return value + 1
"""
    result = Toolbox(tmp_path).test(source, "plus", {"value": 4})
    assert result.ok
    assert result.output == "5"


def test_stopped_context_prevents_late_queued_user_tool_and_process(tmp_path):
    from alpine_core.cancellation import current_cancellation

    @tool
    def side_effect() -> str:
        (tmp_path / "unexpected").write_text("bad")
        return "done"

    async def scenario():
        event = threading.Event()
        event.set()
        token = current_cancellation.set(event)
        try:
            with pytest.raises(asyncio.CancelledError):
                track_user_tool(side_effect).run({}, State())
            manager = ProcessManager()
            with pytest.raises(asyncio.CancelledError):
                await manager.start("echo unexpected", tmp_path)
            assert manager.list() == []
            assert not (tmp_path / "unexpected").exists()
        finally:
            current_cancellation.reset(token)

    asyncio.run(scenario())


def test_actual_session_cancellation_reports_thread_until_function_returns(tmp_path, monkeypatch):
    from alpineagents.testing import FakeModel, tool_call

    from alpine_core import Mode, Session, Settings
    from alpine_core import session as session_module
    from alpine_core.tool_sources import Offered

    entered, release, finished = threading.Event(), threading.Event(), threading.Event()

    @tool(read_only=True)
    def blocked_user_tool() -> str:
        entered.set()
        release.wait(3)
        finished.set()
        return "eventually done"

    class Source:
        def offered(self):
            return [Offered(blocked_user_tool, "user")]

    monkeypatch.setattr(session_module, "make_model", lambda _: FakeModel([tool_call("blocked_user_tool"), "done"]))

    async def scenario():
        session = Session(
            Settings(model="fake", mode=Mode.YOLO),
            cwd=tmp_path,
            approver=object_with_approve(),
            tools=lambda _: [Source()],
        )
        task = asyncio.create_task(session.asend("run"))
        try:
            for _ in range(200):
                if entered.is_set():
                    break
                await asyncio.sleep(0.01)
            assert entered.is_set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert executions.list(session.id)[-1]["status"] == "stopping"
            assert not finished.is_set()
            release.set()
            for _ in range(200):
                if executions.list(session.id)[-1]["status"] == "finished":
                    break
                await asyncio.sleep(0.01)
            assert executions.list(session.id)[-1]["status"] == "finished"
            assert finished.is_set()
        finally:
            release.set()

    asyncio.run(scenario())


def object_with_approve():
    class Approver:
        def approve(self, _):
            raise AssertionError("read-only tool should not request approval")

    return Approver()


def test_session_stop_preserves_interactive_user_shell(tmp_path, monkeypatch):
    from alpine_core import Session
    from alpine_core import processes as process_module

    async def scenario():
        manager = ProcessManager()
        monkeypatch.setattr(process_module, "_manager", manager)
        session = object.__new__(Session)
        session._id = "agent"
        command = await manager.start("sleep 60", tmp_path, pty=False, session_id=session.id)
        shell = await manager.start("sleep 60", tmp_path, pty=False, session_id=session.id, kind="shell")
        try:
            await session.stop_processes()
            assert command.status == "cancelled"
            assert shell.status == "running"
        finally:
            await manager.shutdown()

    asyncio.run(scenario())
