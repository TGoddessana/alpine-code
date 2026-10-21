"""Shared file helpers for the product map modules: safe paths, atomic writes, cached JSON, images, local folder."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import tempfile
import threading
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from alpine_core import home_dir
from alpine_core.memory import project_key

from .methods import APP_ERROR, MethodError

LIMIT = 2 * 1024 * 1024
MAP_DIR = ".alpine-code/map"
# One lock serializes map work per process (handlers, the background replay runner).
lock = threading.RLock()


def folder(cwd: str) -> Path:
    root = Path(cwd).resolve()
    if not root.is_dir():
        raise MethodError(APP_ERROR, "Project folder does not exist", "not_a_folder")
    return root


def inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(root):
        raise MethodError(APP_ERROR, "Product map paths must stay inside the project", "invalid_flow_path")
    return path


def read_bytes(path: Path, limit: int = LIMIT) -> bytes:
    if not path.is_file():
        raise ValueError("Not a regular file")
    with path.open("rb") as file:
        data = file.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Product map file is too large")
    return data


# Parsed JSON files: path -> (mtime_ns, size, value). Only files that changed are read again.
_json_cache: dict[str, tuple[int, int, object]] = {}


def read_json(path: Path, limit: int = LIMIT) -> object | None:
    """The parsed JSON file, or None when it is missing or unreadable."""
    try:
        st = path.stat()
    except OSError:
        _json_cache.pop(str(path), None)
        return None
    cached = _json_cache.get(str(path))
    if cached and cached[:2] == (st.st_mtime_ns, st.st_size):
        return cached[2]
    try:
        value = json.loads(read_bytes(path, limit).decode("utf-8"))
    except (OSError, ValueError):
        return None
    _json_cache[str(path)] = (st.st_mtime_ns, st.st_size, value)
    return value


def lpath(root: Path, relative: str) -> Path:
    """The project path for a write, not resolved: Alpine never writes through a link."""
    parts = Path(relative).parts
    if Path(relative).is_absolute() or ".." in parts:
        raise MethodError(APP_ERROR, "Product map paths must stay inside the project", "invalid_flow_path")
    return root / relative


def guard(path: Path) -> None:
    """Refuses a write when any part of the path from ``.alpine-code`` down is a symlink."""
    parts = path.parts
    if ".alpine-code" not in parts:
        return
    for end in range(parts.index(".alpine-code") + 1, len(parts) + 1):
        if Path(*parts[:end]).is_symlink():
            raise MethodError(APP_ERROR, "Product map files cannot be links", "invalid_flow_path")


@contextlib.contextmanager
def file_lock(path: Path) -> Iterator[None]:
    """An exclusive lock on a sidecar file so processes do not overwrite each other's records. Best effort."""
    handle = None
    try:
        import fcntl

        path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(path.with_suffix(".lock"), "a")  # noqa: SIM115
        fcntl.flock(handle, fcntl.LOCK_EX)
    except (OSError, ImportError):
        if handle:
            handle.close()
        handle = None
    try:
        yield
    finally:
        if handle:
            handle.close()  # Closing releases the lock.


# Content hashes: path -> (mtime_ns, size, digest).
_digests: dict[str, tuple[int, int, str]] = {}


def file_digest(path: Path) -> str:
    try:
        st = path.stat()
    except OSError:
        return ""
    cached = _digests.get(str(path))
    if cached and cached[:2] == (st.st_mtime_ns, st.st_size):
        return cached[2]
    try:
        digest = sha(read_bytes(path))
    except (OSError, ValueError):
        return ""
    _digests[str(path)] = (st.st_mtime_ns, st.st_size, digest)
    return digest


def atomic(path: Path, value: str) -> None:
    guard(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix=".product-map-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            file.write(value)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)
    _json_cache.pop(str(path), None)


def dump(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha(text: str | bytes) -> str:
    return hashlib.sha256(text.encode() if isinstance(text, str) else text).hexdigest()


def iso(timestamp: float | None = None, *, precise: bool = False) -> str:
    """UTC time as ISO 8601; ``precise`` keeps milliseconds, for times compared with other stamps."""
    moment = datetime.now(UTC) if timestamp is None else datetime.fromtimestamp(timestamp, UTC)
    return moment.isoformat(timespec="milliseconds" if precise else "seconds").replace("+00:00", "Z")


def parse_time(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def local_dir(root: Path) -> Path:
    """Where this computer keeps what must not travel with the project (witness, approvals, replays, ...)."""
    return home_dir() / "projects" / project_key(root) / "product-map"


def image(root: Path, relative: str, budget: int, *, sketch: bool = False) -> tuple[str, int] | None:
    """A project-relative screenshot (with `sketch`, an SVG drawing instead) as a data URL plus its size, or None
    when unusable."""
    try:
        data = read_bytes(inside(root, relative), min(LIMIT, budget))
    except (OSError, ValueError, MethodError):
        return None  # An unavailable image never prevents viewing the map.
    mime = None
    if sketch:
        # A drawing is only ever an SVG, so a picture that looks like a capture cannot pass as one. Shown only
        # through <img>, where an SVG's scripts and outside links never run.
        if data.lstrip()[:5] in (b"<svg ", b"<svg>", b"<?xml"):
            mime = "image/svg+xml"
    elif data.startswith(b"\x89PNG\r\n\x1a\n"):
        mime = "image/png"
    elif data.startswith(b"\xff\xd8\xff"):
        mime = "image/jpeg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        mime = "image/webp"
    if mime is None:
        return None
    return f"data:{mime};base64,{base64.b64encode(data).decode()}", len(data)
