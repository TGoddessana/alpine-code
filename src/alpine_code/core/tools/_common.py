"""Helpers shared by the built-in tools."""

from __future__ import annotations

import os
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

#: Most characters of tool output sent back to the model.
MAX_OUTPUT_CHARS = 30_000

#: Directories the search tools skip: VCS data, dependencies, caches and virtualenvs.
IGNORED_DIRS = frozenset(
    {".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", ".mypy_cache", ".pytest_cache",
     ".ruff_cache", ".tox", ".nox", ".idea", ".next", ".turbo", "target"}
)


@dataclass(frozen=True)
class Workspace:
    """The directory the agent works in. Relative tool paths resolve against ``root``."""

    root: Path

    def resolve(self, path: str) -> Path:
        p = Path(path).expanduser()
        return p if p.is_absolute() else (self.root / p)

    def display(self, path: Path) -> str:
        """``path`` relative to the root when inside it, absolute otherwise."""
        try:
            return str(path.resolve().relative_to(self.root.resolve()))
        except ValueError:
            return str(path)


def truncate_tail(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    """Keeps the end of ``text`` (where errors usually are) and says how much was cut."""
    if len(text) <= limit:
        return text
    cut = len(text) - limit
    return f"[{cut} characters truncated]\n" + text[-limit:]


def error(message: str) -> str:
    """A tool result the model reads as a failure. Tools return this instead of raising, because an exception
    from a tool ends the whole run."""
    return f"Error: {message}"


def walk_files(root: Path) -> Iterator[Path]:
    """Every file under ``root``, skipping ``IGNORED_DIRS``."""
    if root.is_file():
        yield root
        return
    for directory, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED_DIRS)
        for name in sorted(files):
            yield Path(directory) / name
