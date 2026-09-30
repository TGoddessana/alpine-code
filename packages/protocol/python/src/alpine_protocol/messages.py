"""Message models. Each method has a ``<Method>Params`` and a ``<Method>Result``."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

#: Bumped on every change an older app or server cannot read.
PROTOCOL_VERSION = 1

#: JSON-RPC error codes of the session methods.
SESSION_NOT_FOUND = -32001
SESSION_RUNNING = -32002


class Message(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, validate_by_name=True, frozen=True)


# JSON-RPC envelope


class Request(Message):
    jsonrpc: Literal["2.0"] = "2.0"
    id: int | str | None = None
    """``None`` for a notification, which gets no response."""
    method: str
    params: dict[str, Any] | None = None


class ErrorObject(Message):
    code: int
    message: str
    data: Any = None


class Response(Message):
    jsonrpc: Literal["2.0"] = "2.0"
    id: int | str | None
    result: Any = None
    error: ErrorObject | None = None


# initialize: the first request an app sends


class InitializeParams(Message):
    protocol_version: int
    client_name: str


class ServerInfo(Message):
    name: str
    version: str


class InitializeResult(Message):
    protocol_version: int
    server: ServerInfo


class ErrorData(Message):
    """``data`` of an error the app can act on, beyond its message."""

    reason: Literal[
        "auth",
        "unreachable",
        "unsupported",
        "other",
        "not_a_folder",
        "invalid_config",
        "exists",
        "clone_failed",
        "invalid_name",
        "package_not_approved",
        "install_failed",
        "name_taken",
        "profile_conflict",
        "model_failed",
    ]
    """``auth``: the key is missing or rejected. ``unreachable``: no answer from the address. ``unsupported``: the
    server does not list its models, so the model name has to be typed. ``not_a_folder``: the path is not a folder.
    ``invalid_config``: config.toml cannot be read; the message says where. ``exists``: the clone's folder is already
    there. ``clone_failed``: git could not clone; the message is git's. ``invalid_name``: a tool file name is not
lowercase letters, digits and ``_``. ``package_not_approved``: a tool needs a package nobody approved.
``install_failed``: a package did not install. ``name_taken``: a tool name is already used. ``profile_conflict``:
another profile applies to the same project and model. ``model_failed``: the model call behind a draft failed."""


# Model connections: where models come from. Keys are write-only; the app never reads one back.

Billing = Literal["subscription", "usage", "none"]
"""How a connection is paid for, which decides the limit an app shows: a subscription's time windows, this month's
spend, or nothing (a local server)."""


class ProviderInfo(Message):
    id: str
    name: str
    billing: Billing
    key_env: str
    """The environment variable that holds its key, which wins over a saved one."""


class ConnectionInfo(Message):
    name: str
    """What model names start with: ``<name>/<model>``."""
    provider: str | None
    """A ``ProviderInfo.id``; ``None`` for a local or compatible server."""
    base_url: str | None
    billing: Billing
    has_key: bool
    """A key is saved or set in the environment."""


class ConnectionsListParams(Message):
    pass


class ConnectionsListResult(Message):
    connections: list[ConnectionInfo]
    default_model: str | None
    providers: list[ProviderInfo]
    """Everything an API key connection can name."""


class ConnectionsModelsParams(Message):
    """A connection that may not be saved yet: a provider, or the address of a compatible server."""

    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class ConnectionsModelsResult(Message):
    models: list[str]


class ConnectionsAddParams(Message):
    """Saves a connection, replacing the one for the same provider or address, and its key."""

    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str
    """The model to start new sessions with, when ``make_default``."""
    make_default: bool = True


class ConnectionsAddResult(Message):
    connection: ConnectionInfo
    default_model: str | None


class ConnectionsSetDefaultParams(Message):
    model: str
    """``<connection>/<model>``: what new sessions start with."""


class ConnectionsSetDefaultResult(Message):
    default_model: str


# Projects: folders the user works in


class ProjectInfo(Message):
    path: str
    name: str
    branch: str | None
    """The checked-out branch; ``None`` outside git or on a detached HEAD."""
    last_used_at: datetime
    archived: bool


class ProjectsListParams(Message):
    pass


class ProjectsListResult(Message):
    projects: list[ProjectInfo]
    """The most recently used first."""
    clone_parent: str
    """Where a clone goes unless the user picks another folder."""


class ProjectsOpenParams(Message):
    path: str


class ProjectsOpenResult(Message):
    project: ProjectInfo


class ProjectsArchiveParams(Message):
    """Takes a project off the rail; its sessions stay, and opening the folder brings it back."""

    path: str


class ProjectsArchiveResult(Message):
    pass


class ProjectsDeleteParams(Message):
    """Forgets a project and what Alpine keeps about it. The folder and its files are never touched."""

    path: str


class ProjectsDeleteResult(Message):
    pass


class ProjectsCloneParams(Message):
    """Clones into ``parent/<repo name>`` and opens it. Blocks until git is done."""

    address: str
    """A URL, ``git@...``, or GitHub's ``owner/repo``."""
    parent: str


class ProjectsCloneResult(Message):
    project: ProjectInfo


class PullRequestInfo(Message):
    number: int
    url: str
    checks: Literal["passing", "failing", "pending"] | None
    """CI on its last commit; ``None`` when it has no checks."""


class GitInfo(Message):
    branch: str | None
    """``None`` on a detached HEAD."""
    added: int
    deleted: int
    """Lines the branch changes that the default branch does not have yet, uncommitted work included."""
    pull_request: PullRequestInfo | None
    """The branch's open pull request, when ``gh`` can find one."""


class ProjectsGitParams(Message):
    path: str


class ProjectsGitResult(Message):
    git: GitInfo | None
    """``None`` outside a git repository."""


# Tools: built-in ones, the user's Python files, and profiles that choose which a session gets.

ToolAsk = Literal["never", "edit", "ask"]
"""When a call asks: ``never`` (reads local files), ``edit`` (as editing files, by the safety mode) or ``ask``."""


class ToolParam(Message):
    name: str
    type: str
    """The JSON Schema type, e.g. ``string``."""
    description: str
    required: bool
    default: str | int | float | bool | list[Any] | dict[str, Any] | None
    """The value used when the model leaves it out."""


class ToolSummary(Message):
    """A tool as the model sees it."""

    name: str
    description: str
    params: list[ToolParam]
    read_only: bool
    open_world: bool
    ask: ToolAsk


class ToolFileInfo(Message):
    name: str
    """The file name without ``.py``."""
    status: Literal["ready", "unconfirmed", "error"]
    """``unconfirmed``: new or changed outside the app, not loaded until confirmed. ``error``: cannot load."""
    error: str | None
    missing_package: str | None
    changed_at: datetime | None
    tools: list[ToolSummary]
    """Empty unless ``ready``."""
    packages: list[str]


class PackageInfo(Message):
    """What the approval of a package Alpine has not reviewed shows. Facts PyPI did not give are ``None``."""

    name: str
    first_release: str | None
    """``YYYY-MM``."""
    last_month_downloads: int | None
    similar: list[str]
    """Reviewed packages with a look-alike name."""


class ToolsListParams(Message):
    pass


class ToolsListResult(Message):
    builtin: list[ToolSummary]
    files: list[ToolFileInfo]
    folder: str
    """Where the files are."""


class ToolsSourceParams(Message):
    name: str


class ToolsSourceResult(Message):
    source: str


class ToolsCheckParams(Message):
    source: str


class ToolsCheckResult(Message):
    """The unsaved source, loaded. Nothing is loaded while ``needs_approval`` is not empty."""

    tools: list[ToolSummary]
    packages: list[str]
    error: str | None
    missing_package: str | None
    needs_approval: list[PackageInfo]


class ToolsSaveParams(Message):
    name: str
    source: str
    enable_in: str | None = None
    """A profile id to turn the file's new tools on in."""


class ToolsSaveResult(Message):
    file: ToolFileInfo


class ToolsConfirmParams(Message):
    name: str


class ToolsConfirmResult(Message):
    file: ToolFileInfo


class ToolsDeleteParams(Message):
    name: str


class ToolsDeleteResult(Message):
    pass


class ToolsInstallParams(Message):
    packages: list[str]
    """Approves and installs them."""


class ToolsInstallResult(Message):
    pass


class ToolsTestParams(Message):
    source: str
    tool: str
    args: dict[str, Any]


class ToolsTestResult(Message):
    ok: bool
    output: str
    seconds: float


class ToolsDraftParams(Message):
    description: str
    model: str | None = None
    """The default model when omitted."""


class ToolsDraftResult(Message):
    source: str


class ProfileInfo(Message):
    id: str
    """``default`` for the profile that always exists and applies everywhere; empty to add a new one."""
    name: str
    """Empty for the default profile."""
    project: str | None
    model: str | None
    tools: list[str]


class ProfilesListParams(Message):
    pass


class ProfilesListResult(Message):
    profiles: list[ProfileInfo]
    """The default profile first."""


class ProfilesSaveParams(Message):
    profile: ProfileInfo


class ProfilesSaveResult(Message):
    profile: ProfileInfo


class ProfilesDeleteParams(Message):
    id: str


class ProfilesDeleteResult(Message):
    pass


class ProfilesResolveParams(Message):
    cwd: str
    model: str | None = None


class ProfilesResolveResult(Message):
    profile: ProfileInfo


# Sessions: see docs/session-protocol.md

Mode = Literal["default", "accept_edits", "yolo"]
"""The core's permission modes: ask before edits and commands, ask before commands only, or never ask."""

SessionStatus = Literal["idle", "running", "waiting", "failed"]
"""``waiting``: an approval is active. ``failed``: the last run failed; until the next message."""

ToolStatus = Literal["running", "done", "error", "input_error", "aborted", "interrupted", "denied", "cancelled"]
"""``running``, then an outcome of alpineagents. A turn stopped at an approval leaves the call it stopped ``denied``
and the turn's other calls ``cancelled``."""


class Usage(Message):
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    requests: int
    cost: float | None
    """Dollars; ``None`` when the model has no known price."""


ActivityKind = Literal["thinking", "writing", "running_tool", "waiting_approval", "compacting"]
"""``thinking``: request sent, no text yet. ``writing``: reply text streaming. ``running_tool``: a tool call runs.
``waiting_approval``: an approval is active. ``compacting``: the context is being summarized."""


class Activity(Message):
    kind: ActivityKind
    tool_name: str | None
    """The tool of ``running_tool`` (the latest, if several run together); ``None`` otherwise."""
    since: datetime


class SessionInfo(Message):
    id: str
    title: str
    """The first user message, shortened."""
    cwd: str
    model: str
    mode: Mode
    status: SessionStatus
    created_at: datetime
    updated_at: datetime
    usage: Usage
    context_used: int
    """Tokens the conversation takes of the model's context window."""
    context_window: int | None
    """The model's context window in tokens; ``None`` if unknown."""
    activity: Activity | None
    """What the session is doing; ``None`` when idle."""
    run_started_at: datetime | None
    """When the current run started; ``None`` when idle."""
    run_usage: Usage | None
    """Usage since the current run started; ``None`` when idle."""
    profile: str | None
    """The id of the profile whose tools the session has."""


class ItemModel(Message):
    """Base of the items. Serialized in full, so ``kind`` and nulls are always present."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class UserMessageItem(ItemModel):
    id: str
    kind: Literal["user_message"] = "user_message"
    text: str


class AgentMessageItem(ItemModel):
    id: str
    kind: Literal["agent_message"] = "agent_message"
    text: str


class ToolCallItem(ItemModel):
    id: str
    """The model's call id."""
    kind: Literal["tool_call"] = "tool_call"
    name: str
    args: dict[str, Any]
    status: ToolStatus
    result: str | None = None
    images: int = 0
    """How many images the tool sent to the model; the images themselves are not kept."""


class ApprovalItem(ItemModel):
    id: str
    """The ``requestId`` of ``session/answer``."""
    kind: Literal["approval"] = "approval"
    call_id: str
    title: str
    preview: str | None = None
    preview_kind: Literal["command", "diff", "text"] | None = None
    reason: str | None = None
    """Why the core asks, e.g. the path is outside the working directory."""
    remember: str | None = None
    """What "don't ask again" would remember, worded for the user; ``None`` when it cannot be remembered."""
    decision: Literal["allow", "allow_always", "deny"] | None = None
    """``None`` while active."""
    feedback: str | None = None


class NoticeItem(ItemModel):
    """A message the model reads that the user did not write."""

    id: str
    kind: Literal["notice"] = "notice"
    text: str
    source: str


class StatusLineItem(ItemModel):
    """A line only the user reads."""

    id: str
    kind: Literal["status_line"] = "status_line"
    text: str


class CompactionItem(ItemModel):
    id: str
    kind: Literal["compaction"] = "compaction"
    before_tokens: int
    after_tokens: int


class RunStoppedItem(ItemModel):
    """Why a run ended other than by answering."""

    id: str
    kind: Literal["run_stopped"] = "run_stopped"
    reason: Literal["interrupted", "failed", "limit", "repeating", "permission"]
    message: str | None = None


Item = Annotated[
    UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | NoticeItem
    | StatusLineItem
    | CompactionItem
    | RunStoppedItem,
    Field(discriminator="kind"),
]


class SessionNewParams(Message):
    cwd: str
    model: str | None = None
    """``<connection>/<model>``; the default model when omitted."""
    mode: Mode | None = None
    profile: str | None = None
    """A profile id; the one the folder and model match when omitted."""


class SessionNewResult(Message):
    info: SessionInfo


class SessionListParams(Message):
    pass


class SessionListResult(Message):
    sessions: list[SessionInfo]
    """Every session of every project, most recently updated first."""


class SessionOpenParams(Message):
    session_id: str


class SessionOpenResult(Message):
    """A snapshot. Apply the events whose ``seq`` is greater than ``seq``."""

    info: SessionInfo
    seq: int
    items: list[Item]
    """Finished items."""
    active: list[Item]
    """Unfinished items: a streaming reply, running tool calls, an active approval."""


class SessionSendParams(Message):
    session_id: str
    text: str


class SessionSendResult(Message):
    pass


class SessionCancelParams(Message):
    session_id: str


class SessionCancelResult(Message):
    pass


class SessionAnswerParams(Message):
    session_id: str
    request_id: str
    decision: Literal["allow", "allow_always", "deny"]
    feedback: str | None = None
    """With ``deny``: tells the model what to do instead; without it a denial stops the turn."""


class SessionAnswerResult(Message):
    accepted: bool
    """``False`` if the approval was already answered."""


class SessionSetModeParams(Message):
    session_id: str
    mode: Mode


class SessionSetModeResult(Message):
    info: SessionInfo


class SessionDeleteParams(Message):
    session_id: str


class SessionDeleteResult(Message):
    pass


# session/event: the one notification, server -> app


class InfoChangedEvent(Message):
    type: Literal["info_changed"] = "info_changed"
    info: SessionInfo
    """Also announces a new session."""


class DeletedEvent(Message):
    type: Literal["deleted"] = "deleted"


class ItemStartedEvent(Message):
    type: Literal["item_started"] = "item_started"
    item: Item


class ItemDeltaEvent(Message):
    type: Literal["item_delta"] = "item_delta"
    item_id: str
    text: str


class ItemCompletedEvent(Message):
    type: Literal["item_completed"] = "item_completed"
    item: Item
    """The whole item; replaces what the deltas built."""


class ItemDiscardedEvent(Message):
    type: Literal["item_discarded"] = "item_discarded"
    item_id: str
    """Drop an unfinished item, e.g. a reply whose stream broke and is being asked again."""


SessionEvent = Annotated[
    InfoChangedEvent | DeletedEvent | ItemStartedEvent | ItemDeltaEvent | ItemCompletedEvent | ItemDiscardedEvent,
    Field(discriminator="type"),
]


class SessionEventParams(Message):
    session_id: str
    seq: int
    """Counts per session and only grows, across server restarts too."""
    event: SessionEvent


#: Every method an app can call: name -> (params, result).
METHODS: dict[str, tuple[type[Message], type[Message]]] = {
    "initialize": (InitializeParams, InitializeResult),
    "connections/list": (ConnectionsListParams, ConnectionsListResult),
    "connections/models": (ConnectionsModelsParams, ConnectionsModelsResult),
    "connections/add": (ConnectionsAddParams, ConnectionsAddResult),
    "connections/setDefault": (ConnectionsSetDefaultParams, ConnectionsSetDefaultResult),
    "projects/list": (ProjectsListParams, ProjectsListResult),
    "projects/open": (ProjectsOpenParams, ProjectsOpenResult),
    "projects/archive": (ProjectsArchiveParams, ProjectsArchiveResult),
    "projects/delete": (ProjectsDeleteParams, ProjectsDeleteResult),
    "projects/clone": (ProjectsCloneParams, ProjectsCloneResult),
    "projects/git": (ProjectsGitParams, ProjectsGitResult),
    "tools/list": (ToolsListParams, ToolsListResult),
    "tools/source": (ToolsSourceParams, ToolsSourceResult),
    "tools/check": (ToolsCheckParams, ToolsCheckResult),
    "tools/save": (ToolsSaveParams, ToolsSaveResult),
    "tools/confirm": (ToolsConfirmParams, ToolsConfirmResult),
    "tools/delete": (ToolsDeleteParams, ToolsDeleteResult),
    "tools/install": (ToolsInstallParams, ToolsInstallResult),
    "tools/test": (ToolsTestParams, ToolsTestResult),
    "tools/draft": (ToolsDraftParams, ToolsDraftResult),
    "profiles/list": (ProfilesListParams, ProfilesListResult),
    "profiles/save": (ProfilesSaveParams, ProfilesSaveResult),
    "profiles/delete": (ProfilesDeleteParams, ProfilesDeleteResult),
    "profiles/resolve": (ProfilesResolveParams, ProfilesResolveResult),
    "session/new": (SessionNewParams, SessionNewResult),
    "session/list": (SessionListParams, SessionListResult),
    "session/open": (SessionOpenParams, SessionOpenResult),
    "session/send": (SessionSendParams, SessionSendResult),
    "session/cancel": (SessionCancelParams, SessionCancelResult),
    "session/answer": (SessionAnswerParams, SessionAnswerResult),
    "session/setMode": (SessionSetModeParams, SessionSetModeResult),
    "session/delete": (SessionDeleteParams, SessionDeleteResult),
}

#: Every notification the server sends: name -> params.
NOTIFICATIONS: dict[str, type[Message]] = {
    "session/event": SessionEventParams,
}
