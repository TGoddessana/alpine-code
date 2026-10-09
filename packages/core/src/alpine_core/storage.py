"""Where a session is kept: the screen record (``SessionLog``) beside alpineagents' model memory (``Store``).

A session is saved in two parts under one id (the alpineagents State id):

- model memory: an alpineagents ``Store``, exactly as alpineagents writes it (``<home>/states/<id>/``)
- screen record: a ``SessionLog``, the session's info and its finished items in ``seq`` order
  (``<home>/sessions/<id>/``)

The two live in sibling folders because alpineagents' ``FileStore`` creates ``<root>/<id>/`` by renaming a staging
folder into place and refuses an id that already exists, so both cannot own one folder. Frontends only call
``file_storage``; they never import alpineagents.
"""

from __future__ import annotations

import dataclasses
import json
import os
import shutil
import threading
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol, runtime_checkable

from alpineagents import FileStore, Store

from .events import UsageInfo
from .home import home_dir

__all__ = [
    "Activity",
    "ActivityKind",
    "SessionInfo",
    "SessionStatus",
    "Record",
    "SessionLog",
    "FileSessionLog",
    "Storage",
    "file_storage",
]

SessionStatus = Literal["idle", "running", "waiting", "failed"]
"""``waiting`` means an approval is active; ``failed`` means the last run failed, until the next message."""

ActivityKind = Literal["thinking", "writing", "running_tool", "reviewing", "waiting_approval", "compacting"]


@dataclass(frozen=True)
class Activity:
    """What a running session is doing right now."""

    kind: ActivityKind
    tool_name: str | None = None
    """The tool of ``running_tool`` (the latest one, if several run together); ``None`` otherwise."""
    since: str = ""
    """UTC, ISO 8601: when the session started doing this."""


Record = tuple[int, dict[str, Any]]
"""One stored item: its ``seq`` and the item as a JSON dict (opaque here)."""

_INFO = "info.json"
_ITEMS = "items.jsonl"


@dataclass(frozen=True)
class SessionInfo:
    """What the session list shows about one session. ``updated_at`` orders the list."""

    id: str
    """The session id, which is also the alpineagents State id."""
    title: str
    cwd: str
    """The working directory the session was created for; the rail groups sessions by it."""
    model: str
    mode: str
    """The permission mode, as ``Mode``'s value."""
    status: SessionStatus = "idle"
    created_at: str = ""
    """UTC, ISO 8601 (``2026-09-30T12:00:00+00:00``). Strings sort in time order and cross the wire unchanged."""
    updated_at: str = ""
    """UTC, ISO 8601, same format as ``created_at``."""
    usage: UsageInfo = field(default_factory=UsageInfo)
    context_used: int = 0
    """Tokens of context in use, as of the last request."""
    context_window: int | None = None
    """The model's context window in tokens, or ``None`` if unknown."""
    activity: Activity | None = None
    """What the session is doing, ``None`` when idle. Live only: it is not restored from the log."""
    run_started_at: str | None = None
    """UTC, ISO 8601: when the current run started, ``None`` when idle."""
    run_usage: UsageInfo | None = None
    """Usage since the current run started, ``None`` when idle."""
    agent: str | None = None
    """The id of the agent the session works with; ``None`` when it was made without agents."""
    agent_applied: dict[str, Any] | None = None
    """``{"model", "instructions", "tools"}`` of the agent as the session last applied it, to tell what an edit
    changed. Core only, not on the wire."""
    last_seq: int = 0
    """The highest event ``seq`` emitted when the info was saved, so ``seq`` keeps growing across restarts. Not on the
    wire."""

    def to_dict(self) -> dict[str, Any]:
        """A JSON-ready dict, snake_case."""
        return {
            "id": self.id,
            "title": self.title,
            "cwd": self.cwd,
            "model": self.model,
            "mode": self.mode,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "usage": _usage_to_dict(self.usage),
            "context_used": self.context_used,
            "context_window": self.context_window,
            "activity": None
            if self.activity is None
            else {"kind": self.activity.kind, "tool_name": self.activity.tool_name, "since": self.activity.since},
            "run_started_at": self.run_started_at,
            "run_usage": None if self.run_usage is None else _usage_to_dict(self.run_usage),
            "agent": self.agent,
            "agent_applied": self.agent_applied,
            "last_seq": self.last_seq,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> SessionInfo:
        """The inverse of ``to_dict``. Missing optional fields get their defaults."""
        activity = data.get("activity")
        run_usage = data.get("run_usage")
        return cls(
            id=data["id"],
            title=data.get("title", ""),
            cwd=data.get("cwd", ""),
            model=data.get("model", ""),
            mode=data.get("mode", ""),
            status=data.get("status", "idle"),
            created_at=data.get("created_at", ""),
            updated_at=data.get("updated_at", ""),
            usage=_usage_from_dict(data.get("usage") or {}),
            context_used=data.get("context_used", 0),
            context_window=data.get("context_window"),
            activity=None
            if activity is None
            else Activity(activity["kind"], activity.get("tool_name"), activity.get("since", "")),
            run_started_at=data.get("run_started_at"),
            run_usage=None if run_usage is None else _usage_from_dict(run_usage),
            agent=data.get("agent", data.get("profile")),
            agent_applied=data.get("agent_applied"),
            last_seq=data.get("last_seq", 0),
        )


def _usage_to_dict(usage: UsageInfo) -> dict[str, Any]:
    return {
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "cache_read_tokens": usage.cache_read_tokens,
        "cache_write_tokens": usage.cache_write_tokens,
        "requests": usage.requests,
        "cost": usage.cost,
    }


def _usage_from_dict(data: Mapping[str, Any]) -> UsageInfo:
    return UsageInfo(
        input_tokens=data.get("input_tokens", 0),
        output_tokens=data.get("output_tokens", 0),
        cache_read_tokens=data.get("cache_read_tokens", 0),
        cache_write_tokens=data.get("cache_write_tokens", 0),
        requests=data.get("requests", 0),
        cost=data.get("cost"),
    )


@runtime_checkable
class SessionLog(Protocol):
    """The screen record of sessions: info plus finished items in ``seq`` order.

    Same contract as alpineagents' ``Store`` entries, so the implementation can be swapped later. Every method
    that names a session raises ``LookupError`` if it does not exist, except ``delete``, which does nothing.
    """

    def create(self, info: SessionInfo) -> None:
        """Adds a new, empty session. Raises ``ValueError`` if the id exists."""
        ...

    def append(self, session_id: str, records: Sequence[Record]) -> None:
        """Adds items. A record whose ``seq`` is already stored is skipped, so writing a batch twice is harmless."""
        ...

    def update(self, info: SessionInfo) -> None:
        """Replaces the session's info."""
        ...

    def read(self, session_id: str) -> tuple[SessionInfo, list[Record]]:
        """The info and every stored item, in ``seq`` order."""
        ...

    def list(self) -> list[SessionInfo]:
        """Every session's info, most recently updated first."""
        ...

    def delete(self, session_id: str) -> None:
        """Removes a session. Does nothing if it does not exist."""
        ...


class FileSessionLog:
    """A ``SessionLog`` in ``<root>/<id>/``: ``info.json`` (replaced atomically) and ``items.jsonl`` (append-only,
    one ``{"seq": n, "item": {...}}`` per line, flushed to disk after each append).

    A crash can leave a half-written last line. Reading ignores it, and the next append cuts it off first.
    One process writes a session at a time.

    Args:
        root: The folder holding one folder per session; created on the first write.
    """

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self._root = Path(root)
        self._lock = threading.Lock()
        # Per session id: the highest seq stored, read from the file once per process.
        self._last: dict[str, int] = {}

    def __repr__(self) -> str:
        return f"FileSessionLog({str(self._root)!r})"

    def create(self, info: SessionInfo) -> None:
        folder = self._folder(info.id)
        with self._lock:
            self._root.mkdir(parents=True, exist_ok=True)
            staging = self._root / f".new-{info.id}-{uuid.uuid4().hex}"
            os.mkdir(staging, 0o700)
            try:
                _write_info(staging / _INFO, info)
                _write(staging / _ITEMS, b"", append=False)
                if folder.exists():
                    raise ValueError(f"a session with id {info.id!r} already exists in {self!r}")
                try:
                    os.rename(staging, folder)
                except OSError:
                    if folder.exists():
                        raise ValueError(f"a session with id {info.id!r} already exists in {self!r}") from None
                    raise
            except BaseException:
                shutil.rmtree(staging, ignore_errors=True)
                raise
            self._last[info.id] = -1

    def append(self, session_id: str, records: Sequence[Record]) -> None:
        folder = self._existing(session_id)
        with self._lock:
            if session_id not in self._last:
                self._last[session_id] = _repair(folder / _ITEMS)
            last = self._last[session_id]
            fresh: list[Record] = []
            for seq, item in sorted(records, key=lambda record: record[0]):
                if seq > last and (not fresh or seq != fresh[-1][0]):
                    fresh.append((seq, item))
            if not fresh:
                return
            data = "".join(_dump({"seq": seq, "item": item}) + "\n" for seq, item in fresh).encode("utf-8")
            _write(folder / _ITEMS, data, append=True)
            self._last[session_id] = fresh[-1][0]

    def update(self, info: SessionInfo) -> None:
        folder = self._existing(info.id)
        with self._lock:
            staging = folder / f".{_INFO}.{uuid.uuid4().hex}"
            try:
                _write_info(staging, info)
                os.replace(staging, folder / _INFO)
            except BaseException:
                staging.unlink(missing_ok=True)
                raise

    def read(self, session_id: str) -> tuple[SessionInfo, list[Record]]:
        folder = self._existing(session_id)
        with self._lock:
            info = _read_info(folder)
            records = _read_records(folder / _ITEMS)
        if info is None:
            raise LookupError(f"no session with id {session_id!r} in {self!r}")
        return info, records

    def list(self) -> list[SessionInfo]:
        if not self._root.is_dir():
            return []
        found = []
        with self._lock:
            for folder in self._root.iterdir():
                if folder.name.startswith(".") or not folder.is_dir():
                    continue
                info = _read_info(folder)
                if info is not None:
                    found.append(info)
        found.sort(key=lambda info: info.updated_at, reverse=True)
        return found

    def delete(self, session_id: str) -> None:
        folder = self._folder(session_id)
        with self._lock:
            self._last.pop(session_id, None)
            if not folder.is_dir():
                return
            # Rename first, so a half-deleted folder never looks like a session.
            doomed = self._root / f".deleted-{session_id}-{uuid.uuid4().hex}"
            os.rename(folder, doomed)
        shutil.rmtree(doomed, ignore_errors=True)

    # ------------------------------------------------------------ internal

    def _folder(self, session_id: str) -> Path:
        if (
            not session_id
            or session_id.startswith(".")
            or "/" in session_id
            or "\\" in session_id
            or "\0" in session_id
        ):
            raise ValueError(f"not a valid session id: {session_id!r}")
        return self._root / session_id

    def _existing(self, session_id: str) -> Path:
        folder = self._folder(session_id)
        if not (folder / _INFO).is_file():
            self._last.pop(session_id, None)
            raise LookupError(f"no session with id {session_id!r} in {self!r}")
        return folder


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _write(path: Path, data: bytes, *, append: bool) -> None:
    """Writes bytes, readable by the owner only, and flushes them to disk."""
    flags = os.O_WRONLY | os.O_CREAT | (os.O_APPEND if append else os.O_TRUNC)
    fd = os.open(path, flags, 0o600)
    try:
        view = memoryview(data)
        while view:
            view = view[os.write(fd, view) :]
        os.fsync(fd)
    finally:
        os.close(fd)


def _write_info(path: Path, info: SessionInfo) -> None:
    # The live fields describe a running process, so a saved session never has them.
    info = dataclasses.replace(info, activity=None, run_started_at=None, run_usage=None)
    _write(path, _dump(info.to_dict()).encode("utf-8"), append=False)


def _read_info(folder: Path) -> SessionInfo | None:
    try:
        return SessionInfo.from_dict(json.loads((folder / _INFO).read_text("utf-8")))
    except (OSError, ValueError, KeyError):
        return None


def _parse(line: bytes) -> Record | None:
    try:
        entry = json.loads(line)
        return int(entry["seq"]), entry["item"]
    except (ValueError, KeyError, TypeError):
        return None


def _read_records(path: Path) -> list[Record]:
    """The complete records of a file; a torn last line (a crash mid-write) is ignored."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return []
    records = []
    for line in data.split(b"\n"):
        if line.strip() and (record := _parse(line)) is not None:
            records.append(record)
    return records


def _repair(path: Path) -> int:
    """Cuts a torn last line off the file, and returns the highest ``seq`` stored (-1 if none)."""
    try:
        data = path.read_bytes()
    except FileNotFoundError:
        return -1
    keep = 0
    last = -1
    for line in data.splitlines(keepends=True):
        if not line.endswith(b"\n"):
            break
        if line.strip():
            record = _parse(line)
            if record is None:
                break
            last = max(last, record[0])
        keep += len(line)
    if keep < len(data):
        with open(path, "r+b") as file:
            file.truncate(keep)
            os.fsync(file.fileno())
    return last


@dataclass(frozen=True)
class Storage:
    """Both parts of a session's storage. Frontends get one from ``file_storage`` and hand it to ``Session``."""

    log: SessionLog
    """The screen record: info and finished items."""
    states: Store
    """Model memory: alpineagents' Store, keyed by the same session id."""


def file_storage(home: Path | None = None) -> Storage:
    """Storage in the home folder: ``<home>/sessions/`` for the log, ``<home>/states/`` for model memory.

    Args:
        home: The home folder; defaults to ``home_dir()`` (``$ALPINE_CODE_HOME``, or ``~/.alpine-code``).
    """
    root = home if home is not None else home_dir()
    return Storage(log=FileSessionLog(root / "sessions"), states=FileStore(root / "states"))
