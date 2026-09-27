"""Built-in tools. Each tool lives in its own module; this module assembles the default set."""

from __future__ import annotations

from typing import Literal

from ._common import Workspace
from .bash import Bash
from .edit import Edit, preview_edit
from .glob_files import Glob
from .grep import Grep
from .read import Read
from .write import Write

__all__ = ["Workspace", "ToolKind", "TOOL_KINDS", "default_tools", "preview_edit"]

ToolKind = Literal["read", "edit", "exec"]

#: What each built-in tool can do, for the permission policy. Unknown tools are treated as "exec".
TOOL_KINDS: dict[str, ToolKind] = {
    "read": "read",
    "glob": "read",
    "grep": "read",
    "write": "edit",
    "edit": "edit",
    "bash": "exec",
}


def default_tools(workspace: Workspace) -> list:
    return [
        Read(workspace), Glob(workspace), Grep(workspace),
        Write(workspace), Edit(workspace), Bash(workspace),
    ]
