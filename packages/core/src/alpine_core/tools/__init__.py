"""Built-in tools. Each tool lives in its own module; this module assembles the default set.

Each tool says what it does through its ``@tool`` hints (``read_only``, ``open_world``...), which the permission
policy reads.
"""

from __future__ import annotations

from pathlib import Path

from alpineagents.tool import collect_tools

from ._common import Workspace
from .bash import Bash
from .edit import Edit, preview_edit
from .glob_files import Glob
from .grep import Grep
from .read import Read
from .write import Write

__all__ = ["BUILTIN", "Workspace", "default_tools", "preview_edit"]


def default_tools(workspace: Workspace) -> list:
    return [
        Read(workspace), Glob(workspace), Grep(workspace),
        Write(workspace), Edit(workspace), Bash(workspace),
    ]


#: Names of the built-in tools: what an agent turns on unless told otherwise, and what a user tool may not take.
BUILTIN: tuple[str, ...] = tuple(collect_tools(default_tools(Workspace(Path()))))
