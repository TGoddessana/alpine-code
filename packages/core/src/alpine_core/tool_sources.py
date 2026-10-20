"""Where a session's tools come from.

Each tool is made with what it works on: the built-in tools with the folder, the memory's tools with the project's
inbox. Whatever makes them offers them the same way, as a ``ToolSource``. A session
and the app's tool list take the same sources, so the tools a session gets and the tools the app shows cannot
differ, and only what builds the sources (``ToolSources``, given by the frontend) knows which kinds there are.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

from alpineagents import Tool
from alpineagents.tool import collect_tools

from .permissions import kind_of
from .tools import Workspace, default_tools

Origin = Literal["builtin", "memory"]
Ask = Literal["never", "edit", "ask"]
"""When a call asks, from the tool's hints: ``never`` (reads local files), ``edit`` (as editing files) or ``ask``."""


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
    """Every source's tools, in order. A tool whose name an earlier source took is left out."""
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


@dataclass(frozen=True)
class Param:
    name: str
    type: str
    """The JSON Schema type, e.g. ``string``."""
    description: str
    required: bool
    default: Any = None


@dataclass(frozen=True)
class ToolSummary:
    """A tool as the model sees it, and when calling it asks."""

    name: str
    description: str
    params: tuple[Param, ...]
    read_only: bool
    open_world: bool
    ask: Ask


def summarize(tool: Tool) -> ToolSummary:
    schema = tool.input_schema
    properties = schema.get("properties", {})
    required = set(schema.get("required", ()))
    params = tuple(
        Param(
            name=name,
            type=_type_of(prop),
            description=str(prop.get("description", "")),
            required=name in required,
            default=prop.get("default"),
        )
        for name, prop in properties.items()
    )
    hints = tool.hints_for({})
    kind = kind_of(tool, {})
    ask: Ask = "never" if kind == "read" else "edit" if kind == "edit" else "ask"
    return ToolSummary(tool.name, tool.description, params, hints.read_only, hints.open_world, ask)


def _type_of(prop: dict[str, Any]) -> str:
    if "type" in prop:
        return str(prop["type"])
    for key in ("anyOf", "oneOf"):
        kinds = [str(p.get("type")) for p in prop.get(key, []) if p.get("type") not in (None, "null")]
        if kinds:
            return kinds[0]
    return "any"
