"""Observed workspace changes, independent of approval previews and of the tool doing the writing.

The baseline is the user's working file, not HEAD. Only changed baselines are persisted. Scans use
Git's tracked + untracked, nonignored files (ripgrep in folders without Git); explicit edit/write
paths are included even when ignored or outside the root. Symlinks and secret env files are not scanned.
Changes made concurrently by a person or another session are observations, not claims of authorship.
"""

from __future__ import annotations

import difflib
import hashlib
import subprocess
from pathlib import Path
from typing import Any

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


class WorkChanges:
    def __init__(self, workspace: Workspace, baseline: dict[str, FileState] | None = None) -> None:
        self.workspace = workspace
        self._home = home_dir().resolve()
        self.baseline = dict(baseline or {})
        self._previous: dict[str, FileState] | None = None
        self._explicit: set[str] = set(self.baseline)
        self._cache: dict[str, tuple[tuple[int, ...], FileState]] = {}

    def clear(self) -> None:
        self.baseline.clear()
        self._explicit.clear()
        self.begin()

    def begin(self) -> None:
        self._previous = None  # defer an expensive scan until a tool actually runs
        self._cache.clear()

    def start(self, name: str, args: dict[str, Any]) -> None:
        if self._previous is None:
            self._previous = self._scan()
        if name in ("edit", "write") and isinstance(args.get("path"), str):
            path = self.workspace.resolve(args["path"]).resolve()
            key = self.workspace.display(path)
            if self._safe(key) and key not in self._explicit:
                self._explicit.add(key)
                self._previous[key] = _state(path)

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
        changes = []
        for key, before in sorted(self.baseline.items()):
            after = current.get(key)
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
