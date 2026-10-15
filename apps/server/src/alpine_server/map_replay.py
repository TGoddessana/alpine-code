"""Replays: approved commands that re-run a check without a model, one background thread per project."""

from __future__ import annotations

import os
import signal
import subprocess
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from alpine_protocol import FlowReplay

from .map_evidence import contains
from .map_io import atomic, dump, file_lock, inside, iso, local_dir, lock, read_json, sha
from .methods import MethodError

TIMEOUT = 600
_TAIL = 4000


@dataclass(frozen=True)
class Job:
    node_id: str
    title: str
    condition_id: str
    check_id: str
    command: str
    cwd: str
    key: str
    expect: list[str]
    passes: bool
    """The check being replayed passed, so a clean exit is the same result."""
    hashes: dict[str, str] = field(default_factory=dict)

    @property
    def slot(self) -> str:
        return f"{self.node_id}/{self.condition_id}"


def command_key(replay: FlowReplay) -> str:
    """What the user approves: the exact command and folder."""
    return sha(f"{replay.cwd}\0{replay.command}")


def _read(root: Path, name: str) -> dict:
    value = read_json(local_dir(root) / name)
    return dict(value) if isinstance(value, dict) else {}


def approvals(root: Path) -> dict[str, str]:
    return {k: v for k, v in _read(root, "approvals.json").items() if isinstance(v, str)}


def records(root: Path) -> dict[str, dict]:
    return {k: v for k, v in _read(root, "replays.json").items() if isinstance(v, dict)}


def set_approval(root: Path, slot: str, key: str | None) -> None:
    path = local_dir(root) / "approvals.json"
    with file_lock(path):
        stored = approvals(root)
        if key is None:
            stored.pop(slot, None)
        else:
            stored[slot] = key
        atomic(path, dump(stored))


def _save_record(root: Path, slot: str, record: dict) -> None:
    path = local_dir(root) / "replays.json"
    with file_lock(path):
        stored = records(root)
        stored[slot] = record
        atomic(path, dump(stored))


_threads: dict[str, threading.Thread] = {}
_queued: dict[str, set[str]] = {}


def running(root: Path) -> set[str]:
    return set(_queued.get(str(root), set()))


def busy(root: Path) -> bool:
    thread = _threads.get(str(root))
    return bool(thread and thread.is_alive())


def _kill(group: int) -> None:
    try:
        os.killpg(group, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass


def run(root: Path, job: Job) -> dict:
    """Runs one replay and returns its record. Takes no lock: it may take minutes.

    Output goes to a temporary file, not a pipe, so a background process that keeps running cannot hold us up; the
    whole process group is killed when the command ends or times out.
    """
    output, code = "", -1
    try:
        folder = inside(root, job.cwd)
        with tempfile.TemporaryFile() as sink:
            proc = subprocess.Popen(
                ["bash", "-c", job.command],
                cwd=folder,
                stdin=subprocess.DEVNULL,  # the stdio server reads fd 0
                stdout=sink,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            note = ""
            try:
                code = proc.wait(timeout=TIMEOUT)
            except subprocess.TimeoutExpired:
                note = "\n(timed out)"
            _kill(proc.pid)
            proc.wait()
            sink.seek(0)
            output = sink.read().decode("utf-8", errors="replace") + note
    except (OSError, ValueError, MethodError) as exc:
        output = str(exc)
    same = (code == 0) == job.passes and all(contains(output, e) for e in job.expect)
    return {
        "checkId": job.check_id,
        "key": job.key,
        "at": iso(),
        "same": same,
        "output": output[-_TAIL:],
        "hashes": job.hashes,
    }


def start(root: Path, jobs: list[Job], done: Callable[[Job, dict], None], stop: Callable[[], bool]) -> bool:
    """Queues replays on this project's thread. False when one is already running or there is nothing to do."""
    if not jobs or busy(root):
        return False
    _queued[str(root)] = {job.slot for job in jobs}

    def work() -> None:
        try:
            for job in jobs:
                if stop():  # a session became live: leave the rest for the next pause
                    break
                record = run(root, job)
                with lock:
                    _save_record(root, job.slot, record)
                    _queued.get(str(root), set()).discard(job.slot)
                    done(job, record)
        except Exception:  # a failed replay must never take the app down; the next trigger tries again
            pass
        finally:
            with lock:
                _queued.pop(str(root), None)

    thread = threading.Thread(target=work, name="map-replay", daemon=True)
    _threads[str(root)] = thread
    thread.start()
    return True


def join(root: Path, timeout: float = 30) -> None:
    thread = _threads.get(str(root))
    if thread:
        thread.join(timeout)
