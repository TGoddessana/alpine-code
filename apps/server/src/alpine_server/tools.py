"""``tools/list``: what a folder's sessions can get. It needs the tool sources of the sessions, so
``SessionManager`` answers it with ``list_tools``."""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path

from alpine_core import Offered, ToolSources, ToolSummary, gather, summarize
from alpine_protocol import OfferedTool, ToolsListParams, ToolsListResult
from alpine_protocol import ToolSummary as ToolSummaryModel


def list_tools(params: ToolsListParams, sources: ToolSources) -> ToolsListResult:
    """What the folder's sessions can get, from the same ``sources`` they are made with. Without a folder (the
    agents screen lists what every project gets) the home folder stands in."""
    folder = Path(params.cwd).expanduser().resolve() if params.cwd else Path.home()
    return ToolsListResult(tools=[_offered(o) for o in gather(sources(folder))])


def _summary(tool: ToolSummary) -> ToolSummaryModel:
    return ToolSummaryModel.model_validate(asdict(tool))


def _offered(offered: Offered) -> OfferedTool:
    return OfferedTool(tool=_summary(summarize(offered.tool)), origin=offered.origin, optional=offered.optional)
