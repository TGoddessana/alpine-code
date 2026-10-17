"""Cooperating writers lock the canonical path, across tools, sessions and processes."""

from __future__ import annotations

import fcntl
import hashlib
import os
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from alpineagents import ToolError


@contextmanager
def file_lock(path: Path) -> Iterator[Path]:
    target = path.resolve()
    folder = Path(tempfile.gettempdir()) / f"alpine-code-writes-{os.getuid()}"
    folder.mkdir(mode=0o700, exist_ok=True)
    key = hashlib.sha256(os.fsencode(target)).hexdigest()
    with (folder / key).open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield target
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def atomic_write(path: Path, content: str, before: bytes | None) -> None:
    """Keep the old file intact if staging fails; refuse an observed external change."""
    if path.exists() and not os.access(path, os.W_OK):
        raise PermissionError(f"Permission denied: {path}")
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    staged = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content.encode("utf-8"))
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            staged.chmod(path.stat().st_mode & 0o777)
        current = path.read_bytes() if path.exists() else None
        if current != before:
            raise ToolError(f"{path} changed while being written. Read it again before retrying")
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)
