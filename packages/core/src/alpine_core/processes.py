"""Server-owned processes. UI subscriptions never own a process or its output."""

from __future__ import annotations

import asyncio
import codecs
import errno
import os
import signal
import struct
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Literal

from .cancellation import current_cancellation, current_owner, current_session


class ManagedProcess:
    def __init__(
        self,
        command: str,
        cwd: Path,
        session_id: str | None,
        title: str | None,
        pty: bool,
        kind: Literal["command", "shell"] = "command",
    ):
        self.id = uuid.uuid4().hex
        self.command, self.cwd, self.session_id = command, cwd, session_id
        self.title, self.pty = title or command, pty
        self.kind = kind
        self.owner = current_owner.get()
        """Who started it inside the session (``cancellation.current_owner``), e.g. one TF agent."""
        self.created_at = time.time()
        self.status = "running"
        self.cancelled = False
        self.stop_error: str | None = None
        self.process: asyncio.subprocess.Process
        self.master: int | None = None
        self._log = tempfile.TemporaryFile()
        self._stdout = tempfile.TemporaryFile()
        self._stderr = tempfile.TemporaryFile()
        self._size = 0
        self._output_changed = asyncio.Event()
        self._finished: asyncio.Task[None]
        self._decoders = {
            channel: codecs.getincrementaldecoder("utf-8")(errors="replace") for channel in ("stdout", "stderr")
        }

    def snapshot(self) -> dict[str, Any]:
        return dict(
            id=self.id,
            command=self.command,
            cwd=str(self.cwd),
            session_id=self.session_id,
            title=self.title,
            pty=self.pty,
            kind=self.kind,
            pid=self.process.pid,
            status=self.status,
            exit_code=self.process.returncode,
            cancelled=self.cancelled,
            stop_error=self.stop_error,
            created_at=self.created_at,
            output_size=self._size,
        )

    def _append(self, data: bytes, channel: str = "stdout") -> None:
        text = self._decoders[channel].decode(data)
        encoded = text.encode("utf-8")
        self._log.seek(0, 2)
        self._log.write(encoded)
        self._size += len(encoded)
        self._output_changed.set()
        stream = self._stderr if channel == "stderr" else self._stdout
        stream.seek(0, 2)
        stream.write(data)

    async def wait_for_output(self, offset: int, timeout: float) -> None:
        if offset < self._size or self.status not in ("running", "stopping"):
            return
        self._output_changed.clear()
        try:
            await asyncio.wait_for(self._output_changed.wait(), timeout)
        except TimeoutError:
            pass

    def read(self, offset: int = 0, limit: int = 65536) -> dict[str, Any]:
        offset, limit = max(0, min(offset, self._size)), max(4, min(limit, 262144))
        self._log.seek(offset)
        data = self._log.read(limit)
        # Never split an encoded character between pages.
        while data:
            try:
                text = data.decode("utf-8")
                break
            except UnicodeDecodeError as exc:
                if exc.reason == "unexpected end of data":
                    data = data[: exc.start]
                else:
                    text = data.decode("utf-8", errors="replace")
                    break
        else:
            text = ""
        return dict(text=text, next_offset=offset + len(data), total=self._size)

    def output(self, channel: str) -> str:
        stream = self._stderr if channel == "stderr" else self._stdout
        stream.seek(0)
        return stream.read().decode("utf-8", errors="replace")

    def _flush(self, channel: str) -> None:
        encoded = self._decoders[channel].decode(b"", final=True).encode("utf-8")
        self._log.seek(0, 2)
        self._log.write(encoded)
        self._size += len(encoded)
        self._output_changed.set()

    async def wait(self) -> int:
        await asyncio.shield(self._finished)
        return self.process.returncode or 0

    async def write(self, data: str) -> None:
        if self.status != "running":
            raise ValueError("Process is no longer accepting input")
        if self.master is not None:
            remaining = data.encode()
            while remaining:
                try:
                    written = os.write(self.master, remaining)
                    remaining = remaining[written:]
                except BlockingIOError:
                    await asyncio.sleep(0.01)
        elif self.process.stdin is not None:
            self.process.stdin.write(data.encode())
            await self.process.stdin.drain()

    def resize(self, cols: int, rows: int) -> None:
        if self.master is not None:
            import fcntl
            import termios

            fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

    async def _terminal_groups(self) -> set[int]:
        """Job-control shells put background jobs in separate groups. Include those
        descendants before terminating the shell so their PTY descriptors do not leak."""
        groups: set[int] = set()
        scanner = None
        try:
            scanner = await asyncio.create_subprocess_exec(
                "ps", "-axo", "pid=,ppid=,pgid=", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
            )
            output, _ = await asyncio.wait_for(scanner.communicate(), 1)
            children: dict[int, list[int]] = {}
            group_of: dict[int, int] = {}
            for line in output.decode().splitlines():
                pid, parent, group = map(int, line.split())
                children.setdefault(parent, []).append(pid)
                group_of[pid] = group
            pending = [self.process.pid]
            seen = set()
            while pending:
                pid = pending.pop()
                if pid in seen:
                    continue
                seen.add(pid)
                if pid in group_of and group_of[pid] > 0:
                    groups.add(group_of[pid])
                pending.extend(children.get(pid, []))
        except (OSError, ValueError, TimeoutError):
            if scanner is not None and scanner.returncode is None:
                scanner.kill()
                await scanner.wait()
        if self.master is not None:
            try:
                groups.add(os.tcgetpgrp(self.master))
            except OSError:
                pass
        return groups - {self.process.pid, 0, -1}

    async def stop(self, force: bool = False, grace: float = 2) -> None:
        if self._finished.done():
            return
        self.cancelled = True
        self.status = "stopping"
        self.stop_error = None
        try:
            sig = signal.SIGKILL if force else signal.SIGTERM
            if self.master is not None:
                for group in await self._terminal_groups():
                    try:
                        os.killpg(group, sig)
                    except (OSError, ProcessLookupError):
                        pass
            os.killpg(self.process.pid, sig)
        except ProcessLookupError:
            pass
        except PermissionError as signal_error:
            # A concurrent cancellation may already have killed and reaped this group.
            # macOS can report EPERM for that transient zombie group. Only suppress it
            # after the collector confirms actual exit and EOF, never for a live child.
            try:
                await asyncio.wait_for(asyncio.shield(self._finished), 0.1)
            except TimeoutError:
                self.stop_error = str(signal_error)
                raise signal_error from None
            return
        try:
            await asyncio.wait_for(asyncio.shield(self._finished), grace)
        except TimeoutError:
            # The UI can explicitly escalate an uncooperative process.
            pass

    def close(self) -> None:
        for stream in (self._log, self._stdout, self._stderr):
            stream.close()


class ProcessManager:
    def __init__(self) -> None:
        self._processes: dict[str, ManagedProcess] = {}

    async def start(
        self,
        command: str,
        cwd: Path | str,
        *,
        session_id: str | None = None,
        pty: bool = True,
        title: str | None = None,
        kind: Literal["command", "shell"] = "command",
    ) -> ManagedProcess:
        cancellation = current_cancellation.get()
        if cancellation is not None and cancellation.is_set():
            raise asyncio.CancelledError("Run was stopped before the process started")
        cwd = Path(cwd).expanduser().resolve(strict=True)
        if not cwd.is_dir() or not command.strip():
            raise ValueError("A command and an existing working directory are required")
        entry = ManagedProcess(command, cwd, session_id or current_session.get(), title, pty, kind)
        if pty and os.name == "posix":
            import pty as pseudo_terminal

            master, slave = pseudo_terminal.openpty()
            try:
                entry.process = await asyncio.create_subprocess_exec(
                    sys.executable,
                    "-c",
                    # Acquire a controlling terminal after setsid, before exec. A tiny
                    # helper avoids preexec_fn in a server that also has worker threads.
                    "import fcntl,termios,os,sys; fcntl.ioctl(0,termios.TIOCSCTTY,0); "
                    "os.execl('/bin/sh','sh','-c',sys.argv[1])",
                    command,
                    cwd=cwd,
                    stdin=slave,
                    stdout=slave,
                    stderr=slave,
                    start_new_session=True,
                    env={**os.environ, "TERM": "xterm-256color"},
                )
            except BaseException:
                os.close(master)
                entry.close()
                raise
            finally:
                os.close(slave)
            entry.master = master
            os.set_blocking(master, False)
            entry.resize(100, 30)
        else:
            entry.pty = False
            try:
                entry.process = await asyncio.create_subprocess_shell(
                    command,
                    cwd=cwd,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
            except BaseException:
                entry.close()
                raise
        self._processes[entry.id] = entry
        entry._finished = asyncio.create_task(self._collect(entry))
        if cancellation is not None and cancellation.is_set():
            await entry.stop()
            raise asyncio.CancelledError("Run stopped while the process was starting")
        return entry

    async def _collect(self, entry: ManagedProcess) -> None:
        if entry.master is not None:
            loop = asyncio.get_running_loop()
            drained = loop.create_future()
            master = entry.master

            def ready() -> None:
                try:
                    data = os.read(master, 65536)
                    if data:
                        entry._append(data)
                        return
                except BlockingIOError:
                    return
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        loop.call_exception_handler({"message": "Terminal read failed", "exception": exc})
                loop.remove_reader(master)
                if not drained.done():
                    drained.set_result(None)

            loop.add_reader(master, ready)
            await entry.process.wait()
            await drained
            loop.remove_reader(master)
            os.close(master)
            entry.master = None
            entry._flush("stdout")
        else:

            async def pipe(reader: asyncio.StreamReader | None, channel: str) -> None:
                assert reader is not None
                while data := await reader.read(65536):
                    entry._append(data, channel)
                entry._flush(channel)

            await asyncio.gather(pipe(entry.process.stdout, "stdout"), pipe(entry.process.stderr, "stderr"))
            await entry.process.wait()
        entry.status = "cancelled" if entry.cancelled else ("exited" if entry.process.returncode == 0 else "failed")
        entry._output_changed.set()

    async def close(self, process_id: str) -> None:
        entry = self.get(process_id)
        await entry.stop(force=True)
        if not entry._finished.done():
            raise TimeoutError("Process is still stopping")
        self._processes.pop(process_id, None)
        entry.close()

    def get(self, process_id: str) -> ManagedProcess:
        try:
            return self._processes[process_id]
        except KeyError as exc:
            raise LookupError(f"Unknown process: {process_id}") from exc

    def list(self, cwd: str | Path | None = None, session_id: str | None = None) -> list[ManagedProcess]:
        root = Path(cwd).expanduser().resolve() if cwd is not None else None
        return [
            p
            for p in self._processes.values()
            if (root is None or p.cwd == root) and (session_id is None or p.session_id == session_id)
        ]

    async def stop_owned(self, owner: str) -> None:
        """Kills the processes ``owner`` started that still run (a TF agent the user stopped)."""
        running = [p for p in self._processes.values() if p.owner == owner and not p._finished.done()]
        await asyncio.gather(*(p.stop(force=True) for p in running), return_exceptions=True)

    async def shutdown(self) -> None:
        await asyncio.gather(*(p.stop(force=True) for p in self._processes.values()))
        for process in self._processes.values():
            process.close()
        self._processes.clear()


_manager = ProcessManager()


def process_manager() -> ProcessManager:
    return _manager
