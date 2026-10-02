"""Built-in tools. Each tool lives in its own module; this module assembles the default set.

Each tool says what it does through its ``@tool`` hints (``read_only``, ``open_world``...), which the permission
policy reads.
"""

from __future__ import annotations

from ._common import Workspace
from .bash import Bash, CommandObserver
from .edit import Edit, preview_edit
from .glob_files import Glob
from .grep import Grep
from .plan import PlanTools
from .read import Read
from .write import Write

__all__ = ["CommandObserver", "PlanTools", "Workspace", "default_tools", "preview_edit"]


def default_tools(workspace: Workspace, *, on_command: CommandObserver | None = None) -> list:
    """The built-in tools a profile can turn on. ``on_command`` hears what each ``bash`` call ran. The plan tools
    (``PlanTools``) are not among them: every session has them, because the side panel rests on them."""
    return [
        Read(workspace), Glob(workspace), Grep(workspace),
        Write(workspace), Edit(workspace), Bash(workspace, on_command),
    ]
