"""The ``tools/*`` methods: the user's tool files. ``tools/list`` needs the tool sources of the sessions, so
``SessionManager`` answers it with ``list_tools``.

Every window shares one ``Toolbox`` per home folder, so a file's module is imported once per saved content.
"""

from __future__ import annotations

import ast
from dataclasses import asdict
from pathlib import Path
from typing import Any

from alpine_core import (
    ConfigError,
    DraftError,
    Offered,
    Toolbox,
    ToolboxError,
    ToolFile,
    ToolSources,
    ToolSummary,
    draft,
    gather,
    home_dir,
    summarize,
)
from alpine_protocol import (
    OfferedTool,
    PackageInfo,
    ToolFileInfo,
    ToolsCheckParams,
    ToolsCheckResult,
    ToolsConfirmParams,
    ToolsConfirmResult,
    ToolsDeleteParams,
    ToolsDeleteResult,
    ToolsDraftParams,
    ToolsDraftResult,
    ToolsInstallParams,
    ToolsInstallResult,
    ToolsListParams,
    ToolsListResult,
    ToolsSaveParams,
    ToolsSaveResult,
    ToolsSourceParams,
    ToolsSourceResult,
    ToolsTestParams,
    ToolsTestResult,
)
from alpine_protocol import ToolSummary as ToolSummaryModel

from .agents import agents
from .methods import APP_ERROR, INVALID_PARAMS, MethodError, _settings

_toolboxes: dict[Path, Toolbox] = {}


def toolbox() -> Toolbox:
    """The toolbox of the current home folder, made once."""
    home = home_dir()
    if home not in _toolboxes:
        _toolboxes[home] = Toolbox(home)
    return _toolboxes[home]


# ------------------------------------------------------------ tools


def list_tools(params: ToolsListParams, sources: ToolSources) -> ToolsListResult:
    """What the folder's sessions can get, from the same ``sources`` they are made with. Without a folder (the
    agents screen lists what every project gets) the home folder stands in."""
    box = toolbox()
    folder = Path(params.cwd).expanduser().resolve() if params.cwd else Path.home()
    return ToolsListResult(
        tools=[_offered(o) for o in gather(sources(folder))],
        files=[_file(f) for f in box.list()],
        folder=str(box.folder),
    )


def tool_source(params: ToolsSourceParams) -> ToolsSourceResult:
    try:
        return ToolsSourceResult(source=toolbox().source(params.name))
    except LookupError as e:
        raise MethodError(INVALID_PARAMS, f"No tool file named {params.name}") from e


def check_tool(params: ToolsCheckParams) -> ToolsCheckResult:
    try:
        check = toolbox().check(params.source)
    except ToolboxError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e
    return ToolsCheckResult(
        tools=[_summary(t) for t in check.tools],
        packages=list(check.packages),
        error=check.error,
        missing_package=check.missing_package,
        needs_approval=[PackageInfo.model_validate(asdict(p)) for p in check.needs_approval],
    )


def save_tool(params: ToolsSaveParams) -> ToolsSaveResult:
    box = toolbox()
    before = {t.name for f in box.list() if f.name == params.name for t in f.tools}
    try:
        file = box.save(params.name, params.source)
    except ToolboxError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e
    if params.enable_in:
        for tool in file.tools:
            if tool.name not in before:
                agents().enable(params.enable_in, tool.name)
    return ToolsSaveResult(file=_file(file))


def confirm_tool(params: ToolsConfirmParams) -> ToolsConfirmResult:
    try:
        return ToolsConfirmResult(file=_file(toolbox().confirm(params.name)))
    except LookupError as e:
        raise MethodError(INVALID_PARAMS, f"No tool file named {params.name}") from e


def delete_tool(params: ToolsDeleteParams) -> ToolsDeleteResult:
    box = toolbox()
    names = {t.name for f in box.list() if f.name == params.name for t in f.tools}
    try:
        # A broken or unconfirmed file lists no tools, so read the names from its text.
        names |= _declared_tools(box.source(params.name))
    except LookupError:
        pass
    box.delete(params.name)
    if names:
        agents().forget_tools(names)
    return ToolsDeleteResult()


def _declared_tools(source: str) -> set[str]:
    """The names of the functions a file decorates with ``tool``, without running it."""
    try:
        tree = ast.parse(source)
    except (SyntaxError, ValueError):
        return set()
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            for deco in node.decorator_list:
                target = deco.func if isinstance(deco, ast.Call) else deco
                if (isinstance(target, ast.Name) and target.id == "tool") or (
                    isinstance(target, ast.Attribute) and target.attr == "tool"
                ):
                    names.add(node.name)
    return names


def install_packages(params: ToolsInstallParams) -> ToolsInstallResult:
    try:
        toolbox().install(params.packages)
    except ToolboxError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e
    return ToolsInstallResult()


def test_tool(params: ToolsTestParams) -> ToolsTestResult:
    result = toolbox().test(params.source, params.tool, params.args)
    return ToolsTestResult(ok=result.ok, output=result.output, seconds=result.seconds)


def draft_tool(params: ToolsDraftParams) -> ToolsDraftResult:
    settings = _settings()
    if params.model:
        try:
            settings = settings.with_model(params.model)
        except ConfigError as e:
            raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    try:
        return ToolsDraftResult(source=draft(settings, params.description))
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    except DraftError as e:
        raise MethodError(APP_ERROR, str(e), "model_failed") from e


# ------------------------------------------------------------ conversions


def _summary(tool: ToolSummary) -> ToolSummaryModel:
    return ToolSummaryModel.model_validate(asdict(tool))


def _offered(offered: Offered) -> OfferedTool:
    return OfferedTool(tool=_summary(summarize(offered.tool)), origin=offered.origin, optional=offered.optional)


def _file(file: ToolFile) -> ToolFileInfo:
    data: dict[str, Any] = asdict(file)
    return ToolFileInfo.model_validate(data)


HANDLERS = {
    "tools/source": tool_source,
    "tools/check": check_tool,
    "tools/save": save_tool,
    "tools/confirm": confirm_tool,
    "tools/delete": delete_tool,
    "tools/install": install_packages,
    "tools/test": test_tool,
    "tools/draft": draft_tool,
}
