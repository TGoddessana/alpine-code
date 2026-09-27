"""Which tool calls run without asking, and what "don't ask again" remembers.

Rules, in order (``yolo`` skips all of them):

1. File tools (read, glob, grep, write, edit) on a path outside the working directory ask. "Don't ask again"
   remembers that directory for reading or for editing.
2. Reading a secret env file (``.env``, ``.env.local``; not ``.env.example``) asks. Remembered per file.
3. Inside the working directory, reading and searching never ask. Editing asks unless the mode is
   ``accept_edits``; "don't ask again" remembers the tool.
4. ``bash`` asks unless every command in it matches a remembered command prefix (``git status``,
   ``uv run pytest``), it does not write files through redirection, and every path it names (arguments and
   redirection targets, following ``cd``) is inside the working directory or a directory allowed for editing, and
   is not a secret env file. "Don't ask again" remembers the prefixes of the commands it runs and allows editing in
   the outside directories it names, unless one of the commands could run anything (``python``, ``sudo``,
   ``bash -c``...) or a path is only known at run time (``$HOME/.ssh``). Bash gets edit-level access to a
   directory because a command can do anything with a path it is given.

Symlinks are resolved before comparing paths, so a link inside the working directory that points outside counts
as outside.
"""

from __future__ import annotations

import tempfile
from dataclasses import dataclass, field
from enum import StrEnum
from functools import cache
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
    """What "don't ask again" adds."""

    tool: str | None = None
    read_dirs: tuple[Path, ...] = ()
    edit_dirs: tuple[Path, ...] = ()
    files: tuple[Path, ...] = ()
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
                return Verdict(False, reason, Grant(files=(target,)), f"reading {target.name}")
            return ALLOW
        if self.mode is Mode.ACCEPT_EDITS:
            return ALLOW
        return self._by_tool(tool)

    def remember(self, grant: Grant) -> None:
        if grant.tool:
            self.tools.add(grant.tool)
        self.read_dirs.update(grant.read_dirs)
        self.edit_dirs.update(grant.edit_dirs)
        self.files.update(grant.files)
        self.bash_prefixes.update(grant.bash_prefixes)

    # ------------------------------------------------------------ rules

    def _by_tool(self, tool: str) -> Verdict:
        if tool in self.tools:
            return ALLOW
        return Verdict(False, None, Grant(tool=tool), f"{tool}")

    def _outside(self, kind: str, target: Path) -> Verdict:
        directory = target if target.is_dir() else target.parent
        reason = "outside the working directory"
        if kind == "read":
            if any(_inside(target, d) for d in self.read_dirs | self.edit_dirs):
                return ALLOW
            grant, what = Grant(read_dirs=(directory,)), "reading"
        else:
            if any(_inside(target, d) for d in self.edit_dirs):
                return ALLOW
            grant, what = Grant(edit_dirs=(directory,)), "editing"
        if not self._rememberable(directory, edit=kind != "read"):
            return Verdict(False, reason)
        return Verdict(False, reason, grant, f"{what} files in {_short(directory)}")

    def _rememberable(self, directory: Path, *, edit: bool) -> bool:
        """Whether "don't ask again" may cover ``directory``. Never the filesystem root, the home directory or
        anything above it, or anything containing the working directory. For editing (which includes anything
        bash does), only directories under the home directory or a temp directory; system directories always ask.
        """
        home = _real(Path.home())
        if directory == Path(directory.anchor) or _inside(home, directory):
            return False
        if _inside(_real(self.workspace.root), directory):
            return False
        return not edit or any(_inside(directory, base) for base in (home, *_temp_dirs()))

    def _bash(self, command: str) -> Verdict:
        analysis = shell.analyze(command)
        root = _real(self.workspace.root)
        outside: list[Path] = []
        secrets: list[Path] = []
        for text in dict.fromkeys(analysis.paths):
            target = _real(root / Path(text).expanduser())
            if not _inside(target, root) and not any(_inside(target, d) for d in self.edit_dirs):
                outside.append(target)
            elif is_secret(target) and target not in self.files:
                secrets.append(target)
        unresolved = list(dict.fromkeys(analysis.unresolved_paths))
        known = all(any(shell.matches(words, p) for p in self.bash_prefixes) for words in analysis.commands)
        if known and not (analysis.opaque or analysis.writes_files or outside or secrets or unresolved):
            return ALLOW

        reasons = []
        if unresolved:
            reasons.append("uses paths only known when it runs: " + ", ".join(unresolved))
        if outside:
            reasons.append("touches paths outside the working directory: " + ", ".join(map(_short, outside)))
        if secrets:
            reasons.append("reads files that may contain secrets: " + ", ".join(s.name for s in secrets))
        if analysis.writes_files and known and not reasons:
            reasons.append("writes files through redirection")
        reason = "; ".join(reasons) or None

        rules = tuple(dict.fromkeys(shell.prefix(words) for words in analysis.commands))
        if analysis.opaque or unresolved or not rules or not all(shell.rememberable(r) for r in rules):
            return Verdict(False, reason)
        dirs = tuple(dict.fromkeys(d if d.is_dir() else d.parent for d in outside))
        if not all(self._rememberable(d, edit=True) for d in dirs):
            return Verdict(False, reason)
        label = "bash commands starting with " + ", ".join(f"`{' '.join(r)}`" for r in rules)
        if dirs:
            label += ", with edit access to " + ", ".join(map(_short, dirs))
        if secrets:
            label += ", reading " + ", ".join(s.name for s in secrets)
        grant = Grant(bash_prefixes=rules, edit_dirs=dirs, files=tuple(secrets))
        return Verdict(False, reason, grant, label)


def is_secret(path: Path) -> bool:
    name = path.name
    return (name == ".env" or name.startswith(".env.")) and name != ".env.example"


@cache
def _temp_dirs() -> tuple[Path, ...]:
    return tuple(dict.fromkeys(_real(Path(d)) for d in (tempfile.gettempdir(), "/tmp") if Path(d).is_dir()))


def _short(path: Path) -> str:
    home = Path.home()
    return "~/" + str(path.relative_to(home)) if path.is_relative_to(home) and path != home else str(path)


def _real(path: Path) -> Path:
    return path.resolve()


def _inside(path: Path, directory: Path) -> bool:
    return path == directory or path.is_relative_to(directory)
