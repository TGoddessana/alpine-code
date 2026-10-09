"""Where a session's tools come from.

Each tool is made with what it works on: the built-in tools with the folder, the memory's tools with the project's
inbox, the user's tools by their files. Whatever makes them offers them the same way, as a ``ToolSource``. A session
and the app's tool list take the same sources, so the tools a session gets and the tools the app shows cannot
differ, and only what builds the sources (``ToolSources``, given by the frontend) knows which kinds there are.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from alpineagents import Tool
from alpineagents.tool import collect_tools

from .tools import Workspace, default_tools

Origin = Literal["builtin", "memory", "user"]


@dataclass(frozen=True)
class Offered:
    """A tool and what the app says about it."""

    tool: Tool
    origin: Origin
    optional: bool = True
    """Whether an agent can turn it off. One that cannot is in every session its source is given to."""


class ToolSource(Protocol):
    def offered(self) -> list[Offered]: ...


ToolSources = Callable[[Path], Sequence[ToolSource]]
"""The sources of a project folder's tools, in order: a name taken by an earlier source wins."""


class Builtins:
    """The built-in tools, working in ``workspace``."""

    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    def offered(self) -> list[Offered]:
        return [Offered(tool, "builtin") for tool in collect_tools(default_tools(self.workspace)).values()]


def builtins_only(project: Path) -> list[ToolSource]:
    return [Builtins(Workspace(project))]


def gather(sources: Iterable[ToolSource]) -> list[Offered]:
    """Every source's tools, in order. A tool whose name an earlier source took is left out, so a user tool cannot
    stand in for a built-in or a memory tool."""
    taken: set[str] = set()
    offered: list[Offered] = []
    for source in sources:
        for o in source.offered():
            if o.tool.name not in taken:
                taken.add(o.tool.name)
                offered.append(o)
    return offered


def pick(offered: Iterable[Offered], on: Collection[str] | None) -> list[Tool]:
    """The tools a session gets: those no agent can turn off, and the others named in ``on`` (all of them
    without an agent)."""
    return [o.tool for o in offered if on is None or not o.optional or o.tool.name in on]
