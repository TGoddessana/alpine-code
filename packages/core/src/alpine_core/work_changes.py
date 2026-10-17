"""Observed workspace changes, independent of approval previews and of the tool doing the writing.

The baseline is the user's working file, not HEAD. Only changed baselines are persisted. Scans use
Git's tracked + untracked, nonignored files (ripgrep in folders without Git); explicit edit/write
paths are included even when ignored or outside the root. Symlinks and secret env files are not scanned.
Changes made concurrently by a person or another session are observations, not claims of authorship.
"""

from __future__ import annotations

import copy
import difflib
import hashlib
import subprocess
import threading
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from typing import Any, TypeVar, cast

from .home import home_dir
from .tools._common import RG_EXCLUDES, Workspace
from .tools.ripgrep import RipgrepUnavailable, rg_path

MAX_TEXT_BYTES = 1_000_000
FileState = dict[str, Any] | None


def _state(path: Path) -> FileState:
    if not path.exists():
        return None
    if not path.is_file() or path.is_symlink():
        return None
    # Large/binary files are detected but never represented as a misleading text diff.
    digest = hashlib.sha256()
    data = bytearray()
    with path.open("rb") as stream:
        while chunk := stream.read(65536):
            digest.update(chunk)
            if len(data) <= MAX_TEXT_BYTES:
                data.extend(chunk)
    text = None
    if len(data) <= MAX_TEXT_BYTES and b"\0" not in data:
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            pass
    return {"digest": digest.hexdigest(), "text": text}


F = TypeVar("F", bound=Callable[..., Any])


def _locked(method: F) -> F:
    @wraps(method)
    def call(self, *args, **kwargs):
        with self._lock:
            return method(self, *args, **kwargs)

    return cast(F, call)


class WorkChanges:
    def __init__(
        self, workspace: Workspace, baseline: dict[str, FileState] | None = None, history: dict[str, Any] | None = None
    ) -> None:
        self._lock = threading.RLock()
        self.workspace = workspace
        self._home = home_dir().resolve()
        self.baseline = dict(baseline or {})
        self._previous: dict[str, FileState] | None = None
        self._explicit: set[str] = set(self.baseline)
        self._cache: dict[str, tuple[tuple[int, ...], FileState]] = {}
        self.history = copy.deepcopy(history or {"requests": [], "blobs": {}})
        self._request: dict[str, Any] | None = None
        self._request_before: dict[str, FileState] = {}

    @_locked
    def saved_state(self) -> tuple[dict[str, FileState], dict[str, Any]]:
        return copy.deepcopy(self.baseline), copy.deepcopy(self.history)

    @_locked
    def clear(self) -> None:
        self.history = {"requests": [], "blobs": {}}
        self._request = None
        self.baseline.clear()
        self._explicit.clear()
        self.begin()

    @_locked
    def begin(self, label: str | None = None) -> None:
        self._request = None
        self._previous = None
        self._cache.clear()
        if label is not None:
            before = self._scan()
            self._previous = before
            self._request_before = dict(before)
            self._request = {
                "id": uuid.uuid4().hex,
                "label": label[:160],
                "created_at": datetime.now(timezone.utc).isoformat(),
                "status": "running",
                "before": {key: self._remember(state) for key, state in sorted(before.items())},
                "after": {key: self._remember(state) for key, state in sorted(before.items())},
            }
            self.history["requests"].append(self._request)

    @_locked
    def end(self, status: str) -> None:
        if self._request is not None:
            self._request["status"] = status
            self._request = None
        # Retain the latest 100 requests and blobs still used by them. The session baseline
        # stays separately available for a cumulative comparison after old requests expire.
        self.history["requests"] = self.history["requests"][-100:]
        used = {
            digest
            for request in self.history["requests"]
            for side in ("before", "after")
            for digest in request[side].values()
            if digest is not None
        }
        used.update(digest for digest in self.history.get("latest", {}).values() if digest is not None)
        self.history["blobs"] = {digest: state for digest, state in self.history["blobs"].items() if digest in used}

    def _remember(self, state: FileState) -> str | None:
        if state is None:
            return None
        self.history["blobs"].setdefault(state["digest"], dict(state))
        return state["digest"]

    def _checkpoint(self, current: dict[str, FileState]) -> None:
        if self._request is None:
            return
        before = self._request_before
        keys = before.keys() | current.keys()
        self._request["before"] = {key: self._remember(before.get(key)) for key in sorted(keys)}
        self._request["after"] = {key: self._remember(current.get(key)) for key in sorted(keys)}

    @_locked
    def start(self, name: str, args: dict[str, Any]) -> None:
        if self._previous is None:
            self._previous = self._scan()
        if name in ("edit", "write") and isinstance(args.get("path"), str):
            path = self.workspace.resolve(args["path"]).resolve()
            key = self.workspace.display(path)
            if self._safe(key) and key not in self._explicit:
                self._explicit.add(key)
                self._previous.setdefault(key, _state(path))
                if self._request is not None:
                    self._request_before.setdefault(key, self._previous[key])
                    digest = self._remember(self._request_before[key])
                    self._request["before"].setdefault(key, digest)
                    self._request["after"].setdefault(key, digest)

    @_locked
    def finish(self) -> list[dict[str, Any]] | None:
        if self._previous is None:
            return None  # denied without running
        current = self._scan()
        for key in self._previous.keys() | current.keys():
            before, after = self._previous.get(key), current.get(key)
            if before != after and key not in self.baseline:
                self.baseline[key] = before
                self._explicit.add(key)
        self._previous = current
        self._checkpoint(current)
        if self._request is not None:
            self.history["latest"] = {key: self._remember(current.get(key)) for key in self.baseline}
        return compare_states(self.baseline, current)

    def _safe(self, key: str) -> bool:
        if self.workspace.resolve(key).resolve().is_relative_to(self._home):
            return False  # never snapshot the recorder itself (even with a home inside the workspace)
        return not any(part == ".git" or part == ".env" or part.startswith(".env.") for part in Path(key).parts)

    def _scan(self) -> dict[str, FileState]:
        root = self.workspace.root
        try:
            found = subprocess.run(
                ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                cwd=root,
                capture_output=True,
                timeout=30,
            )
        except FileNotFoundError:
            found = None
        if found is not None and found.returncode == 0:
            keys = set(found.stdout.decode("utf-8", errors="surrogateescape").split("\0"))
        else:
            try:
                found = subprocess.run(
                    [rg_path(), "--files", "--hidden", "--null", *RG_EXCLUDES],
                    cwd=root,
                    capture_output=True,
                    timeout=30,
                )
            except RipgrepUnavailable as e:
                raise OSError("Cannot collect actual changes: ripgrep is unavailable") from e
            if found.returncode not in (0, 1):
                raise OSError("Cannot collect actual changes: file enumeration failed")
            keys = set(found.stdout.decode("utf-8", errors="surrogateescape").split("\0"))
        keys |= self._explicit
        # Enumeration can drop existing files after ignore rules change. Keep checking
        # previously observed paths on disk so omission is not mistaken for deletion.
        keys |= (self._previous or {}).keys()
        result = {}
        for key in keys:
            if not key or not self._safe(key):
                continue
            path = self.workspace.resolve(key)
            try:
                stat = path.lstat()
            except FileNotFoundError:
                result[key] = None
                self._cache.pop(key, None)
                continue
            signature = (stat.st_ino, stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_mode)
            cached = self._cache.get(key)
            value = cached[1] if cached and cached[0] == signature else _state(path)
            self._cache[key] = (signature, value)
            result[key] = value
        return result


def compare_states(before_states: dict[str, FileState], after_states: dict[str, FileState]) -> list[dict[str, Any]]:
    changes = []
    for key, before in sorted(before_states.items()):
        after = after_states.get(key)
        if before == after:
            continue
        old, new = (before or {}).get("text", ""), (after or {}).get("text", "")
        lines = None
        if old is not None and new is not None:
            unified = list(
                difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True), lineterm="")
            )[2:]
            lines = []
            for line in unified:
                lines.append(line.removesuffix("\n"))
                if line.startswith(("+", "-", " ")) and not line.endswith("\n"):
                    lines.append("\\ No newline at end of file")
        changes.append(
            {
                "path": key,
                "added": sum(line.startswith("+") for line in lines or []),
                "removed": sum(line.startswith("-") for line in lines or []),
                "diff": lines,
            }
        )
    return changes


def checkpoint_changes(
    history: dict[str, Any], baseline: dict[str, FileState], request_id: str | None = None
) -> list[dict[str, Any]]:
    """Compare immutable stored versions; never substitute today's filesystem for a past request."""
    requests = history.get("requests", [])
    blobs = history.get("blobs", {})

    def resolve(versions: dict[str, str | None]) -> dict[str, FileState]:
        try:
            return {key: blobs[digest] if digest else None for key, digest in versions.items()}
        except KeyError as exc:
            raise LookupError("Saved file snapshot is unavailable") from exc

    if request_id is not None:
        request = next((r for r in requests if r["id"] == request_id), None)
        if request is None:
            raise LookupError("Checkpoint is not available")
        before = resolve(request["before"])
        after = resolve(request["after"])
        return compare_states(before, after)
    # The latest recorded version of each path, over all retained requests. Session-only
    # final versions below also retain files last touched by a request that has expired.
    after = resolve(history.get("latest", {}))
    return compare_states(baseline, after) if after else []
