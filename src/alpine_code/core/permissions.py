"""Which tool calls run without asking."""

from __future__ import annotations

from enum import StrEnum

from .tools import TOOL_KINDS


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


class PermissionPolicy:
    """Reading is always allowed. Editing is allowed in ``accept_edits`` and ``yolo``; commands only in ``yolo``.
    A tool the user allowed with "don't ask again" is allowed for the rest of the session."""

    def __init__(self, mode: Mode = Mode.DEFAULT) -> None:
        self.mode = mode
        self.always_allowed: set[str] = set()

    def allows(self, tool: str) -> bool:
        kind = TOOL_KINDS.get(tool, "exec")
        if kind == "read" or self.mode is Mode.YOLO or tool in self.always_allowed:
            return True
        return kind == "edit" and self.mode is Mode.ACCEPT_EDITS

    def remember(self, tool: str) -> None:
        self.always_allowed.add(tool)
