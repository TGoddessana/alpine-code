"""File hashes, git queries and the changes the map does not cover. Git trouble never fails a read."""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import time
from collections import OrderedDict
from collections.abc import Iterable
from pathlib import Path

from alpine_protocol import MapCoverage

from .map_io import LIMIT, inside, read_bytes
from .methods import MethodError

_TIMEOUT = 10
_TTL = 5.0  # seconds a list of changed files is reused
_MAX_HASHES = 50000
_MAX_UNCOVERED = 200
_MAX_TREE = 500
_SKIP_DIRS = frozenset({".git", "node_modules", "__pycache__", ".venv", ".alpine-code"})
_hashes: OrderedDict[tuple[str, int, int, bool], str] = OrderedDict()
_changes: dict[str, tuple[float, tuple, list[str]]] = {}
_heads: dict[str, tuple[float, str | None]] = {}
_bases: dict[str, tuple[tuple, str | None]] = {}


def is_git(root: Path) -> bool:
    return any((folder / ".git").exists() for folder in (root, *root.parents))


def git(root: Path, *args: str) -> str | None:
    """Output of ``git -C root ...``, or None when git is missing, fails or times out."""
    try:
        done = subprocess.run(
            ["git", "-C", str(root), *args],
            stdin=subprocess.DEVNULL,  # the stdio server reads fd 0; a child must never touch it
            capture_output=True,
            timeout=_TIMEOUT,
            check=False,
        )
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return done.stdout.decode("utf-8", errors="replace") if done.returncode == 0 else None


def head(root: Path) -> str | None:
    if not is_git(root):
        return None
    cached = _heads.get(str(root))
    if cached and time.monotonic() - cached[0] < _TTL:
        return cached[1]
    out = git(root, "rev-parse", "--verify", "-q", "HEAD")
    value = (out.strip() or None) if out else None
    _heads[str(root)] = (time.monotonic(), value)
    return value


def file_hash(root: Path, relative: str) -> str:
    """``git:<blob id>`` in a git project, ``sha256:<hex>`` otherwise; empty for a missing file."""
    try:
        path = inside(root, relative)
        st = path.stat()
        use_git = is_git(root)
        key = (str(path), st.st_mtime_ns, st.st_size, use_git)
        if key in _hashes:
            _hashes.move_to_end(key)
            return _hashes[key]
        data = read_bytes(path, 10 * LIMIT)
    except (OSError, ValueError, MethodError):
        return ""
    if use_git:
        digest = "git:" + hashlib.sha1(b"blob %d\0" % len(data) + data, usedforsecurity=False).hexdigest()
    else:
        digest = "sha256:" + hashlib.sha256(data).hexdigest()
    _hashes[key] = digest
    while len(_hashes) > _MAX_HASHES:
        _hashes.popitem(last=False)
    return digest


def path_hash(root: Path, relative: str) -> str:
    """A file's hash, or for a folder one hash over the files in it (bounded); empty when missing."""
    try:
        path = inside(root, relative)
    except MethodError:
        return ""
    if not path.is_dir():
        return file_hash(root, relative)
    parts: list[str] = []
    for current, dirs, files in os.walk(path):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP_DIRS)
        for name in sorted(files):
            child = Path(current, name).relative_to(root).as_posix()
            parts.append(f"{child}\0{file_hash(root, child)}")
            if len(parts) >= _MAX_TREE:
                break
        if len(parts) >= _MAX_TREE:
            break
    return "dir:" + hashlib.sha256("\n".join(parts).encode()).hexdigest()


def hashes(root: Path, paths: Iterable[str]) -> dict[str, str]:
    return {p: path_hash(root, p) for p in dict.fromkeys(paths)}


def normalize(path: str) -> str:
    """A project-relative POSIX path without ``./`` or a trailing slash."""
    return os.path.normpath(path).replace(os.sep, "/").strip("/") if path.strip() else ""


def _glob(pattern: str) -> re.Pattern[str] | None:
    """A gitignore-like pattern: ``**`` crosses folders, no ``/`` matches any name, a match covers what is below."""
    pattern = pattern.strip()
    if not pattern or pattern.startswith("#"):
        return None
    anchored = pattern.startswith("/") or "/" in pattern.rstrip("/")
    pattern = pattern.strip("/")
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
            continue
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
            continue
        out.append("[^/]*" if c == "*" else "[^/]" if c == "?" else re.escape(c))
        i += 1
    body = "".join(out)
    prefix = "" if anchored else "(?:.*/)?"
    return re.compile(f"^{prefix}{body}(?:/.*)?$")


def matches(patterns: Iterable[str], path: str) -> bool:
    return any(rx.match(path) for p in patterns if (rx := _glob(p)))


def _under(path: str, roots: set[str]) -> bool:
    parts = path.split("/")
    return any("/".join(parts[:n]) in roots for n in range(1, len(parts) + 1))


def reachable(root: Path, commit: str) -> bool:
    return git(root, "merge-base", "--is-ancestor", commit, "HEAD") is not None


def base_commit(root: Path, sync: str | None, current: str | None) -> str | None:
    """The commit changes are counted from: the sync commit, else the merge-base with the default branch."""
    key = (current, sync)
    cached = _bases.get(str(root))
    if cached and cached[0] == key:
        return cached[1]
    found = current
    if sync and reachable(root, sync):
        found = sync
    else:
        for ref in ("origin/HEAD", "main", "master"):
            out = git(root, "merge-base", "HEAD", ref)
            if out and out.strip():
                found = out.strip()
                break
    _bases[str(root)] = (key, found)
    return found


def _changed(root: Path, base: str | None, current: str | None) -> list[str]:
    """Files changed since ``base`` plus uncommitted and untracked ones, project-relative."""
    index = root / ".git" / "index"
    try:
        stamp = (current, base, index.stat().st_mtime_ns)
    except OSError:
        stamp = (current, base, 0)
    cached = _changes.get(str(root))
    if cached and cached[1] == stamp and time.monotonic() - cached[0] < _TTL:
        return cached[2]
    found: dict[str, None] = {}
    if base and current and base != current:
        out = git(root, "diff", "--name-only", "--relative", "-z", base, "HEAD")
        found.update((n, None) for n in (out or "").split("\0") if n)
    prefix = (git(root, "rev-parse", "--show-prefix") or "").strip()
    status = git(root, "status", "--porcelain", "-uall", "-z") or ""
    entries = status.split("\0")
    i = 0
    while i < len(entries):
        entry = entries[i]
        i += 1
        if len(entry) < 4:
            continue
        names = [entry[3:]]
        if entry[0] in "RC" or entry[1] in "RC":
            names.append(entries[i] if i < len(entries) else "")
            i += 1
        for name in names:
            if name.startswith(prefix) and name[len(prefix) :]:
                found[name[len(prefix) :]] = None
    result = [n for n in found if not (n == ".alpine-code" or n.startswith(".alpine-code/"))]
    _changes[str(root)] = (time.monotonic(), stamp, result)
    return result


def coverage(
    root: Path,
    sync: str | None,
    include: list[str],
    exclude: list[str],
    covered: Iterable[str],
) -> MapCoverage:
    if not is_git(root):
        return MapCoverage(git=False)
    current = head(root)
    if current is None and git(root, "rev-parse", "--git-dir") is None:
        return MapCoverage(git=False)
    base = base_commit(root, sync, current)
    roots = {c for p in covered if (c := normalize(p))}
    scope = {c for p in include if (c := normalize(p))}
    uncovered: list[str] = []
    count = out_of_scope = excluded = 0
    for path in _changed(root, base, current):
        if scope and not _under(path, scope):
            out_of_scope += 1
        elif matches(exclude, path):
            excluded += 1
        elif not _under(path, roots):
            count += 1
            if len(uncovered) < _MAX_UNCOVERED:
                uncovered.append(path)
    return MapCoverage(
        git=True,
        uncovered=sorted(uncovered),
        uncovered_count=count,
        out_of_scope=out_of_scope,
        excluded=excluded,
        since=base,
    )


def forget() -> None:
    """Drops cached change lists (tests, and after the app writes files itself)."""
    _changes.clear()
    _heads.clear()
    _bases.clear()
