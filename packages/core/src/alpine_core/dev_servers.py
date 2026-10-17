"""Development servers share managed terminal processes and outlive frontend navigation."""
from __future__ import annotations

import asyncio
import os
import re
import shutil
import socket
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .processes import process_manager


async def _command(*args: str) -> str:
    try:
        child = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE,
                                                     stderr=asyncio.subprocess.DEVNULL)
        stdout, _ = await asyncio.wait_for(child.communicate(), 3)
        return stdout.decode(errors="replace").strip()
    except OSError:
        return ""
    except TimeoutError:
        child.kill()
        await child.wait()
        return ""


async def listener(port: int) -> dict[str, Any] | None:
    """Probe loopback first. Unknown ownership remains a conflict, never permission to kill/reuse."""
    def connected() -> bool:
        for host in ("127.0.0.1", "::1"):
            try:
                with socket.create_connection((host, port), timeout=0.15):
                    return True
            except OSError:
                pass
        return False

    if not await asyncio.to_thread(connected):
        return None
    info: dict[str, Any] = {"port": port, "pid": None, "cwd": None, "can_reuse": False}
    lsof = shutil.which("lsof") or ("/usr/sbin/lsof" if Path("/usr/sbin/lsof").exists() else None)
    if lsof:
        owners = await _command(lsof, "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN")
        pids = owners.splitlines()
        if len(pids) == 1 and pids[0].isdigit():
            info["pid"] = int(pids[0])
            fields = await _command(lsof, "-a", "-p", pids[0], "-d", "cwd", "-Fn")
            info["cwd"] = next((line[1:] for line in fields.splitlines() if line.startswith("n")), None)
    return info


def _owned_by(listener: dict[str, Any], pid: int) -> bool:
    if listener["pid"] is None:
        return False
    try:
        return os.getpgid(listener["pid"]) == pid
    except OSError:
        return False


def _loopback_ports(process: Any) -> list[int]:
    # The tail also finds URLs from a restarted child after a long-running build's output.
    offset = max(0, process.snapshot()["output_size"] - 262144)
    text = process.read(offset=offset, limit=262144)["text"]
    values = re.findall(r"https?://(?:localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})(?!\d)", text)
    return list(dict.fromkeys(int(value) for value in reversed(values) if 1 <= int(value) <= 65535))


@dataclass
class DevelopmentServer:
    id: str
    cwd: str
    command: str
    port: int
    process_id: str | None = None
    external: bool = False
    session_id: str | None = None
    requested_port: int | None = None
    external_pid: int | None = None

    async def snapshot(self) -> dict[str, Any]:
        if self.process_id:
            process = process_manager().get(self.process_id)
            # Dev tools may choose another free port. Only accept loopback URLs, never arbitrary log links.
            for candidate in _loopback_ports(process):
                owner = await listener(candidate)
                if owner and _owned_by(owner, process.snapshot()["pid"]):
                    self.port = candidate
                    break
        occupied = await listener(self.port)
        if occupied and self.process_id and not _owned_by(occupied, process.snapshot()["pid"]):
            occupied = None
        status = "running" if occupied else "starting"
        if self.external:
            same_project = occupied and occupied["cwd"] and str(Path(occupied["cwd"]).resolve()) == self.cwd
            same_process = occupied and occupied["pid"] == self.external_pid
            status = "running" if same_project and same_process else "stopped"
        else:
            process = process_manager().get(self.process_id)
            state = process.snapshot()
            if state.get("status") in {"exited", "failed", "stopped", "cancelled"}:
                status = "stopped" if state.get("cancelled") or state.get("exit_code") in (0, None) else "failed"
            elif state.get("status") == "stopping":
                status = "stopping"
        return {"id": self.id, "cwd": self.cwd, "command": self.command, "port": self.port,
                "url": f"http://localhost:{self.port}" if status == "running" else None,
                "process_id": self.process_id, "external": self.external, "status": status}


class DevelopmentServerManager:
    def __init__(self) -> None:
        self.servers: dict[str, DevelopmentServer] = {}
        self._lock = asyncio.Lock()

    async def start(self, cwd: str, command: str, port: int, *, session_id: str | None = None,
                    reuse: bool = False) -> dict[str, Any]:
        project = Path(cwd).expanduser().resolve(strict=True)
        if not project.is_dir() or not command.strip():
            raise ValueError("Choose a project folder and a server command")
        async with self._lock:
            await self._discover(str(project))
            # A second click or another session must not duplicate a managed process that is still starting.
            for existing in self.servers.values():
                if existing.cwd == str(project) and (existing.port == port or existing.requested_port == port):
                    current = await existing.snapshot()
                    if current["status"] in {"starting", "running", "stopping"}:
                        return {"server": current}
            conflict = await listener(port)
            if conflict:
                conflict["can_reuse"] = conflict["cwd"] is not None and Path(conflict["cwd"]).resolve() == project
                if not reuse or not conflict["can_reuse"]:
                    return {"conflict": conflict}
                server = DevelopmentServer(uuid.uuid4().hex, str(project), command, port,
                                           external=True, external_pid=conflict["pid"])
            else:
                # PORT is supplied for servers that support it; explicit CLI flags still take precedence.
                process = await process_manager().start(f"PORT={port} {command}", project,
                                                        session_id=session_id, title=f"Dev server :{port}")
                server = DevelopmentServer(uuid.uuid4().hex, str(project), command, port,
                                           process_id=process.id, session_id=session_id, requested_port=port)
            self.servers[server.id] = server
            return {"server": await server.snapshot()}

    async def _discover(self, project: str) -> None:
        """Adopt agent/terminal-launched servers only after verifying their listening process group."""
        registered = {server.process_id for server in self.servers.values() if server.process_id}
        for process in process_manager().list(cwd=project):
            state = process.snapshot()
            if process.id in registered or state["status"] != "running":
                continue
            for port in _loopback_ports(process):
                owner = await listener(port)
                if owner and _owned_by(owner, state["pid"]):
                    server = DevelopmentServer(uuid.uuid4().hex, project, state["command"], port,
                                               process_id=process.id, session_id=state["session_id"])
                    self.servers[server.id] = server
                    registered.add(process.id)
                    break

    async def list(self, cwd: str) -> list[dict[str, Any]]:
        project = str(Path(cwd).expanduser().resolve())
        async with self._lock:
            await self._discover(project)
            return [await s.snapshot() for s in list(self.servers.values()) if s.cwd == project]

    async def stop(self, id: str) -> dict[str, Any]:
        server = self.servers[id]
        if server.external:
            # Reused processes belong to their original launcher. Detach without signaling them.
            del self.servers[id]
            return {**await server.snapshot(), "status": "stopped", "url": None}
        await process_manager().get(server.process_id).stop()
        return await server.snapshot()

    async def restart(self, id: str) -> dict[str, Any]:
        server = self.servers[id]
        if server.external:
            raise ValueError("Stop or restart this server in its original terminal")
        await self.stop(id)
        return await self.start(server.cwd, server.command, server.port, session_id=server.session_id)

    def logs(self, id: str, offset: int, limit: int) -> dict[str, Any]:
        server = self.servers[id]
        if server.external:
            return {"text": "", "next_offset": 0, "total": 0}
        return process_manager().get(server.process_id).read(offset=offset, limit=limit)
