"""What each protocol method does. Every handler takes its params model and returns its result model."""

from __future__ import annotations

import time
from collections.abc import Callable
from importlib.metadata import version
from pathlib import Path
from typing import Any

from alpine_core import (
    PROVIDERS,
    CloneError,
    ConfigError,
    Connection,
    ModelListError,
    Project,
    ProjectList,
    PullRequest,
    Settings,
    clone,
    current_branch,
    git_status,
    list_models,
    pull_request,
    save_connection,
    set_default_model,
)
from alpine_protocol import (
    PROTOCOL_VERSION,
    ConnectionInfo,
    ConnectionsAddParams,
    ConnectionsAddResult,
    ConnectionsListParams,
    ConnectionsListResult,
    ConnectionsModelsParams,
    ConnectionsModelsResult,
    ConnectionsSetDefaultParams,
    ConnectionsSetDefaultResult,
    ErrorData,
    GitInfo,
    InitializeParams,
    InitializeResult,
    ProjectInfo,
    ProjectsArchiveParams,
    ProjectsArchiveResult,
    ProjectsCloneParams,
    ProjectsCloneResult,
    ProjectsDeleteParams,
    ProjectsDeleteResult,
    ProjectsGitParams,
    ProjectsGitResult,
    ProjectsListParams,
    ProjectsListResult,
    ProjectsOpenParams,
    ProjectsOpenResult,
    ProviderInfo,
    PullRequestInfo,
    ServerInfo,
)

#: JSON-RPC's range for errors the server defines; ``data`` is an ``ErrorData`` saying which.
APP_ERROR = -32000
INVALID_PARAMS = -32602


class MethodError(Exception):
    def __init__(self, code: int, message: str, reason: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.data = ErrorData(reason=reason) if reason else None


def initialize(params: InitializeParams) -> InitializeResult:
    return InitializeResult(
        protocol_version=PROTOCOL_VERSION,
        server=ServerInfo(name="alpine-code-server", version=version("alpine-code-server")),
    )


# ------------------------------------------------------------ connections


def list_connections(params: ConnectionsListParams) -> ConnectionsListResult:
    settings = _settings()
    return ConnectionsListResult(
        connections=[_connection_info(c, settings) for c in settings.connections.values()],
        default_model=settings.model,
        providers=[
            ProviderInfo(id=p.id, name=p.name, billing=p.billing.value, key_env=p.key_env) for p in PROVIDERS.values()
        ],
    )


def connection_models(params: ConnectionsModelsParams) -> ConnectionsModelsResult:
    settings = _settings()
    connection = _connection(params.provider, params.base_url, settings)
    key = params.api_key or settings.api_key_for(connection)
    try:
        return ConnectionsModelsResult(models=list_models(connection, key))
    except ModelListError as e:
        raise MethodError(APP_ERROR, str(e), e.kind.value) from e


def add_connection(params: ConnectionsAddParams) -> ConnectionsAddResult:
    settings = _settings()
    connection = _connection(params.provider, params.base_url, settings)
    try:
        connection = save_connection(
            connection.name, provider=params.provider, base_url=params.base_url if not params.provider else None
        )
        if params.api_key and settings.secrets is not None:
            settings.secrets.set(connection.name, params.api_key)
        if params.make_default:
            set_default_model(f"{connection.name}/{params.model}")
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    settings = _settings()
    return ConnectionsAddResult(
        connection=_connection_info(settings.connections[connection.name], settings), default_model=settings.model
    )


def set_default(params: ConnectionsSetDefaultParams) -> ConnectionsSetDefaultResult:
    try:
        set_default_model(params.model)
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    return ConnectionsSetDefaultResult(default_model=params.model)


def _connection(provider_id: str | None, base_url: str | None, settings: Settings) -> Connection:
    """The saved connection for this provider or address, or a new one named after it."""
    if provider_id is not None:
        provider = PROVIDERS.get(provider_id)
        if provider is None:
            raise MethodError(INVALID_PARAMS, f"Unknown provider {provider_id!r}")
        return Connection(provider.id, provider)
    if not base_url:
        raise MethodError(INVALID_PARAMS, "A connection needs a provider or a baseUrl")
    for connection in settings.connections.values():
        if connection.provider is None and connection.base_url == base_url:
            return connection
    name, n = "local", 1
    while name in settings.connections:
        n += 1
        name = f"local-{n}"
    return Connection(name, None, base_url)


def _connection_info(connection: Connection, settings: Settings) -> ConnectionInfo:
    return ConnectionInfo(
        name=connection.name,
        provider=connection.provider.id if connection.provider else None,
        base_url=connection.url,
        billing=connection.billing.value,
        has_key=settings.api_key_for(connection) is not None,
    )


def _settings() -> Settings:
    try:
        return Settings.load()
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e


# ------------------------------------------------------------ projects


def list_projects(params: ProjectsListParams) -> ProjectsListResult:
    projects = ProjectList.default()
    return ProjectsListResult(
        projects=[_project_info(p) for p in projects.list()], clone_parent=str(projects.clone_parent())
    )


def open_project(params: ProjectsOpenParams) -> ProjectsOpenResult:
    try:
        project = ProjectList.default().open(Path(params.path))
    except NotADirectoryError as e:
        raise MethodError(APP_ERROR, f"Not a folder: {params.path}", "not_a_folder") from e
    return ProjectsOpenResult(project=_project_info(project))


def archive_project(params: ProjectsArchiveParams) -> ProjectsArchiveResult:
    ProjectList.default().archive(Path(params.path))
    return ProjectsArchiveResult()


def delete_project(params: ProjectsDeleteParams) -> ProjectsDeleteResult:
    ProjectList.default().delete(Path(params.path))
    return ProjectsDeleteResult()


def clone_project(params: ProjectsCloneParams) -> ProjectsCloneResult:
    try:
        folder = clone(params.address, Path(params.parent))
    except FileExistsError as e:
        raise MethodError(APP_ERROR, f"Already there: {e}", "exists") from e
    except CloneError as e:
        raise MethodError(APP_ERROR, str(e), "clone_failed") from e
    return ProjectsCloneResult(project=_project_info(ProjectList.default().open(folder)))


#: Asking GitHub takes a second, so a branch's pull request is looked up at most once a minute.
_PR_TTL = 60.0
_pull_requests: dict[tuple[Path, str], tuple[float, PullRequest | None]] = {}


def project_git(params: ProjectsGitParams) -> ProjectsGitResult:
    folder = Path(params.path)
    status = git_status(folder)
    if status is None:
        return ProjectsGitResult(git=None)
    pr = _cached_pull_request(folder, status.branch)
    return ProjectsGitResult(
        git=GitInfo(
            branch=status.branch,
            added=status.added,
            deleted=status.deleted,
            pull_request=PullRequestInfo(number=pr.number, url=pr.url, checks=pr.checks) if pr else None,
        )
    )


def _cached_pull_request(folder: Path, branch: str | None) -> PullRequest | None:
    if branch is None:
        return None
    checked_at, pr = _pull_requests.get((folder, branch), (None, None))
    if checked_at is None or time.monotonic() - checked_at > _PR_TTL:
        pr = pull_request(folder)
        _pull_requests[(folder, branch)] = (time.monotonic(), pr)
    return pr


def _project_info(project: Project) -> ProjectInfo:
    return ProjectInfo(
        path=str(project.path),
        name=project.name,
        branch=current_branch(project.path),
        last_used_at=project.last_used_at,
        archived=project.archived,
    )


HANDLERS: dict[str, Callable[[Any], Any]] = {
    "initialize": initialize,
    "connections/list": list_connections,
    "connections/models": connection_models,
    "connections/add": add_connection,
    "connections/setDefault": set_default,
    "projects/list": list_projects,
    "projects/open": open_project,
    "projects/archive": archive_project,
    "projects/delete": delete_project,
    "projects/clone": clone_project,
    "projects/git": project_git,
}
