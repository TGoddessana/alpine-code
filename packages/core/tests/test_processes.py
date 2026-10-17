import asyncio
import os
import shlex
import sys

import pytest

from alpine_core.processes import ProcessManager


def python(source):
    return f"{shlex.quote(sys.executable)} -u -c {shlex.quote(source)}"


def test_streaming_input_persistence_and_log_paging(tmp_path):
    async def scenario():
        manager = ProcessManager()
        process = await manager.start(
            python("print('ready', flush=True); value=input(); print('got:'+value)"),
            tmp_path,
            pty=False,
            session_id="chat-a",
        )
        for _ in range(100):
            if "ready" in process.read()["text"]:
                break
            await asyncio.sleep(0.01)
        assert process.status == "running"
        assert "ready" in process.read()["text"]
        assert manager.get(process.id) is process
        assert manager.list(tmp_path, "chat-a") == [process]
        assert manager.list(tmp_path, "chat-b") == []
        first = process.read(limit=4)
        await process.write("hello\n")
        assert await process.wait() == 0
        remainder = process.read(first["next_offset"])
        assert first["text"] + remainder["text"] == "ready\ngot:hello\n"
        assert process.snapshot()["status"] == "exited"
        await manager.shutdown()

    asyncio.run(scenario())


@pytest.mark.skipif(os.name != "posix", reason="POSIX PTY")
def test_real_pty_input_and_resize(tmp_path):
    async def scenario():
        manager = ProcessManager()
        process = await manager.start(python("import os; print(os.isatty(0)); print(input())"), tmp_path)
        process.resize(90, 24)
        for _ in range(100):
            if "True" in process.read()["text"]:
                break
            await asyncio.sleep(0.01)
        assert "True" in process.read()["text"]
        await process.write("from-terminal\n")
        assert await asyncio.wait_for(process.wait(), 3) == 0
        assert "from-terminal" in process.read()["text"]
        await manager.shutdown()

    asyncio.run(scenario())


def test_unicode_streams_nonzero_exit_and_complete_large_logs(tmp_path):
    async def scenario():
        manager = ProcessManager()
        source = (
            "import os,sys,time; os.write(1,b'\\xed'); time.sleep(.05); "
            "os.write(1,b'\\x95\\x9c'); print('x'*400000); "
            "print('oops',file=sys.stderr); sys.exit(7)"
        )
        process = await manager.start(python(source), tmp_path, pty=False)
        assert await process.wait() == 7
        offset, pages = 0, []
        while offset < process.snapshot()["output_size"]:
            page = process.read(offset, 10003)
            assert page["next_offset"] > offset
            pages.append(page["text"])
            offset = page["next_offset"]
        text = "".join(pages)
        assert "한" in text and "\ufffd" not in text
        assert text.count("x") == 400000
        assert process.output("stderr") == "oops\n"
        assert process.status == "failed"
        await manager.shutdown()

    asyncio.run(scenario())


def test_stop_preserves_output_and_shutdown_reaps_process(tmp_path):
    async def scenario():
        manager = ProcessManager()
        process = await manager.start(python("import time; print('before'); time.sleep(60)"), tmp_path, pty=False)
        for _ in range(100):
            if process.read()["text"]:
                break
            await asyncio.sleep(0.01)
        await process.stop()
        await asyncio.wait_for(process.wait(), 3)
        assert process.status == "cancelled"
        assert process.read()["text"] == "before\n"
        assert process.process.returncode != 0
        await manager.shutdown()
        assert manager.list() == []

    asyncio.run(scenario())


@pytest.mark.skipif(os.name != "posix", reason="POSIX interactive shell")
def test_persistent_shell_keeps_directory_and_environment_across_inputs(tmp_path):
    async def scenario():
        manager = ProcessManager()
        folder = tmp_path / "nested folder"
        folder.mkdir()
        process = await manager.start("exec /bin/sh -i", tmp_path)
        try:
            await process.write(
                f"cd {shlex.quote(str(folder))}; export ALPINE_TERMINAL_VALUE=kept; printf '\\nFIRST_READY\\n'\n"
            )
            for _ in range(200):
                if "\nFIRST_READY\r\n" in process.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            else:
                pytest.fail("interactive shell did not finish its first input")
            assert process.status == "running"
            # A separate UI input round trip reaches the same shell and its mutated state.
            await process.write('printf \'\\nSECOND:%s:%s\\n\' "$PWD" "$ALPINE_TERMINAL_VALUE"\n')
            expected = f"SECOND:{folder}:kept"
            for _ in range(200):
                if expected in process.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            else:
                pytest.fail("shell cwd and exported variable were not preserved")
            await process.write("exit\n")
            assert await asyncio.wait_for(process.wait(), 3) == 0
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


def test_wait_for_output_wakes_on_new_output_and_close_releases_registry(tmp_path):
    async def scenario():
        manager = ProcessManager()
        process = await manager.start(python("print(input(),flush=True)"), tmp_path, pty=False)
        waiter = asyncio.create_task(process.wait_for_output(0, 1))
        await asyncio.sleep(0)
        assert not waiter.done()
        await process.write("wake up\n")
        await asyncio.wait_for(waiter, 1)
        assert "wake up" in process.read()["text"]
        await process.wait()
        await manager.close(process.id)
        assert manager.list() == []
        assert process._log.closed
        await manager.shutdown()

    asyncio.run(scenario())


@pytest.mark.skipif(os.name != "posix", reason="POSIX controlling terminal")
def test_interactive_terminal_has_a_controlling_tty_and_ctrl_c_preserves_shell(tmp_path):
    async def scenario():
        manager = ProcessManager()
        process = await manager.start("exec /bin/sh -i", tmp_path)
        try:
            await process.write("test -r /dev/tty && printf 'TTY_OK\\n'; sleep 30\r")
            for _ in range(200):
                if "TTY_OK\r\n" in process.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            assert "TTY_OK\r\n" in process.read()["text"]
            await process.write("\x03")
            await process.write("printf 'SHELL_SURVIVED\\n'\r")
            for _ in range(200):
                if "SHELL_SURVIVED\r\n" in process.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            assert "SHELL_SURVIVED\r\n" in process.read()["text"]
            assert process.status == "running"
            await manager.close(process.id)
            assert manager.list() == []
        finally:
            await manager.shutdown()

    asyncio.run(scenario())


@pytest.mark.skipif(os.name != "posix", reason="POSIX shell jobs")
def test_close_terminal_reaps_background_job_groups(tmp_path):
    async def scenario():
        manager = ProcessManager()
        process = await manager.start("exec /bin/sh -i", tmp_path)
        try:
            await process.write("sleep 30 & printf 'BACKGROUND_READY\\n'\r")
            for _ in range(200):
                if "BACKGROUND_READY\r\n" in process.read()["text"]:
                    break
                await asyncio.sleep(0.01)
            assert "BACKGROUND_READY\r\n" in process.read()["text"]
            await asyncio.wait_for(manager.close(process.id), 3)
            assert manager.list() == []
            assert process._finished.done()
        finally:
            await manager.shutdown()

    asyncio.run(scenario())
