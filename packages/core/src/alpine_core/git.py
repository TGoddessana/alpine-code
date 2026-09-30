"""The little git the app needs outside a session: the current branch, and cloning a repository."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

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
