"""Which tool calls run without asking, and what "don't ask again" remembers.

A tool's kind comes from its hints for the call (see ``kind_of``): ``read`` for tools that only look at local files,
``edit`` for tools that change local files, ``exec`` for everything else.

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
from typing import Any, Literal

from alpineagents import Tool

from . import shell
from .tools import Workspace

ToolKind = Literal["read", "edit", "exec"]

OUTSIDE = "outside the working directory"


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
    """What "don't ask again" adds to the policy."""

    label: str
    """How it reads to the user, e.g. ``bash commands starting with `git status```."""
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
    """What to remember if the user says "don't ask again". ``None``: nothing is safe to remember."""

    @property
    def remember(self) -> str | None:
        return self.grant.label if self.grant else None


ALLOW = Verdict(True)


@dataclass
class Remembered:
    """What the user allowed with "don't ask again" in one conversation. The session keeps it in the conversation's
    State (``to_data``), so it is saved and resumed with it, and a new conversation starts with nothing remembered."""

    tools: set[str] = field(default_factory=set)
    read_dirs: set[Path] = field(default_factory=set)
    edit_dirs: set[Path] = field(default_factory=set)
    files: set[Path] = field(default_factory=set)
    bash_prefixes: set[tuple[str, ...]] = field(default_factory=set)

    def add(self, grant: Grant) -> None:
        if grant.tool:
            self.tools.add(grant.tool)
        self.read_dirs.update(grant.read_dirs)
        self.edit_dirs.update(grant.edit_dirs)
        self.files.update(grant.files)
        self.bash_prefixes.update(grant.bash_prefixes)

    def to_data(self) -> dict[str, list]:
        """A JSON value, sorted so the same grants always save the same way."""
        return {
            "tools": sorted(self.tools),
            "read_dirs": sorted(map(str, self.read_dirs)),
            "edit_dirs": sorted(map(str, self.edit_dirs)),
            "files": sorted(map(str, self.files)),
            "bash_prefixes": sorted(map(list, self.bash_prefixes)),
        }

    @classmethod
    def from_data(cls, data: dict[str, list] | None) -> Remembered:
        """The inverse of ``to_data``. ``None`` (nothing saved yet) is nothing remembered."""
        data = data or {}
        return cls(
            tools=set(data.get("tools", ())),
            read_dirs={Path(p) for p in data.get("read_dirs", ())},
            edit_dirs={Path(p) for p in data.get("edit_dirs", ())},
            files={Path(p) for p in data.get("files", ())},
            bash_prefixes={tuple(p) for p in data.get("bash_prefixes", ())},
        )


@dataclass
class PermissionPolicy:
    workspace: Workspace
    mode: Mode = Mode.DEFAULT

    def evaluate(
        self, name: str, args: dict[str, Any], tool: Tool | None, remembered: Remembered | None = None
    ) -> Verdict:
        """Whether a call to ``name`` with ``args`` may run without asking. ``tool`` is the Tool the name stands
        for, or ``None`` for a name the model made up. ``remembered`` is what the user already allowed."""
        if self.mode is Mode.YOLO:
            return ALLOW
        return _Evaluation(self.workspace, self.mode, remembered or Remembered()).evaluate(name, args, tool)


@dataclass(frozen=True)
class _Evaluation:
    """One call checked against the mode and what is remembered."""

    workspace: Workspace
    mode: Mode
    remembered: Remembered

    def evaluate(self, name: str, args: dict[str, Any], tool: Tool | None) -> Verdict:
        if name == "bash":
            return self._bash(str(args.get("command", "")))
        kind = kind_of(tool, args)
        if kind == "exec":
            return self._by_tool(name)
        target = self.workspace.resolve(str(args.get("path") or ".")).resolve()
        if not _inside(target, self._root):
            return self._outside(kind, target)
        if kind == "read":
            return self._read_inside(name, target)
        return ALLOW if self.mode is Mode.ACCEPT_EDITS else self._by_tool(name)

    @property
    def _root(self) -> Path:
        return self.workspace.root.resolve()

    # ------------------------------------------------------------ file tools

    def _by_tool(self, name: str) -> Verdict:
        if name in self.remembered.tools:
            return ALLOW
        return Verdict(False, grant=Grant(name, tool=name))

    def _read_inside(self, name: str, target: Path) -> Verdict:
        if name in ("read", "grep") and is_secret(target) and target not in self.remembered.files:
            grant = Grant(f"reading {target.name}", files=(target,))
            return Verdict(False, f"{target.name} may contain secrets", grant)
        return ALLOW

    def _outside(self, kind: ToolKind, target: Path) -> Verdict:
        editing = kind != "read"
        allowed_dirs = self.remembered.edit_dirs if editing else self.remembered.read_dirs | self.remembered.edit_dirs
        if any(_inside(target, d) for d in allowed_dirs):
            return ALLOW
        directory = target if target.is_dir() else target.parent
        if not self._rememberable(directory, edit=editing):
            return Verdict(False, OUTSIDE)
        label = f"{'editing' if editing else 'reading'} files in {_short(directory)}"
        grant = Grant(label, edit_dirs=(directory,)) if editing else Grant(label, read_dirs=(directory,))
        return Verdict(False, OUTSIDE, grant)

    def _rememberable(self, directory: Path, *, edit: bool) -> bool:
        """Whether "don't ask again" may cover ``directory``. Never the filesystem root, the home directory or
        anything above it, or anything containing the working directory. For editing (which includes anything
        bash does), only directories under the home directory or a temp directory; system directories always ask.
        """
        home = Path.home().resolve()
        if directory == Path(directory.anchor) or _inside(home, directory) or _inside(self._root, directory):
            return False
        return not edit or any(_inside(directory, base) for base in (home, *_temp_dirs()))

    # ------------------------------------------------------------ bash

    def _bash(self, command: str) -> Verdict:
        analysis = shell.analyze(command)
        outside, secrets = self._bash_targets(analysis)
        unresolved = list(dict.fromkeys(analysis.unresolved_paths))
        known = all(any(shell.matches(words, p) for p in self.remembered.bash_prefixes) for words in analysis.commands)
        if known and not (analysis.opaque or analysis.writes_files or outside or secrets or unresolved):
            return ALLOW

        reasons = []
        if unresolved:
            reasons.append("uses paths only known when it runs: " + ", ".join(unresolved))
        if outside:
            reasons.append(f"touches paths {OUTSIDE}: " + ", ".join(map(_short, outside)))
        if secrets:
            reasons.append("reads files that may contain secrets: " + ", ".join(s.name for s in secrets))
        if analysis.writes_files and known and not reasons:
            reasons.append("writes files through redirection")
        reason = "; ".join(reasons) or None

        if analysis.opaque or unresolved:
            return Verdict(False, reason)
        return Verdict(False, reason, self._bash_grant(analysis, outside, secrets))

    def _bash_targets(self, analysis: shell.Analysis) -> tuple[list[Path], list[Path]]:
        """The paths the script names that are outside what it may touch, and the secret files it reads."""
        outside: list[Path] = []
        secrets: list[Path] = []
        for text in dict.fromkeys(analysis.paths):
            target = (self._root / Path(text).expanduser()).resolve()
            if not _inside(target, self._root) and not any(_inside(target, d) for d in self.remembered.edit_dirs):
                outside.append(target)
            elif is_secret(target) and target not in self.remembered.files:
                secrets.append(target)
        return outside, secrets

    def _bash_grant(self, analysis: shell.Analysis, outside: list[Path], secrets: list[Path]) -> Grant | None:
        """What "don't ask again" would add for this script, or ``None`` when that is not safe."""
        rules = tuple(dict.fromkeys(shell.prefix(words) for words in analysis.commands))
        if not rules or not all(shell.rememberable(r) for r in rules):
            return None
        dirs = tuple(dict.fromkeys(d if d.is_dir() else d.parent for d in outside))
        if not all(self._rememberable(d, edit=True) for d in dirs):
            return None
        label = "bash commands starting with " + ", ".join(f"`{' '.join(r)}`" for r in rules)
        if dirs:
            label += ", with edit access to " + ", ".join(map(_short, dirs))
        if secrets:
            label += ", reading " + ", ".join(s.name for s in secrets)
        return Grant(label, bash_prefixes=rules, edit_dirs=dirs, files=tuple(secrets))


def kind_of(tool: Tool | None, args: dict[str, Any] | None = None) -> ToolKind:
    """What a call can do, from the tool's hints for it. Only calls that stay local (``open_world=False``) are
    ``read`` or ``edit``: a read-only call that reaches the network could still send data out. A hint left out
    assumes the worst (not read-only, open world), so a tool without hints is ``exec``, and so is a made-up name."""
    if tool is None:
        return "exec"
    hints = tool.hints_for(args or {})
    if hints.open_world:
        return "exec"
    return "read" if hints.read_only else "edit"


def is_secret(path: Path) -> bool:
    name = path.name
    return (name == ".env" or name.startswith(".env.")) and name != ".env.example"


@cache
def _temp_dirs() -> tuple[Path, ...]:
    return tuple(dict.fromkeys(Path(d).resolve() for d in (tempfile.gettempdir(), "/tmp") if Path(d).is_dir()))


def _short(path: Path) -> str:
    home = Path.home()
    return "~/" + str(path.relative_to(home)) if path.is_relative_to(home) and path != home else str(path)


def _inside(path: Path, directory: Path) -> bool:
    return path.is_relative_to(directory)
