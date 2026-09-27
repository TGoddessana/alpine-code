"""Which tool calls run without asking, and what "don't ask again" remembers.

Rules, in order (``yolo`` skips all of them):

1. File tools (read, glob, grep, write, edit) on a path outside the working directory ask. "Don't ask again"
   remembers that directory for reading or for editing.
2. Reading a secret env file (``.env``, ``.env.local``; not ``.env.example``) asks. Remembered per file.
3. Inside the working directory, reading and searching never ask. Editing asks unless the mode is
   ``accept_edits``; "don't ask again" remembers the tool.
4. ``bash`` asks unless every command in it matches a remembered command prefix (``git status``,
   ``uv run pytest``) and it does not write files through redirection. "Don't ask again" remembers the prefixes of
   the commands it runs, unless one of them could run anything (``python``, ``sudo``, ``bash -c``...).

Symlinks are resolved before comparing paths, so a link inside the working directory that points outside counts
as outside.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any

from . import shell
from .tools import TOOL_KINDS, Workspace


class Mode(StrEnum):
    DEFAULT = "default"
    """Ask before editing files or running commands."""
    ACCEPT_EDITS = "accept_edits"
    """Edit files without asking; ask before running commands."""
    YOLO = "yolo"
    """Never ask."""

    def next(self) -> Mode:
        modes = list(Mode)
        return modes[(modes.index(self) + 1) % len(modes)]


@dataclass(frozen=True)
class Grant:
    """What "don't ask again" adds. Exactly one field is set."""

    tool: str | None = None
    read_dir: Path | None = None
    edit_dir: Path | None = None
    file: Path | None = None
    bash_prefixes: tuple[tuple[str, ...], ...] = ()


@dataclass(frozen=True)
class Verdict:
    allowed: bool
    reason: str | None = None
    """Why the call needs approval, when it is not just the mode."""
    grant: Grant | None = None
    """What to remember if the user says "don't ask again". ``None``: nothing safe to remember."""
    remember: str | None = None
    """How to describe ``grant`` to the user, e.g. ``bash commands starting with `git status```."""


ALLOW = Verdict(True)


@dataclass
class PermissionPolicy:
    workspace: Workspace
    mode: Mode = Mode.DEFAULT
    tools: set[str] = field(default_factory=set)
    read_dirs: set[Path] = field(default_factory=set)
    edit_dirs: set[Path] = field(default_factory=set)
    files: set[Path] = field(default_factory=set)
    bash_prefixes: set[tuple[str, ...]] = field(default_factory=set)

    def evaluate(self, tool: str, args: dict[str, Any]) -> Verdict:
        if self.mode is Mode.YOLO:
            return ALLOW
        kind = TOOL_KINDS.get(tool, "exec")
        if tool == "bash":
            return self._bash(str(args.get("command", "")))
        if kind == "exec":
            return self._by_tool(tool)
        target = _real(self.workspace.resolve(str(args.get("path") or ".")))
        if not _inside(target, _real(self.workspace.root)):
            return self._outside(kind, target)
        if kind == "read":
            if tool in ("read", "grep") and is_secret(target) and target not in self.files:
                reason = f"{target.name} may contain secrets"
                return Verdict(False, reason, Grant(file=target), f"reading {target.name}")
            return ALLOW
        if self.mode is Mode.ACCEPT_EDITS:
            return ALLOW
        return self._by_tool(tool)

    def remember(self, grant: Grant) -> None:
        if grant.tool:
            self.tools.add(grant.tool)
        if grant.read_dir:
            self.read_dirs.add(grant.read_dir)
        if grant.edit_dir:
            self.edit_dirs.add(grant.edit_dir)
        if grant.file:
            self.files.add(grant.file)
        self.bash_prefixes.update(grant.bash_prefixes)

    # ------------------------------------------------------------ rules

    def _by_tool(self, tool: str) -> Verdict:
        if tool in self.tools:
            return ALLOW
        return Verdict(False, None, Grant(tool=tool), f"{tool}")

    def _outside(self, kind: str, target: Path) -> Verdict:
        directory = target if target.is_dir() else target.parent
        if kind == "read":
            if any(_inside(target, d) for d in self.read_dirs | self.edit_dirs):
                return ALLOW
            grant, what = Grant(read_dir=directory), "reading"
        else:
            if any(_inside(target, d) for d in self.edit_dirs):
                return ALLOW
            grant, what = Grant(edit_dir=directory), "editing"
        return Verdict(False, "outside the working directory", grant, f"{what} files in {_short(directory)}")

    def _bash(self, command: str) -> Verdict:
        analysis = shell.analyze(command)
        known = all(any(shell.matches(words, p) for p in self.bash_prefixes) for words in analysis.commands)
        if known and not analysis.opaque and not analysis.writes_files:
            return ALLOW
        reason = "writes files through redirection" if analysis.writes_files and known else None
        rules = tuple(dict.fromkeys(shell.prefix(words) for words in analysis.commands))
        if analysis.opaque or not rules or not all(shell.rememberable(r) for r in rules):
            return Verdict(False, reason)
        label = ", ".join(f"`{' '.join(r)}`" for r in rules)
        return Verdict(False, reason, Grant(bash_prefixes=rules), f"bash commands starting with {label}")


def is_secret(path: Path) -> bool:
    name = path.name
    return (name == ".env" or name.startswith(".env.")) and name != ".env.example"


def _short(path: Path) -> str:
    home = Path.home()
    return "~/" + str(path.relative_to(home)) if path.is_relative_to(home) and path != home else str(path)


def _real(path: Path) -> Path:
    return path.resolve()


def _inside(path: Path, directory: Path) -> bool:
    return path == directory or path.is_relative_to(directory)
