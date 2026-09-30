"""The little git the app needs outside a session: what the branch changes, its pull request, and cloning."""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

#: ``owner/repo`` means GitHub, as ``gh`` reads it.
_SHORTHAND = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")


class CloneError(Exception):
    """git could not clone. The message is git's own last line."""


def current_branch(folder: Path) -> str | None:
    """The checked-out branch, or ``None`` outside a repository or on a detached HEAD."""
    try:
        result = subprocess.run(
            ["git", "-C", str(folder), "symbolic-ref", "--quiet", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() or None


@dataclass(frozen=True)
class PullRequest:
    number: int
    url: str
    checks: Literal["passing", "failing", "pending"] | None
    """CI on its last commit; ``None`` when it has no checks."""


@dataclass(frozen=True)
class GitStatus:
    branch: str | None
    """``None`` on a detached HEAD."""
    added: int
    deleted: int
    """Lines this branch changes that the default branch does not have yet, uncommitted work and new files included.
    On the default branch itself that is what is not pushed or not committed."""


#: Untracked files bigger than this are not counted (and are not read).
_MAX_COUNTED = 1_000_000


def status(folder: Path) -> GitStatus | None:
    """The branch and its changes, or ``None`` outside a repository."""
    if _git(folder, "rev-parse", "--is-inside-work-tree") != "true":
        return None
    base = _base(folder)
    added = deleted = 0
    for line in (_git(folder, "diff", "--numstat", base) or "").splitlines():
        plus, minus, _ = line.split("\t", 2)
        if plus != "-":  # binary files show "-"
            added, deleted = added + int(plus), deleted + int(minus)
    for name in (_git(folder, "ls-files", "--others", "--exclude-standard", "-z") or "").split("\0"):
        path = folder / name
        if name and path.is_file() and path.stat().st_size <= _MAX_COUNTED:
            data = path.read_bytes()
            if b"\0" not in data:
                added += data.count(b"\n") + (0 if data.endswith(b"\n") or not data else 1)
    return GitStatus(current_branch(folder), added, deleted)


def _base(folder: Path) -> str:
    """Where the branch left the default branch (``origin/HEAD``, else ``main`` or ``master``); ``HEAD`` if none."""
    default = _git(folder, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    for ref in (default, "main", "master"):
        if ref and (base := _git(folder, "merge-base", "HEAD", ref)):
            return base
    return "HEAD" if _git(folder, "rev-parse", "--verify", "--quiet", "HEAD") else _EMPTY_TREE


#: What an unborn branch (no commit yet) is compared with.
_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"


def pull_request(folder: Path) -> PullRequest | None:
    """The open pull request of the checked-out branch, through ``gh``. ``None`` without one, or without ``gh``."""
    try:
        result = subprocess.run(
            ["gh", "pr", "view", "--json", "number,url,state,statusCheckRollup"],
            cwd=folder,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    data = json.loads(result.stdout)
    if data.get("state") != "OPEN":
        return None
    return PullRequest(data["number"], data["url"], _checks(data.get("statusCheckRollup") or []))


def _checks(rollup: list[dict[str, str]]) -> Literal["passing", "failing", "pending"] | None:
    # Check runs carry status + conclusion; commit statuses carry a state.
    failed = {"FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"}
    if not rollup:
        return None
    if any(c.get("conclusion") in failed or c.get("state") in failed for c in rollup):
        return "failing"
    if any(c.get("status", "COMPLETED") != "COMPLETED" or c.get("state") in {"PENDING", "EXPECTED"} for c in rollup):
        return "pending"
    return "passing"


def _git(folder: Path, *args: str) -> str | None:
    """git's output, stripped, or ``None`` when it fails."""
    try:
        result = subprocess.run(["git", "-C", str(folder), *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


def clone_url(address: str) -> str:
    """What git clones for what the user typed: ``owner/repo`` and ``github.com/owner/repo`` become GitHub URLs."""
    address = address.strip()
    if _SHORTHAND.fullmatch(address):
        return f"https://github.com/{address}.git"
    if address.startswith("github.com/"):
        return f"https://{address}"
    return address


def repo_name(address: str) -> str:
    name = address.strip().rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
    return name.removesuffix(".git") or "repository"


def clone(address: str, parent: Path, *, timeout: float = 600) -> Path:
    """Clones into ``parent/<repo name>`` and returns that folder.

    Raises:
        FileExistsError: The folder is already there.
        CloneError: git failed; it never waits for a password (``GIT_TERMINAL_PROMPT=0``).
    """
    dest = parent.expanduser().resolve() / repo_name(address)
    if dest.exists():
        raise FileExistsError(str(dest))
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        result = subprocess.run(
            ["git", "clone", "--quiet", clone_url(address), str(dest)],
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired as e:
        raise CloneError(f"git clone took longer than {timeout:.0f}s") from e
    except OSError as e:
        raise CloneError(f"git is not installed: {e}") from e
    if result.returncode != 0:
        lines = [line for line in result.stderr.strip().splitlines() if line.strip()]
        raise CloneError(lines[-1] if lines else f"git clone exited with {result.returncode}")
    return dest
