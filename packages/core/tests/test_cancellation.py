import asyncio
import shlex
import sys
import threading

import pytest

from alpine_core.cancellation import current_session
from alpine_core.processes import ProcessManager


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


def test_stopped_context_prevents_a_late_process(tmp_path):
    from alpine_core.cancellation import current_cancellation

    async def scenario():
        event = threading.Event()
        event.set()
        token = current_cancellation.set(event)
        try:
            manager = ProcessManager()
            with pytest.raises(asyncio.CancelledError):
                await manager.start("echo unexpected", tmp_path)
            assert manager.list() == []
            assert not (tmp_path / "unexpected").exists()
        finally:
            current_cancellation.reset(token)

    asyncio.run(scenario())


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
