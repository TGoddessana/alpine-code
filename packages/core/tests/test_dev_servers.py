"""Real loopback listeners and subprocesses, isolated from the user's development servers."""
import asyncio
import shlex
import socket
import sys
from pathlib import Path

from alpine_core.dev_servers import DevelopmentServerManager, listener
from alpine_core.processes import process_manager


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


async def ready(port: int) -> None:
    for _ in range(100):
        if await listener(port):
            return
        await asyncio.sleep(0.03)
    raise AssertionError("Server did not listen")


def command(port: int) -> str:
    return f"{shlex.quote(sys.executable)} -u -m http.server {port} --bind 127.0.0.1"


def test_lifecycle_deduplication_and_logs(tmp_path: Path):
    async def check():
        manager = DevelopmentServerManager()
        port = free_port()
        try:
            first = (await manager.start(str(tmp_path), command(port), port))["server"]
            duplicate = (await manager.start(str(tmp_path), command(port), port))["server"]
            assert duplicate["process_id"] == first["process_id"]
            await ready(port)
            listed = await manager.list(str(tmp_path))
            assert listed[0]["status"] == "running"
            assert listed[0]["url"] == f"http://localhost:{port}"
            assert "Serving HTTP" in manager.logs(first["id"], 0, 65536)["text"]
            restarted = (await manager.restart(first["id"]))["server"]
            assert restarted["process_id"] != first["process_id"]
            await ready(port)
            stopped = await manager.stop(restarted["id"])
            assert stopped["status"] == "stopped"
            assert await listener(port) is None
        finally:
            await process_manager().shutdown()
    asyncio.run(check())


def test_external_project_ownership_and_detach(tmp_path: Path):
    async def check():
        manager = DevelopmentServerManager()
        port = free_port()
        outside = await asyncio.create_subprocess_exec(sys.executable, "-m", "http.server", str(port),
            "--bind", "127.0.0.1", cwd=tmp_path, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        try:
            await ready(port)
            conflict = await manager.start(str(tmp_path), command(port), port)
            assert conflict["conflict"]["pid"] == outside.pid
            assert conflict["conflict"]["can_reuse"]
            other = tmp_path / "other"
            other.mkdir()
            unrelated = await manager.start(str(other), command(port), port, reuse=True)
            assert not unrelated["conflict"]["can_reuse"]
            reused = (await manager.start(str(tmp_path), command(port), port, reuse=True))["server"]
            assert reused["external"]
            assert reused["process_id"] is None
            await manager.stop(reused["id"])
            assert outside.returncode is None
            assert await listener(port)
        finally:
            outside.terminate()
            await outside.wait()
    asyncio.run(check())


def test_detect_actual_port_and_reject_unrelated_log_url(tmp_path: Path):
    async def check():
        manager = DevelopmentServerManager()
        requested, actual, unrelated = free_port(), free_port(), free_port()
        outside = await asyncio.create_subprocess_exec(sys.executable, "-m", "http.server", str(unrelated),
            "--bind", "127.0.0.1", cwd=tmp_path, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        try:
            await ready(unrelated)
            source = (f"import http.server; print('http://localhost:{actual}', flush=True); "
                      f"http.server.HTTPServer(('127.0.0.1',{actual}), http.server.SimpleHTTPRequestHandler)"
                      ".serve_forever()")
            cmd = f"{shlex.quote(sys.executable)} -u -c {shlex.quote(source)}"
            first = (await manager.start(str(tmp_path), cmd, requested))["server"]
            await ready(actual)
            listed = await manager.list(str(tmp_path))
            assert listed[0]["port"] == actual
            duplicate = (await manager.start(str(tmp_path), cmd, requested))["server"]
            assert duplicate["id"] == first["id"]
            source = f"import time; print('http://localhost:{unrelated}',flush=True); time.sleep(30)"
            fake = f"{shlex.quote(sys.executable)} -u -c {shlex.quote(source)}"
            fake_server = (await manager.start(str(tmp_path), fake, free_port()))["server"]
            await asyncio.sleep(0.1)
            fake_snapshot = await manager.servers[fake_server["id"]].snapshot()
            assert fake_snapshot["url"] is None
            assert fake_snapshot["status"] == "starting"
        finally:
            outside.terminate()
            await outside.wait()
            await process_manager().shutdown()
    asyncio.run(check())


def test_discovers_agent_launched_server_and_can_stop_it(tmp_path: Path):
    async def check():
        manager = DevelopmentServerManager()
        port, unrelated = free_port(), free_port()
        outside = await asyncio.create_subprocess_exec(sys.executable, "-m", "http.server", str(unrelated),
            "--bind", "127.0.0.1", cwd=tmp_path, stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL)
        try:
            await ready(unrelated)
            source = (f"import http.server; print('http://localhost:{port}', flush=True); "
                      f"http.server.HTTPServer(('127.0.0.1',{port}), http.server.SimpleHTTPRequestHandler)"
                      ".serve_forever()")
            cmd = f"{shlex.quote(sys.executable)} -u -c {shlex.quote(source)}"
            process = await process_manager().start(cmd, tmp_path, session_id="agent-session")
            fake_source = f"import time; print('http://localhost:{unrelated}',flush=True); time.sleep(30)"
            fake_cmd = f"{shlex.quote(sys.executable)} -u -c {shlex.quote(fake_source)}"
            await process_manager().start(fake_cmd, tmp_path)
            await ready(port)
            await asyncio.sleep(0.05)
            servers = await manager.list(str(tmp_path))
            assert len(servers) == 1
            server = servers[0]
            assert server["process_id"] == process.id
            assert server["port"] == port
            assert server["command"] == cmd
            assert server["status"] == "running"
            assert manager.servers[server["id"]].session_id == "agent-session"
            assert len(await manager.list(str(tmp_path))) == 1
            stopped = await manager.stop(server["id"])
            assert stopped["status"] == "stopped"
            assert await listener(port) is None
            assert outside.returncode is None
        finally:
            outside.terminate()
            await outside.wait()
            await process_manager().shutdown()
    asyncio.run(check())
