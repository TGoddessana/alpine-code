"""What each protocol method does. Every handler takes its params model and returns its result model."""

from __future__ import annotations

import time
from collections.abc import Callable
from importlib.metadata import version
from pathlib import Path
from typing import Any

from alpine_core import (
    PROVIDERS,
    Auth,
    CloneError,
    ConfigError,
    Connection,
    Mode,
    ModelListError,
    Project,
    ProjectList,
    PullRequest,
    Settings,
    chatgpt_tokens,
    clone,
    current_branch,
    git_status,
    hidden_models,
    list_models,
    load_catalog,
    pull_request,
    remove_connection,
    save_connection,
    set_default_mode,
    set_default_model,
    show_model,
)
from alpine_core import (
    set_review_model as save_review_model,
)
from alpine_core.chatgpt import account_of, is_chatgpt
from alpine_protocol import (
    PROTOCOL_VERSION,
    ChatGPTAccountInfo,
    ConnectionInfo,
    ConnectionsAddParams,
    ConnectionsAddResult,
    ConnectionsListParams,
    ConnectionsListResult,
    ConnectionsModelsParams,
    ConnectionsModelsResult,
    ConnectionsRemoveParams,
    ConnectionsRemoveResult,
    ConnectionsSetDefaultParams,
    ConnectionsSetDefaultResult,
    ConnectionsShowModelParams,
    ConnectionsShowModelResult,
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
    SettingsGetParams,
    SettingsGetResult,
    SettingsSetModeParams,
    SettingsSetModeResult,
    SettingsSetReviewModelParams,
    SettingsSetReviewModelResult,
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
            ProviderInfo(id=p.id, name=p.name, billing=p.billing.value, key_env=p.key_env)
            for p in PROVIDERS.values()
            if p.auth is Auth.API_KEY and p.key_env  # ChatGPT signs in instead (chatgpt/signIn)
        ],
    )


def connection_models(params: ConnectionsModelsParams) -> ConnectionsModelsResult:
    settings = _settings()
    if params.connection is not None:
        connection = settings.connections.get(params.connection)
        if connection is None:
            raise MethodError(INVALID_PARAMS, f"No connection named {params.connection!r}")
    else:
        connection = _connection(params.provider, params.base_url, settings)
    tokens = chatgpt_tokens(settings, connection) if is_chatgpt(connection) else None
    key = None if tokens else params.api_key or settings.api_key_for(connection)
    try:
        models = list_models(connection, key, tokens=tokens)
    except ModelListError as e:
        raise MethodError(APP_ERROR, str(e), e.kind.value) from e
    saved = params.connection is not None and not is_chatgpt(connection)  # ChatGPT lists a handful, all shown
    hidden = hidden_models(connection, models, load_catalog()) if saved else []
    return ConnectionsModelsResult(models=models, hidden=hidden)


def add_connection(params: ConnectionsAddParams) -> ConnectionsAddResult:
    settings = _settings()
    connection = _connection(params.provider, params.base_url, settings)
    try:
        connection = save_connection(
            connection.name,
            provider=params.provider,
            base_url=params.base_url if not params.provider else None,
            model=params.model,
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


def remove(params: ConnectionsRemoveParams) -> ConnectionsRemoveResult:
    settings = _settings()
    try:
        if not remove_connection(params.connection):
            raise MethodError(INVALID_PARAMS, f"No connection named {params.connection!r}")
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    if settings.secrets is not None:
        settings.secrets.delete(params.connection)
    return ConnectionsRemoveResult(default_model=_settings().model)


def show(params: ConnectionsShowModelParams) -> ConnectionsShowModelResult:
    if params.connection not in _settings().connections:
        raise MethodError(INVALID_PARAMS, f"No connection named {params.connection!r}")
    try:
        show_model(params.connection, params.model, params.shown)
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    return ConnectionsShowModelResult()


def set_default(params: ConnectionsSetDefaultParams) -> ConnectionsSetDefaultResult:
    try:
        set_default_model(params.model)
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    return ConnectionsSetDefaultResult(default_model=params.model)


# ------------------------------------------------------------ settings


def get_settings(params: SettingsGetParams) -> SettingsGetResult:
    settings = _settings()
    return SettingsGetResult(mode=settings.mode.value, review_model=settings.review_model)


def set_mode(params: SettingsSetModeParams) -> SettingsSetModeResult:
    try:
        set_default_mode(Mode(params.mode))
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    return SettingsSetModeResult(mode=params.mode)


def set_review_model(params: SettingsSetReviewModelParams) -> SettingsSetReviewModelResult:
    try:
        save_review_model(params.review_model)
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    return SettingsSetReviewModelResult(review_model=params.review_model)


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
    info = ConnectionInfo(
        name=connection.name,
        provider=connection.provider.id if connection.provider else None,
        base_url=connection.url,
        billing=connection.billing.value,
        has_key=False,
    )
    if not is_chatgpt(connection):
        return info.model_copy(update={"has_key": settings.api_key_for(connection) is not None})
    account = account_of(connection, settings.secrets) if hasattr(settings.secrets, "get_oauth") else None
    if account is None:
        return info
    return info.model_copy(
        update={
            "has_key": account.signed_in and account.plan_usage,
            "account": ChatGPTAccountInfo(
                email=account.email, signed_in=account.signed_in, plan_usage=account.plan_usage
            ),
        }
    )


def connection_info(name: str) -> ConnectionInfo:
    """The saved connection ``name``, as the app sees it."""
    settings = _settings()
    return _connection_info(settings.connections[name], settings)


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
    "connections/remove": remove,
    "connections/showModel": show,
    "connections/setDefault": set_default,
    "settings/get": get_settings,
    "settings/setMode": set_mode,
    "settings/setReviewModel": set_review_model,
    "projects/list": list_projects,
    "projects/open": open_project,
    "projects/archive": archive_project,
    "projects/delete": delete_project,
    "projects/clone": clone_project,
    "projects/git": project_git,
}
