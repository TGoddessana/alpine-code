"""Message models. Each method has a ``<Method>Params`` and a ``<Method>Result``."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import ConfigDict, Field, model_validator
from pydantic.json_schema import SkipJsonSchema

from .base import Message
from .dev_servers import DEV_SERVER_METHODS
from .files import FILE_METHODS
from .process_control import PROCESS_METHODS
from .terminals import TERMINAL_METHODS

#: Bumped on every change an older app or server cannot read.
PROTOCOL_VERSION = 2

#: JSON-RPC error codes of the session methods.
SESSION_NOT_FOUND = -32001
SESSION_RUNNING = -32002


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
        "no_access",
        "no_git_tools",
        "invalid_name",
        "package_not_approved",
        "install_failed",
        "name_taken",
        "agent_not_found",
        "model_failed",
        "not_found",
        "memory_full",
        "flow_conflict",
        "invalid_flow",
        "invalid_flow_path",
        "map_read_only",
        "reason_required",
        "replay_changed",
        "flow_busy",
        "unknown_source",
        "offline",
        "too_big",
        "bad_archive",
        "no_skills",
        "not_a_skill",
        "bad_name",
        "not_owned",
        "invalid",
        "import_failed",
        "taskforce_not_found",
        "taskforce_state",
    ]
    """Skills: ``unknown_source`` (not a link, path or ``owner/repo``), ``offline`` (the source cannot be reached),
    ``too_big``, ``bad_archive`` (a damaged or unsafe archive), ``no_skills`` (nothing there, or not the one named),
    ``not_a_skill``, ``bad_name``, ``not_owned`` (another app's skill, which Alpine does not change),
    ``invalid`` (a SKILL.md without front matter and a description).

    ``auth``: the key is missing or rejected. ``unreachable``: no answer from the address. ``unsupported``: the
    server does not list its models, so the model name has to be typed. ``not_a_folder``: the path is not a folder.
    ``invalid_config``: config.toml cannot be read; the message says where. ``exists``: a skill with that name is
    already there. ``no_access``: git found no repository there that this computer may see (a wrong address, or a
    sign-in needed; hosts answer both the same way). ``no_git_tools``: git is not installed (on macOS, Apple's command
    line developer tools). ``clone_failed``: git could not clone otherwise; the message is git's.
``invalid_name``: a tool file name is not lowercase letters, digits and ``_``. ``package_not_approved``: a tool
needs a package nobody approved.
``install_failed``: a package did not install. ``name_taken``: a tool name is already used. ``agent_not_found``:
no agent has the id. ``model_failed``: the model call behind a draft failed.
``not_found``: the memory suggestion was already approved or declined, or the other app's conversation to carry
over is gone. ``import_failed``: that conversation could not be read or has nothing to carry over.
``memory_full``: the scope filled up since the suggestion was made; the message says how full. ``map_read_only``:
the product map was written by a newer Alpine, so this one does not write it. ``reason_required``: 안 고침 needs a
one-line reason. ``replay_changed``: the re-run command changed after the user saw it. ``taskforce_not_found``: the
session has no such TF. ``taskforce_state``: the TF is not in a state for that action (started twice, say)."""


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


class ChatGPTAccountInfo(Message):
    """The ChatGPT account behind a connection that signs in instead of using a key. Tokens never leave the server."""

    email: str | None
    signed_in: bool
    """``False`` after signing out, or when the sign-in ended and has to be done again (``chatgpt/signIn``)."""
    plan_usage: bool
    """The user allowed alpine-code to use their ChatGPT plan. Without it, sign in again with ``consent``."""


class ConnectionInfo(Message):
    name: str
    """What model names start with: ``<name>/<model>``."""
    provider: str | None
    """A ``ProviderInfo.id``; ``None`` for a local or compatible server."""
    base_url: str | None
    billing: Billing
    has_key: bool
    """A key is saved or set in the environment, or a ChatGPT sign-in can run models."""
    account: ChatGPTAccountInfo | None = None
    """Set for a ChatGPT connection."""


class ConnectionsListParams(Message):
    pass


class ConnectionsListResult(Message):
    connections: list[ConnectionInfo]
    default_model: str | None
    providers: list[ProviderInfo]
    """Everything an API key connection can name."""


class ConnectionsModelsParams(Message):
    """A saved connection by ``connection``, or one that may not be saved yet: a provider, or the address of a
    compatible server. A ChatGPT connection is always a saved one."""

    connection: str | None = None
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None


class ConnectionsModelsResult(Message):
    models: list[str]
    """The models that can work as the agent, as far as the server says."""
    hidden: list[str] = []
    """Models of a saved connection the picker leaves out: all but each family's newest by default, all but the
    chosen ones on a server the models.dev catalog does not know (``connections/showModel`` changes it)."""


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


class ConnectionsRemoveParams(Message):
    """Forgets a connection and its saved key. A default model on it is cleared, so new sessions need a choice."""

    connection: str


class ConnectionsRemoveResult(Message):
    default_model: str | None


class ConnectionsShowModelParams(Message):
    """Shows a model of a saved connection in the picker, or leaves it out."""

    connection: str
    model: str
    shown: bool


class ConnectionsShowModelResult(Message):
    pass


class ConnectionsSetDefaultParams(Message):
    model: str
    """``<connection>/<model>``: what new sessions start with."""


class ConnectionsSetDefaultResult(Message):
    default_model: str


# Settings: what new sessions start with, besides the model (connections/setDefault).


class SettingsGetParams(Message):
    pass


class SettingsGetResult(Message):
    mode: Mode
    """The permission mode new sessions start with (config.toml ``mode``)."""
    review_model: str | None = None
    """``<connection>/<model>`` of auto mode's reviewer in new sessions; ``None``: each session's own model."""
    clone_folder: str
    """Where the app puts the repositories it clones (config.toml ``clone_folder``, else ``~/AlpineCode``)."""


class SettingsSetModeParams(Message):
    mode: Mode


class SettingsSetModeResult(Message):
    mode: Mode


class SettingsSetReviewModelParams(Message):
    review_model: str | None
    """``None``: each session's own model."""


class SettingsSetReviewModelResult(Message):
    review_model: str | None


class SettingsSetCloneFolderParams(Message):
    clone_folder: str | None
    """``None``: back to ``~/AlpineCode``."""


class SettingsSetCloneFolderResult(Message):
    clone_folder: str


# ChatGPT: a connection that signs in with the user's ChatGPT account and runs on their plan.
# The browser does the signing in; the server waits for it and announces the end with
# chatgpt/signInFinished.


class ChatGPTSignInParams(Message):
    """Starts a sign-in. The app opens ``url`` in the browser and waits for ``chatgpt/signInFinished``. Starting one
    cancels the sign-in still waiting, if any."""

    connection: str | None = None
    """Sign in again to this connection's account; ``None`` adds an account (or renews the one it turns out to be)."""
    consent: bool = False
    """Ask again for permission to use the plan, after the user declined it."""


class ChatGPTSignInResult(Message):
    attempt_id: str
    url: str
    """OpenAI's sign-in page. Also show it, for when no browser opens."""


class ChatGPTCancelSignInParams(Message):
    attempt_id: str


class ChatGPTCancelSignInResult(Message):
    pass


class ChatGPTSignOutParams(Message):
    """Ends the connection's sign-in at OpenAI and forgets its tokens. The connection stays, signed out."""

    connection: str


class ChatGPTSignOutResult(Message):
    revoked: bool
    """OpenAI confirmed it. When ``False``, the user can disconnect alpine-code in ChatGPT settings."""


class ChatGPTSignInFinishedParams(Message):
    """The end of a sign-in, whichever way it ended."""

    attempt_id: str
    result: Literal["connected", "declined", "cancelled", "timed_out", "failed"]
    connection: ConnectionInfo | None = None
    """With ``connected``: the connection now signed in, new or renewed."""
    message: str | None = None
    """With ``failed``: what went wrong, in English."""


# GitHub: a sign-in for the clone dialog (the user's repositories, and a token git can use). The device flow shows a
# code the user enters on github.com; the server polls and announces the end with github/signInFinished.


class GitHubAccountInfo(Message):
    login: str


class GitHubStatusParams(Message):
    pass


class GitHubStatusResult(Message):
    available: bool
    """This build knows its GitHub app (a client id); without one, GitHub sign-in is not offered."""
    account: GitHubAccountInfo | None
    access_url: str
    """GitHub's page for AlpineCode's access: revoke it, or ask an organization to allow it."""


class GitHubSignInParams(Message):
    """Starts a sign-in, cancelling one still waiting. The app shows ``user_code`` and opens ``verification_uri``."""


class GitHubSignInResult(Message):
    attempt_id: str
    user_code: str
    verification_uri: str


class GitHubCancelSignInParams(Message):
    attempt_id: str


class GitHubCancelSignInResult(Message):
    pass


class GitHubSignInFinishedParams(Message):
    """The end of a sign-in, whichever way it ended."""

    attempt_id: str
    result: Literal["connected", "declined", "cancelled", "timed_out", "failed"]
    account: GitHubAccountInfo | None = None
    message: str | None = None
    """With ``failed``: what went wrong, in English."""


class GitHubSignOutParams(Message):
    """Forgets the sign-in here. GitHub keeps the grant until the user revokes it at ``access_url``."""


class GitHubSignOutResult(Message):
    pass


class GitHubRepository(Message):
    full_name: str
    """``owner/name``."""
    clone_url: str
    private: bool
    pushed_at: str | None
    description: str | None


class GitHubReposParams(Message):
    """The repositories the sign-in can see, the most recently pushed first. Fails with ``auth`` when signed out (or
    GitHub no longer accepts the token, which is then forgotten) and ``unreachable`` when GitHub cannot be reached."""


class GitHubReposResult(Message):
    repositories: list[GitHubRepository]


# Projects: folders the user works in


class ProjectInfo(Message):
    path: str
    name: str
    branch: str | None
    """The checked-out branch; ``None`` outside git or on a detached HEAD."""
    last_used_at: datetime
    archived: bool
    last_agent: str | None
    """The agent the project's sessions used last; ``None`` before any."""


class ProjectsListParams(Message):
    pass


class CloneInfo(Message):
    """A repository being brought to this computer, or one that stopped before it got here."""

    id: str
    """The one the app gave in ``projects/clone``."""
    address: str
    name: str
    """The folder's name, which becomes the project's."""
    path: str
    """Where it goes."""
    state: Literal["receiving", "failed", "done", "cancelled"]
    """``done`` and ``cancelled`` are only ever announced: the clone then leaves ``projects/list``."""
    percent: int
    """0 to 100 over the whole clone."""
    received: int | None = None
    """Bytes received so far, while git says."""
    reason: Literal["no_access", "unreachable", "clone_failed"] | None = None
    """With ``failed``: as in ``ErrorData``."""
    message: str | None = None
    """With ``failed``: git's own last line, in English."""


class ProjectsListResult(Message):
    projects: list[ProjectInfo]
    """The most recently used first."""
    clones: list[CloneInfo]
    """Clones receiving, and failed ones the user has not dismissed; the oldest first."""


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
    """Brings a repository into the clone folder and opens it as a project.

    Answers once the host has answered: with ``project`` when the repository is already here (a project with the same
    ``origin``, or the same repository in the clone folder) or the clone already finished, else with ``clone``, which
    goes on in the background and announces itself through ``projects/cloneChanged``. A wrong address or a missing
    sign-in fails the request itself (``no_access``, ``unreachable``, ``no_git_tools``, ``clone_failed``), so the app
    can ask again before anything shows on the rail.
    """

    id: str
    """Chosen by the app, so it can cancel the clone before this request answers."""
    address: str
    """A URL, ``git@...``, or GitHub's ``owner/repo``."""
    username: str | None = None
    password: str | None = None
    """An HTTPS sign-in, given to git only; the macOS keychain keeps it when the clone succeeds."""


class ProjectsCloneResult(Message):
    project: ProjectInfo | None = None
    existing: bool = False
    """``project`` was already here; nothing was cloned."""
    clone: CloneInfo | None = None


class ProjectsCancelCloneParams(Message):
    """Stops a clone and removes what it wrote, or dismisses a failed one. Does nothing for an unknown id."""

    id: str


class ProjectsCancelCloneResult(Message):
    pass


class ProjectsCloneChangedParams(Message):
    """A clone moved on: more received, or it finished (``done``, with ``project``), failed or was cancelled."""

    clone: CloneInfo
    project: ProjectInfo | None = None


class ProjectsGitToolsParams(Message):
    pass


class ProjectsGitToolsResult(Message):
    ready: bool
    """git can run. On macOS it needs Apple's command line developer tools."""
    installable: bool
    """``projects/installGitTools`` can open an installer here (macOS)."""


class ProjectsInstallGitToolsParams(Message):
    """Opens Apple's installer for the command line developer tools. ``projects/gitTools`` says when it is done."""


class ProjectsInstallGitToolsResult(Message):
    pass


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


# Tools: built-in ones, the user's Python files, and agents that choose which a session gets.

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


class OfferedTool(Message):
    """A tool a session can get, and where it comes from."""

    tool: ToolSummary
    origin: Literal["builtin", "memory", "user"]
    optional: bool
    """Whether an agent can turn it off. One that cannot is in every session (the memory's tools)."""


class ToolsListParams(Message):
    cwd: str | None = None
    """The project folder whose sessions' tools to list; without it, what every project gets."""


class ToolsListResult(Message):
    tools: list[OfferedTool]
    """Every tool, the user's included, in the order a session gets them."""
    files: list[ToolFileInfo]
    """The user's tool files, with what each defines or why it does not load."""
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
    """An agent id to turn the file's new tools on in."""


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


AgentLook = Literal[
    "antenna",
    "hardhat",
    "glasses",
    "beret",
    "headphones",
    "cap",
    "chef",
    "sprout",
    "ribbon",
    "beanie",
    "bowtie",
    "grad",
]
"""The hat or accessory of an agent's character."""


class AgentInfo(Message):
    id: str
    """``default`` for the agent that always exists; empty to add a new one."""
    name: str
    """Empty for the default agent until it is renamed."""
    description: str
    model: str | None
    """``<connection>/<model>``; the default model when ``None``."""
    instructions: str
    """The role and way of working the user gave the agent."""
    tools: list[str]
    look: AgentLook
    color: int = Field(ge=1, le=8)
    """One of eight colours of the character."""
    skills_off: list[str] = Field(default_factory=list)
    """Skills the agent does not use; it has every other skill the user has."""


class AgentsListParams(Message):
    pass


class AgentsListResult(Message):
    agents: list[AgentInfo]
    """The default agent first."""


class AgentsSaveParams(Message):
    agent: AgentInfo


class AgentsSaveResult(Message):
    agent: AgentInfo


class AgentsDeleteParams(Message):
    id: str


class AgentsDeleteResult(Message):
    pass


# Skills: folders with a SKILL.md (agentskills.io) that teach the agent a task

SkillOrigin = Literal["project", "alpine", "agents", "claude", "codex"]
"""``alpine``: installed or made in Alpine, which may change and delete it. ``agents``, ``claude``, ``codex``: kept by
another app in ``~/.agents/skills``, ``~/.claude/skills`` or ``~/.codex/skills``, used where it is. ``project``: in
the project's own ``.agents/skills``, ``.alpine-code/skills`` or ``.claude/skills``."""


class SkillInfo(Message):
    name: str
    description: str
    origin: SkillOrigin
    source: str | None
    """Where Alpine installed it from: a link, ``owner/repo/skill`` or a file."""
    folder: str
    has_scripts: bool
    """It brings code the agent may run."""
    notes: list[str]
    """What is off about its file, though it loads."""


class SkillCandidate(Message):
    """A skill found at a source, not installed yet."""

    name: str
    description: str
    has_scripts: bool
    installed: bool
    """A skill with this name is in the library already; adding it again replaces Alpine's copy."""


class SkillsListParams(Message):
    cwd: str | None = None
    """A project folder, to include its own skills."""


class SkillsListResult(Message):
    skills: list[SkillInfo]
    folder: str
    """Where Alpine keeps the skills it installs."""


class SkillsAddParams(Message):
    source: str
    """A GitHub or skills.sh link, an ``npx skills add`` line, ``owner/repo[/skill]``, a link to a zip or a
    ``SKILL.md``, or a path on this computer."""
    names: list[str] | None = None
    """The skills to add from a source that has several; all of them when the source has one or names it."""


class SkillsAddResult(Message):
    source: str
    added: list[SkillInfo]
    choices: list[SkillCandidate]
    """When the source has several skills and ``names`` was not given: what it has, and nothing is added."""


class SkillsGetParams(Message):
    name: str
    cwd: str | None = None


class SkillsGetResult(Message):
    skill: SkillInfo
    text: str
    """The whole SKILL.md."""
    files: list[str]
    """Its other files, relative to its folder."""


class SkillsSaveParams(Message):
    name: str
    text: str
    """The whole SKILL.md."""
    new: bool = False


class SkillsSaveResult(Message):
    skill: SkillInfo


class SkillsRemoveParams(Message):
    name: str


class SkillsRemoveResult(Message):
    pass


class SkillHit(Message):
    name: str
    source: str
    """``owner/repo``."""
    id: str
    """What ``skills/add`` takes."""
    installs: int


class SkillsSearchParams(Message):
    query: str


class SkillsSearchResult(Message):
    hits: list[SkillHit]
    """From skills.sh, the most installed first."""


# Sessions

Mode = Literal["default", "accept_edits", "auto", "yolo"]
"""The core's permission modes: ask before edits and commands, ask before commands only, let a reviewer model
decide what ``accept_edits`` would ask, or never ask."""

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


ActivityKind = Literal["thinking", "writing", "running_tool", "reviewing", "waiting_approval", "compacting"]
"""``thinking``: request sent, no text yet. ``writing``: reply text streaming. ``running_tool``: a tool call runs.
``reviewing``: auto mode's reviewer decides about a call (``tool_name``). ``waiting_approval``: an approval is
active. ``compacting``: the context is being summarized."""


class Activity(Message):
    kind: ActivityKind
    tool_name: str | None
    """The tool of ``running_tool`` (the latest, if several run together); ``None`` otherwise."""
    since: datetime


class SessionInfo(Message):
    id: str
    title: str
    """The first user message, shortened."""
    pinned: bool = False
    archived: bool = False
    summary: str = ""
    """Short excerpt of the latest answer; empty for conversations saved before this field existed."""
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
    context_tidy_at: int | None
    """The length in tokens past which the conversation is tidied (near the window's end, or before a price step);
    the context pie is full there. ``None`` when the window is unknown: the conversation grows until the provider
    refuses it."""
    activity: Activity | None
    """What the session is doing; ``None`` when idle."""
    run_started_at: datetime | None
    """When the current run started; ``None`` when idle."""
    run_usage: Usage | None
    """Usage since the current run started; ``None`` when idle."""
    agent: str | None
    """The id of the agent the session works as."""


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
    agent: str | None = None
    """The id of the agent that wrote it; ``None`` for older answers written without one."""


class CommandResult(Message):
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    timed_out: bool = False
    cancelled: bool = False
    message: str | None = None


class FileChange(ItemModel):
    path: str
    added: int = 0
    removed: int = 0
    diff: list[str] | None = None
    """Actual baseline-to-current diff; None for binary or oversized files."""


class SessionCheckpoint(Message):
    id: str
    label: str
    created_at: str
    status: str


class SessionChangesParams(Message):
    session_id: str
    checkpoint_id: str | None = None


class SessionChangesResult(Message):
    checkpoints: list[SessionCheckpoint]
    files: list[FileChange]
    available: bool


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
    command_result: CommandResult | None = None
    file_changes: list[FileChange] | None = None
    """Cumulative actual session changes. None in old records or when collection was unavailable."""


class AgentAsk(ItemModel):
    """One TF agent's call on an approval card: a card groups the agents that ask the same question, and shows each
    one's call under its task."""

    agent: str
    """The agent's id in its TF; ``session/answer`` names it to decline only this call."""
    task: str
    """What the agent does, in the TF script's words."""
    call_id: str
    title: str
    preview: str | None = None
    preview_kind: Literal["command", "diff", "text"] | None = None
    tool: str = ""
    args: dict[str, Any] = Field(default_factory=dict)


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
    tool: str = ""
    """The call's tool and arguments, so the app can draw the call it asks about (empty in older sessions)."""
    args: dict[str, Any] = Field(default_factory=dict)
    review: Literal["blocked_in_a_row", "failed"] | None = None
    """In auto mode, why the user is asked instead of the reviewer: it blocked 3 calls in a row, or it failed."""
    review_error: str | None = None
    """What went wrong when ``review`` is ``failed``, in the error's own words."""
    asked_by: list[AgentAsk] = Field(default_factory=list)
    """The TF agents waiting for this answer, each with its own call: several when they asked the same thing (the
    same "don't ask again" rule). Empty when the session's own model asks."""


class ReviewBlockedItem(ItemModel):
    """Auto mode's reviewer blocked a call; the model was told ``reason`` and went on. The call follows as a denied
    ``tool_call`` with the same ``call_id``."""

    id: str
    kind: Literal["review_blocked"] = "review_blocked"
    call_id: str
    tool: str
    args: dict[str, Any]
    reason: str | None = None
    """A few words from the reviewer, in the user's language when it follows the instructions."""


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


class MemoryReviewItem(ItemModel):
    """Something the harness noticed about the project's memory during the run, waiting on the memory page. Only the
    user reads it."""

    id: str
    kind: Literal["memory_review"] = "memory_review"
    source: str
    """What noticed it, which says what it was: ``missing_paths`` (a memory names a path that is gone)."""
    count: int


class CompactionItem(ItemModel):
    """The conversation was tidied: old tool results cleared, then, if that was not enough, summarized."""

    id: str
    kind: Literal["compaction"] = "compaction"
    before_tokens: int
    after_tokens: int
    summary: str | None = None
    """What the model keeps of the older conversation; ``None`` when it was not summarized."""
    cleared: int = 0
    """How many old tool results were cleared."""


class RunStoppedItem(ItemModel):
    """Why a run ended other than by answering."""

    id: str
    kind: Literal["run_stopped"] = "run_stopped"
    reason: Literal["interrupted", "failed", "limit", "repeating", "permission", "plan_limit", "signed_out"]
    """``plan_limit``: the ChatGPT plan's usage limit (or this app's share of it) was reached; point to ChatGPT's
    usage settings. ``signed_out``: the ChatGPT sign-in ended; sign in again (``chatgpt/signIn``)."""
    message: str | None = None


class AgentSwitchedItem(ItemModel):
    """The session went on with another agent from here."""

    id: str
    kind: Literal["agent_switched"] = "agent_switched"
    agent: str
    name: str
    look: AgentLook
    color: int


class AgentChangedItem(ItemModel):
    """The agent was edited between two turns in a way the model sees."""

    id: str
    kind: Literal["agent_changed"] = "agent_changed"
    agent: str
    name: str
    look: AgentLook
    color: int
    added: list[str]
    """Tools the agent got."""
    removed: list[str]
    """Tools the agent lost."""
    instructions: bool
    """Whether the instructions changed."""
    model: str | None
    """The model the agent switched to; ``None`` if it did not."""


ImportSource = Literal["claude_code", "codex"]


class ImportedItem(ItemModel):
    """Where a conversation carried over from another app ends; the session goes on from here."""

    id: str
    kind: Literal["imported"] = "imported"
    source: ImportSource


TaskForceStatus = Literal[
    "proposed", "declined", "running", "over", "stopping", "done", "stopped", "failed", "interrupted"
]
"""``proposed``: waits for 시작 or 혼자 하기. ``over``: the script wants more agents than the plan (``needed``).
``stopping``: no new agents, working ones finish their reply. ``interrupted``: the app closed mid-run; it can continue
(``taskforce/resume``) or hand over what finished (``taskforce/takeResults``)."""


class TaskForceStep(Message):
    """One step of the plan the card shows."""

    title: str
    count: int
    model: str


class TaskForceMember(Message):
    """One agent of a TF, as the room and the agent list draw it."""

    id: str
    step: str
    """The step it belongs to (a ``TaskForceStep.title`` when the script follows its plan)."""
    task: str
    """What it does, in the script's words (a topic, a file)."""
    agent: str
    """The name of the user's agent it works as; empty for the default agent never renamed."""
    look: AgentLook
    color: int
    model: str
    state: Literal["queued", "working", "asking", "done", "failed", "stopped"]
    activity: Literal["thinking", "writing", "read", "search", "edit", "run", "tool"] | None = None
    turn: int = 0
    source: str | None = None
    """The member whose answer it got: it walks over to hand it."""
    cached: bool = False
    """Answered from an earlier run of the script."""
    error: str | None = None
    """Why a ``failed`` member did not finish, as the error said it (a provider error, an answer that was not the
    JSON asked for)."""
    retried: str | None = None
    """The first error, when the agent was started over from its prompt after a provider error (once)."""


class TaskForceItem(ItemModel):
    """A TF: the session's model proposed it, then the user starts it and its agents work. Sent again with the same
    id (``item_started``) as it changes; completed when it is over."""

    id: str
    kind: Literal["taskforce"] = "taskforce"
    title: str
    steps: list[TaskForceStep]
    minutes: int
    status: TaskForceStatus
    members: list[TaskForceMember] = Field(default_factory=list)
    step: str = ""
    """The step the script is in."""
    log: str | None = None
    """The script's latest line for the user."""
    needed: int | None = None
    """While ``over``: how many agents the script wants in all."""
    error: str | None = None
    started_at: datetime | None = None
    """When the user pressed 시작 (or 이어 하기); ``None`` before."""


Item = Annotated[
    UserMessageItem
    | AgentMessageItem
    | ToolCallItem
    | ApprovalItem
    | ReviewBlockedItem
    | NoticeItem
    | StatusLineItem
    | MemoryReviewItem
    | CompactionItem
    | RunStoppedItem
    | AgentSwitchedItem
    | AgentChangedItem
    | ImportedItem
    | TaskForceItem,
    Field(discriminator="kind"),
]


class TaskForceParams(Message):
    """Names a TF of a session. ``taskforce/start`` (시작), ``taskforce/decline`` (혼자 하기), ``taskforce/stop``
    (멈추기, 여기까지 결과 받기), ``taskforce/allowMore`` (more agents than planned) and ``taskforce/takeResults``
    (after the app closed mid-run) take only this. A TF not in a state for the action fails with
    ``taskforce_state``; an unknown one with ``taskforce_not_found``."""

    session_id: str
    run_id: str


class TaskForceResult(Message):
    pass


class TaskForceResumeParams(TaskForceParams):
    """이어 하기 after the app closed mid-run."""

    fresh: bool = False
    """Start over instead of reusing the agents that finished."""


class TaskForceAgentParams(TaskForceParams):
    member_id: str


class TaskForceStopAgentResult(Message):
    stopped: bool
    """``False`` if the agent had already ended."""


class TaskForceRecordResult(Message):
    items: list[Item]
    """What the agent did, drawn like a session's items. Read-only."""


class SessionNewParams(Message):
    cwd: str
    model: str | None = None
    """``<connection>/<model>``; overrides the agent's model."""
    mode: Mode | None = None
    agent: str | None = None
    """An agent id; the project's last agent, else the default agent, when omitted."""


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
    agent: str | None = None
    """With ``deny`` on a card TF agents ask: declines only this agent's call (an ``AgentAsk.agent``); the agent goes
    on without it and the card stays for the others."""


class SessionAnswerResult(Message):
    accepted: bool
    """``False`` if the approval was already answered."""


class SessionSetModeParams(Message):
    session_id: str
    mode: Mode


class SessionSetModeResult(Message):
    info: SessionInfo


class SessionSetModelParams(Message):
    """Switches the model from the next message on; the conversation goes on. Not while the session runs."""

    session_id: str
    model: str
    """``<connection>/<model>``."""


class SessionSetModelResult(Message):
    info: SessionInfo


class SessionSetAgentParams(Message):
    """Goes on with another agent from the next message on. Not while the session runs. An unknown id fails with
    ``agent_not_found``."""

    session_id: str
    agent: str
    """An agent id."""


class SessionSetAgentResult(Message):
    info: SessionInfo


class SessionSearchParams(Message):
    query: str
    limit: int = Field(default=50, ge=1, le=100)


class SessionSearchHit(Message):
    info: SessionInfo
    excerpt: str


class SessionSearchResult(Message):
    hits: list[SessionSearchHit]


class SessionSetDetailsParams(Message):
    session_id: str
    title: str | None = None
    pinned: bool | None = None
    archived: bool | None = None


class SessionSetDetailsResult(Message):
    info: SessionInfo


class SessionDeleteParams(Message):
    session_id: str


class SessionDeleteResult(Message):
    pass


class ExternalSessionInfo(Message):
    """A conversation Claude Code or Codex had in the folder, which can be carried over and continued here."""

    source: ImportSource
    id: str
    """The other app's id for it."""
    title: str
    updated_at: datetime
    """When the other app last wrote to it."""
    imported: str | None
    """The session it was already carried over as, while the other app has not added to it since; ``None``
    otherwise."""


class SessionImportableParams(Message):
    cwd: str


class SessionImportableResult(Message):
    sessions: list[ExternalSessionInfo]
    """The other apps' conversations in the folder or a folder inside it, most recently changed first."""


class SessionImportParams(Message):
    """Carries a conversation over as a new session of ``cwd``; its earlier messages, tool calls and results come
    with it, and the next message continues it."""

    cwd: str
    source: ImportSource
    id: str


class SessionImportResult(Message):
    info: SessionInfo


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


# Memory

MemoryScope = Literal["team", "project_me", "me"]


class MemoryEvidence(Message):
    """Where a suggestion came from, as the harness saw it."""

    session_id: str
    at: datetime
    quote: str
    """The user's last message when it was made."""


class MemoryCheck(Message):
    """What the harness checks while the agent works, in the forms memory rules take (English, for the model)."""

    when: str
    expect: str
    say: str
    """What the agent is told when it fails, in the user's words."""


class MemoryGuard(Message):
    """A call the user is always asked about, whatever the mode."""

    before: str
    say: str
    """Why it asks; the approval card shows it."""


class MemoryInfo(Message):
    id: str
    kind: str
    """``rule``, ``fact``, ``lesson`` or ``user`` by default; the kinds can be replaced."""
    scope: MemoryScope
    headline: str
    """What the model sees in its prompt: what must be known without opening it."""
    body: str
    """The reason and examples, read when needed."""
    path: str | None
    evidence: list[MemoryEvidence]
    said_again: list[MemoryEvidence]
    """Suggestions close to it after it was approved: it was not followed, or needs saying better."""
    check: MemoryCheck | None = None
    guard: MemoryGuard | None = None


class MemorySuggestionInfo(Message):
    id: str
    kind: str
    scope: MemoryScope
    headline: str
    body: str
    replaces: list[str]
    """Memories of the same scope it changes, merges or removes, by id."""
    evidence: list[MemoryEvidence]
    source: str
    """Who suggested it: ``agent`` for the working agent, ``missing_paths`` for the harness when paths a memory names
    are gone (each evidence's ``quote`` is then the missing paths)."""
    remove: bool
    """It removes the memory in ``replaces`` instead of keeping something; ``headline`` and ``body`` are that
    memory's."""
    check: MemoryCheck | None = None
    guard: MemoryGuard | None = None


class MemoryListParams(Message):
    cwd: str
    """The project folder."""


class MemoryListResult(Message):
    memories: list[MemoryInfo]
    pending: list[MemorySuggestionInfo]


class MemoryApproveParams(Message):
    cwd: str
    suggestion_id: str


class MemoryApproveResult(Message):
    memory: MemoryInfo


class MemoryRejectParams(Message):
    cwd: str
    suggestion_id: str


class MemoryRejectResult(Message):
    pass


class MemoryForgetParams(Message):
    cwd: str
    scope: MemoryScope
    memory_id: str


class MemoryForgetResult(Message):
    pass


class MemoryChangedParams(Message):
    """A project's memories or suggestions changed; ``memory/list`` has the new ones."""

    cwd: str


# Product map: a project-owned document, readable and editable by the coding agent.


# Layout (docs/map-upkeep.md, decision 7): `.alpine-code/map/map.json` (MapFile), `features/<id>.json` (FeatureFile),
# `flows/<id>.json` (FlowFile) are written by the agent. `.alpine-code/map/state/` is written only by Alpine. The server
# assembles them into one ProductMap for the app.


class FlowCondition(Message):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    expectation: str = Field(min_length=1, max_length=2000)
    """Observable outcome under a specific condition, written for the user/caller."""


class ObservationSource(Message):
    """Where an observation came from, so Alpine can compare it with its own records. The agent writes this; the
    server never trusts it without checking."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["tool_call", "file", "surface_action", "surface_capture"]
    session_id: str | None = Field(default=None, max_length=100)
    """Session that holds the tool call, action or capture; for ``file``, the session that made or changed it."""
    ref: str = Field(default="", max_length=500)
    """Tool call id, project-relative file path, or surface action/capture id. For ``tool_call`` it may be empty:
    the server then looks for the excerpt in every tool call of that session."""


class Observation(Message):
    """One thing the agent saw while checking a promise, in words a non-developer can read."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=300)
    """Plain sentence: what this shows, e.g. "환불 계산 결과: 180,000원"."""
    show: Literal["text", "image", "video", "table", "diff", "request", "link"] = "text"
    """Rendering hint, not a closed list of evidence kinds."""
    source: ObservationSource | None = None
    """None: the agent's own words, shown as such."""
    excerpt: str = Field(default="", max_length=4000)
    """Verbatim text the agent read from the source; it must appear there."""
    expected: str = Field(default="", max_length=500)
    actual: str = Field(default="", max_length=500)


class ObservationProvenance(Message):
    """The server's label for one observation, computed on every read. The agent never writes it."""

    label: Literal["verified", "captured", "read", "mismatch", "agent"]
    """verified: Alpine이 확인함 (in the output of something the agent ran). captured: Alpine이 직접 찍음. read: the
    words are in a file the agent read or searched, so they show what the code says, not what it did (AI가 코드를 읽고
    판단함). mismatch: 기록과 다름. agent: AI 설명."""
    reason: Literal[
        "",
        "call_not_found",
        "excerpt_missing",
        "no_excerpt",
        "session_not_found",
        "other_project",
        "file_missing",
        "file_changed",
        "surface_not_found",
        "outside_session",
        "alpine_record",
    ] = ""
    """Why it is a mismatch; empty otherwise."""
    matched: str = ""
    """The tool call id whose recorded result held the excerpt, when verified."""
    elsewhere: bool = False
    """The label was computed on another computer and is shown as recorded there; this one cannot compare it."""


class FlowReplay(Message):
    """How Alpine can re-run a check without a model (decision 5). The agent leaves it out for checks with side
    effects such as real payments or mail."""

    model_config = ConfigDict(extra="forbid")

    command: str = Field(min_length=1, max_length=2000)
    cwd: str = Field(default=".", max_length=500)
    """Project-relative folder to run in."""
    expect: list[str] = Field(default_factory=list, max_length=20)
    """Text that must appear again in the output. Empty: the excerpts Alpine verified from the original check.
    Leave out volatile text such as durations or timestamps."""


class FlowCheck(Message):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default="", max_length=100)
    """The agent gives every run a new id, so an identical re-run still counts as new. Empty: Alpine uses a hash of
    the check."""
    condition_id: str | None = None
    expectation: str = Field(default="", max_length=2000)
    """Snapshot of the linked condition at execution time; edits require rechecking."""
    summary: str = Field(max_length=2000)
    command: str = Field(max_length=2000)
    result: Literal["passed", "failed", "blocked"]
    output: str = Field(max_length=8000)
    depends_on: list[str] = Field(default_factory=list, max_length=200)
    """Project-relative files this result depends on (sources and tests). Alpine records their hashes."""
    plain: str = Field(default="", max_length=1000)
    """One plain sentence of the result in the user's language, for people who do not read command output."""
    screenshot: str | None = None
    """Optional project-relative PNG/JPEG/WebP screenshot taken during the check. Never an external URL."""
    steps: list[str] = Field(default_factory=list, max_length=20)
    """What was tried, in order (해본 것)."""
    observations: list[Observation] = Field(default_factory=list, max_length=20)
    limits: list[str] = Field(default_factory=list, max_length=20)
    """What could not be checked (확인 못 한 것)."""
    environment: str = Field(default="", max_length=200)
    """Where it was checked, e.g. "로컬 개발 서버 · 토스 테스트 결제"."""
    replay: FlowReplay | None = None


class FeatureFile(Message):
    """``.alpine-code/map/features/<id>.json``: one card, written by the agent."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    kind: Literal["screen", "api", "sdk", "process", "data"] = "process"
    tags: list[Annotated[str, Field(min_length=1, max_length=40)]] = Field(default_factory=list, max_length=50)
    """A few short words for finding the card: the product part or topic it belongs to (결제, 관리자). The agent's
    choice; there is no fixed list."""
    area: SkipJsonSchema[str | None] = Field(default=None, exclude=True)
    """Maps made before 2026-10-13 grouped cards into areas: read as a tag, never written."""
    phase: Literal["planned", "building", "built"] = "planned"
    sources: list[str] = Field(default_factory=list, max_length=100)
    preview: str | None = None
    """Optional project-relative PNG/JPEG/WebP screenshot. Never an external URL."""
    preview_at: str | None = Field(default=None, max_length=40)
    """ISO 8601 UTC time the preview screenshot was taken."""
    example: str = Field(default="", max_length=2000)
    how_to_try: str = Field(default="", max_length=1000)
    """What a person needs to try this card themselves (a test account, keys, seed data, a command, a running
    server), in plain words. Written by the agent; the user may rewrite it in the app."""
    conditions: list[FlowCondition] = Field(default_factory=list, max_length=60)
    checks: list[FlowCheck] = Field(default_factory=list, max_length=60)
    """One current check per condition; the server keeps the history of results."""

    @model_validator(mode="after")
    def condition_references(self) -> FeatureFile:
        ids = {condition.id for condition in self.conditions}
        linked = [check.condition_id for check in self.checks if check.condition_id is not None]
        if len(ids) != len(self.conditions):
            raise ValueError("Duplicate condition id")
        if not set(linked) <= ids or len(set(linked)) != len(linked):
            raise ValueError("Unknown or duplicate condition check")
        return self


class FlowNode(FeatureFile):
    """A card as the app sees it: the agent's file plus the user's decisions and the session link Alpine keeps."""

    priority: Literal["must", "should", "later"] | None = None
    """The user's call on importance. Set only through ``flow/set``; the agent never sets it."""
    scope: Literal["now", "next", "out"] | None = None
    """The user's call on timing (this round, next, not doing). Set only through ``flow/set``."""
    decision: str = Field(default="", max_length=500)
    """One-line decision memo written by the user."""
    session_id: str | None = None
    """The session last started on this card from the app."""


class FlowEdge(Message):
    model_config = ConfigDict(extra="forbid")

    source: str
    target: str
    label: str = Field(default="", max_length=100)


class ProductFlow(Message):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=300)
    """One plain sentence of what the journey must let someone do, e.g. "회원이 이용권이 없을 때 수업을 고르면
    결제하고 바로 예약할 수 있어야 한다." Shown under the flow's title."""
    trigger: str = Field(default="", max_length=200)
    """Who starts this journey and what they do first, shown as the flow's start."""
    node_ids: list[str] = Field(default_factory=list, max_length=200)
    """The journey's steps: card ids, or ``flow:<flow id>`` for a step that calls another flow (the ways to one result
    gathered in their own flow, e.g. connecting a model). Edges use the same ids."""
    edges: list[FlowEdge] = Field(default_factory=list, max_length=400)
    """This journey's own transitions. The same two cards may be joined differently in another flow (another door),
    so a flow is drawn with these, not with the map's merged ``edges``."""


class FlowFile(ProductFlow):
    """``.alpine-code/map/flows/<id>.json``: one journey and the transitions between its cards, written by the agent."""


class UnmappedPart(Message):
    """A part of the product the agent knows exists but has not mapped yet."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    """What it is, in the user's words, e.g. "운영자 콘솔에서 사용자 정지·복구하기"."""
    why: str = Field(default="", max_length=1000)
    """Why it is not mapped yet (not reached, too large for this session, unclear what it promises)."""
    paths: list[str] = Field(default_factory=list, max_length=20)
    """Project-relative files or folders where it lives."""


class MapFile(Message):
    """``.alpine-code/map/map.json``, written by the agent."""

    model_config = ConfigDict(extra="forbid")

    format_version: Literal[1] = 1
    """Readers newer than this convert it; older readers show the map read-only."""
    areas: SkipJsonSchema[list[dict[str, Any]]] = Field(default_factory=list, exclude=True)
    """Maps made before 2026-10-13 listed areas here: read (their titles become tags of old cards), never written."""
    exclude: list[str] = Field(default_factory=list, max_length=200)
    """Glob patterns (gitignore style) of files unrelated to the map, e.g. "**/*.lock". The agent's call."""
    unmapped: list[UnmappedPart] = Field(default_factory=list, max_length=100)
    """Parts of the product the agent knows exist but has not mapped yet; entries go once they are mapped."""
    proposed_include: SkipJsonSchema[list[str]] = Field(default_factory=list, exclude=True)
    """No longer used: maps made before 2026-10-13 may carry it, and it is read and ignored, never written."""


class MapProblem(Message):
    """Something in the map files Alpine could not use. The rest of the map still shows."""

    file: str
    """Project-relative path of the file."""
    message: str


class ProductMap(Message):
    """The assembled map the app shows."""

    model_config = ConfigDict(extra="forbid")

    flows: list[ProductFlow] = Field(default_factory=list)
    nodes: list[FlowNode] = Field(default_factory=list)
    edges: list[FlowEdge] = Field(default_factory=list)


class FlowGetParams(Message):
    cwd: str
    since: str | None = None
    """The ``etag`` the app already shows. When nothing changed the result has ``unchanged`` set and nothing
    else filled in."""


class FlowChange(Message):
    """One recorded change to the map, kept by the server next to the document."""

    at: str
    node_id: str
    title: str
    kind: Literal[
        "added",
        "removed",
        "phase",
        "check_passed",
        "check_failed",
        "check_blocked",
        "promise_added",
        "promise_changed",
        "promise_confirmed",
        "issue_later",
        "issue_wontfix",
        "issue_reopened",
        "exclude_changed",
        "replay_same",
        "replay_different",
    ]
    detail: str = ""


class CheckStamp(Message):
    """Facts Alpine recorded about one check run (decisions 1 and 2)."""

    at: str
    """When the check was written (ISO 8601 UTC)."""
    session_id: str | None = None
    """The session that wrote it, when Alpine could tell."""
    first_seen: bool = False
    """No session wrote it: ``at`` is when Alpine first saw it, not when it ran."""
    witness: Literal["mine", "other", "mismatch"] = "mine"
    """mine: this computer recorded it. other: recorded on another computer, cannot be compared here.
    mismatch: this computer recorded something different (the shared file was edited)."""
    uncertain: bool = False
    """Some files it depends on changed between the run and the moment Alpine recorded it."""


class ReplayState(Message):
    key: str = ""
    """Identifies the exact command and folder; the app sends it back when the user approves."""
    approved: bool = False
    """The user allowed this exact command and folder to run without a model on this computer."""
    running: bool = False
    at: str | None = None
    """When it last ran."""
    same: bool | None = None
    """True: the same result as the check. False: different. None: never ran."""
    output: str = ""
    """The tail of the last run's output."""


IssueState = Literal["", "open", "resolved", "regressed", "maybe_fixed", "later", "wontfix", "question"]


class PromiseState(Message):
    """Everything Alpine computed about one promise."""

    status: Literal["passed", "failed", "blocked", "recheck", "unconfirmed"]
    issue: IssueState = ""
    """open: the latest check failed. resolved: a pass came after a failure. regressed: a resolved promise failed
    again. maybe_fixed: an open (or later) issue's files changed since. later / wontfix: the user's choice.
    question: an AI-inferred promise failed ("이게 맞는 규칙인가요?")."""
    origin: Literal["inferred", "confirmed", "plan"] = "inferred"
    reason: str = ""
    """The user's reason for wontfix."""
    since: str | None = None
    """When the current issue state began."""
    stamp: CheckStamp | None = None
    changed: list[str] = Field(default_factory=list)
    """Files the current check depends on that changed since it ran."""
    replay: ReplayState | None = None
    reworded: bool = False
    """The user wrote or confirmed this promise, then its text changed outside the app: "AI가 내가 정한 걸 바꿨어요".
    ``mine`` holds the user's text when Alpine kept it, so the app can offer to restore it (``flow/review``)."""
    mine: str = ""
    """The user's own text of this promise, when it differs from the current one."""
    written: bool = False
    """The user wrote this promise's text in the app (``flow/edit``), rather than confirming the agent's."""
    decided_elsewhere: bool = False
    """The confirmation or the user's 나중에 보기 / 안 고침 was recorded on another computer and cannot be compared
    here."""


class RemovedPromise(Message):
    id: str
    text: str


class NodeState(Message):
    status: Literal["failed", "question", "recheck", "unconfirmed", "passed", "none"]
    """Worst first. question: only AI-inferred promises failed."""
    passed: int = 0
    total: int = 0
    promises: dict[str, PromiseState] = Field(default_factory=dict)
    changed: bool = False
    """Files of this card changed since its checks ran: 바뀜 · 확인 필요."""
    missing: list[str] = Field(default_factory=list)
    """Files the card points to that no longer exist."""
    unread: list[str] = Field(default_factory=list)
    """Sources the Alpine sessions that wrote this card never opened (read, searched or edited). Empty when the card
    was last written outside Alpine, since then nothing is known."""
    overridden: dict[str, str] = Field(default_factory=dict)
    """Card sentences the user wrote in the app (``title``, ``howToTry``) whose text changed since: field -> the
    user's text."""
    removed_promises: list[RemovedPromise] = Field(default_factory=list)
    """Promises the user wrote or confirmed that are no longer in the card."""


class RemovedCard(Message):
    """A card the user made decisions on (wrote, confirmed or planned) that is no longer in the map."""

    id: str
    title: str


class MapReview(Message):
    """What a "지도 고치기" session changed, waiting for the user to accept it or put the map back (decision 16)."""

    session_id: str
    at: str
    """When the session started."""
    added: list[str] = Field(default_factory=list)
    """Titles of new cards."""
    removed: list[str] = Field(default_factory=list)
    """Titles of cards that are gone."""
    changed: list[str] = Field(default_factory=list)
    """Titles (current) of cards whose title, promises or flows changed."""


class MapCoverage(Message):
    """Changes the map does not cover (decision 3)."""

    git: bool = False
    """False: the project is not a git repository, so uncovered changes cannot be known."""
    uncovered: list[str] = Field(default_factory=list)
    """Changed files inside the scope that no card covers, at most 200."""
    uncovered_count: int = 0
    out_of_scope: int = 0
    excluded: int = 0
    """Changed files hidden by ``exclude``."""
    since: str | None = None
    """The commit changes are counted from."""


class MapSchedule(Message):
    """The optional scheduled 지도 점검 (decision 6), kept on this computer."""

    enabled: bool = False
    limit: int = Field(default=20, ge=1, le=500)
    last_run: str | None = None


class FlowGetResult(Message):
    revision: str
    """Hash of the map files and Alpine's state files. ``flow/prepare`` refuses a stale one."""
    etag: str = ""
    """Changes whenever anything in this result changes; the app sends it back as ``since``."""
    unchanged: bool = False
    document: ProductMap = Field(default_factory=ProductMap)
    exists: bool = False
    """A map exists in the project (new layout)."""
    read_only: bool = False
    """The map was written by a newer Alpine; this one shows it without writing."""
    previews: dict[str, str] = Field(default_factory=dict)
    changes: list[FlowChange] = Field(default_factory=list)
    """Recent changes, newest first, at most 200."""
    states: dict[str, NodeState] = Field(default_factory=dict)
    provenance: dict[str, list[ObservationProvenance]] = Field(default_factory=dict)
    """Labels for each shown check's observations, in order, keyed ``<nodeId>/<conditionId>``."""
    coverage: MapCoverage = Field(default_factory=MapCoverage)
    include: list[str] = Field(default_factory=list)
    """The user's scope: project-relative folders the map covers. Empty: the whole project."""
    exclude: list[str] = Field(default_factory=list)
    problems: list[MapProblem] = Field(default_factory=list)
    schedule: MapSchedule = Field(default_factory=MapSchedule)
    removed_cards: list[RemovedCard] = Field(default_factory=list)
    review: MapReview | None = None
    unmapped: list[UnmappedPart] = Field(default_factory=list)
    """What the agent knows it has not mapped yet (map.json ``unmapped``)."""
    """A finished "지도 고치기" session whose changes the user has not accepted or undone yet."""


class FlowNodeParams(Message):
    cwd: str
    node_id: str


class FlowNodeResult(Message):
    """Images for one card's checks, loaded when it opens."""

    check_screenshots: dict[str, str] = Field(default_factory=dict)
    """Data URLs keyed ``<conditionId>``."""
    observation_images: dict[str, str] = Field(default_factory=dict)
    """Data URLs for image observations from project files, keyed ``<conditionId>/<index>``."""


class FlowPrepareParams(Message):
    cwd: str
    revision: str
    action: Literal["discover", "extend", "change", "verify", "sync", "reshape"]
    """reshape: change the map's cards and flows as the user asks (split, merge, rename, move, remove), never the
    product's code. Alpine keeps the map as it was, so the user can accept the result or put it back."""
    request: str = Field(default="", max_length=8000)
    node_id: str | None = None
    flow_id: str | None = None
    node_ids: list[str] = Field(default_factory=list, max_length=500)
    """For ``verify``: a batch of cards to recheck (확인 필요 N개 확인하기)."""
    session_id: str


class FlowSetParams(Message):
    """One of the user's own decisions. Only Alpine writes them, into its own state files."""

    cwd: str
    node_id: str
    field: Literal["priority", "scope", "decision"]
    value: str | None = None


class FlowPromiseParams(Message):
    cwd: str
    node_id: str
    condition_id: str
    action: Literal["confirm", "unconfirm", "later", "wontfix", "reopen", "approve_replay", "revoke_replay"]
    reason: str = Field(default="", max_length=500)
    key: str = Field(default="", max_length=100)
    """For approve_replay: the ``ReplayState.key`` the user saw; a different current command is refused."""


class FlowEditParams(Message):
    """The user rewrites one sentence of a card in the app. Alpine writes it into the card file and records it as the
    user's own (decision 16). An empty ``value`` removes a promise or clears ``how_to_try``."""

    cwd: str
    node_id: str
    field: Literal["title", "how_to_try", "promise"]
    condition_id: str | None = None
    """For ``promise``: the promise to rewrite. None adds a new promise."""
    value: str = Field(default="", max_length=2000)


class FlowReviewParams(Message):
    """The user's answer to a change of something they decided, or to a "지도 고치기" session's result."""

    cwd: str
    target: Literal["promise", "field", "card", "map"]
    action: Literal["accept", "restore"]
    """accept: keep the map as it is now and take it as the user's. restore: put the user's version back."""
    node_id: str | None = None
    condition_id: str | None = None
    """For ``promise``."""
    field: Literal["title", "how_to_try"] | None = None
    """For ``field``."""


class FlowScopeParams(Message):
    cwd: str
    include: list[str] = Field(default_factory=list, max_length=100)


class FlowDeleteParams(Message):
    """Deletes the project's map: every file under ``.alpine-code/map/`` and this computer's records of it."""

    cwd: str


class FlowScheduleParams(Message):
    cwd: str
    enabled: bool
    limit: int = Field(default=20, ge=1, le=500)
    ran: bool = False
    """True: the app just started a scheduled run; record it as the last run."""


class FlowPrepareResult(Message):
    board: FlowGetResult
    prompt: str
    node_id: str | None = None


# New projects from the new-session screen (decision 13 in docs/alpine-cloud.md): the agent judges what was sent,
# and 만들기 makes a project from a stack template and starts the agent on the idea.

TemplateId = Literal["blank", "web-lite", "web-pro", "mobile"]
"""The stack templates the app shows. Only the ones the server has are offered to the model and can be made."""


class ProjectsJudgeParams(Message):
    """Is what was sent on the new-session screen work on a project, or a new app? One question to the default model,
    with no tools. The model judges; the server only checks the shape of its answer, and when the answer is unclear
    or malformed it is ``change``, so a new project is never made by mistake."""

    text: str = Field(min_length=1)
    locale: str
    """The app's language, such as ``ko`` or ``en-US``: ``reason`` is written in it."""
    cwd: str | None = None
    """The project the screen is on, so the model knows what "this project" is; ``None`` when there is none."""
    new_project: bool = False
    """The person chose 새로 만들기, so it is a new project: the model only picks the template, and the answer is
    always ``new`` (``web-lite``, else the first template the server has, with no reason, when the model's answer
    cannot be used)."""


class JudgedChange(Message):
    """Work on the project the screen is on: the app starts a session there, as before."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal["change"] = "change"


class JudgedNew(Message):
    """A new app, with the template that fits it."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)

    kind: Literal["new"] = "new"
    template: TemplateId
    """One the server has (``projects/create`` can make it)."""
    reason: str
    """One sentence in the user's language: why this template fits the idea."""
    name: str
    """A folder name for the project: lowercase letters, digits and ``-``, as the model suggested it or made safe."""


class ProjectsJudgeResult(Message):
    judgement: Annotated[JudgedChange | JudgedNew, Field(discriminator="kind")]


class ProjectsCreateParams(Message):
    """Makes a project from a template and starts the agent on the idea.

    The template is copied into ``<clone folder>/<name>`` (``<name>-2``, ``<name>-3``... when taken, as for clones),
    the folder becomes a git repository with the template as its first commit, and joins the projects. Then a session
    starts there and gets ``idea`` as its first message. Each step is announced through ``projects/createChanged``
    as it finishes; the request answers after the last one. Fails with ``not_found`` when the server has no such
    template, ``invalid_config`` when config.toml cannot be read. When the session cannot start, the project stays
    made and on the rail, and the error is the session's.
    """

    id: str
    """Chosen by the app; the progress notifications carry it."""
    idea: str = Field(min_length=1)
    template: TemplateId
    name: str
    """From ``JudgedNew.name``; made safe again here."""
    agent: str | None = None
    """As in ``session/new``."""
    mode: Mode | None = None
    """As in ``session/new``."""


class ProjectsCreateResult(Message):
    project: ProjectInfo
    session_id: str
    """The session working on the idea."""


CreateStep = Literal["folder", "address", "agent"]
"""``folder``: the template is in its folder, committed, and on the rail. ``address``: its web address, only when
signed in to Alpine (decision 23); nothing makes addresses yet, so the server does not send it. ``agent``: the session
started and has the idea."""


class ProjectsCreateChangedParams(Message):
    """A step of ``projects/create`` finished."""

    id: str
    step: CreateStep
    project: ProjectInfo
    """The project being made, so the app can show its folder."""


#: Every method an app can call: name -> (params, result).
METHODS: dict[str, tuple[type[Message], type[Message]]] = {
    **DEV_SERVER_METHODS,
    **FILE_METHODS,
    **PROCESS_METHODS,
    **TERMINAL_METHODS,
    "initialize": (InitializeParams, InitializeResult),
    "flow/get": (FlowGetParams, FlowGetResult),
    "flow/prepare": (FlowPrepareParams, FlowPrepareResult),
    "flow/set": (FlowSetParams, FlowGetResult),
    "flow/node": (FlowNodeParams, FlowNodeResult),
    "flow/promise": (FlowPromiseParams, FlowGetResult),
    "flow/edit": (FlowEditParams, FlowGetResult),
    "flow/review": (FlowReviewParams, FlowGetResult),
    "flow/scope": (FlowScopeParams, FlowGetResult),
    "flow/schedule": (FlowScheduleParams, FlowGetResult),
    "flow/delete": (FlowDeleteParams, FlowGetResult),
    "connections/list": (ConnectionsListParams, ConnectionsListResult),
    "connections/models": (ConnectionsModelsParams, ConnectionsModelsResult),
    "connections/add": (ConnectionsAddParams, ConnectionsAddResult),
    "connections/remove": (ConnectionsRemoveParams, ConnectionsRemoveResult),
    "connections/showModel": (ConnectionsShowModelParams, ConnectionsShowModelResult),
    "connections/setDefault": (ConnectionsSetDefaultParams, ConnectionsSetDefaultResult),
    "settings/get": (SettingsGetParams, SettingsGetResult),
    "settings/setMode": (SettingsSetModeParams, SettingsSetModeResult),
    "settings/setReviewModel": (SettingsSetReviewModelParams, SettingsSetReviewModelResult),
    "settings/setCloneFolder": (SettingsSetCloneFolderParams, SettingsSetCloneFolderResult),
    "chatgpt/signIn": (ChatGPTSignInParams, ChatGPTSignInResult),
    "chatgpt/cancelSignIn": (ChatGPTCancelSignInParams, ChatGPTCancelSignInResult),
    "chatgpt/signOut": (ChatGPTSignOutParams, ChatGPTSignOutResult),
    "github/status": (GitHubStatusParams, GitHubStatusResult),
    "github/signIn": (GitHubSignInParams, GitHubSignInResult),
    "github/cancelSignIn": (GitHubCancelSignInParams, GitHubCancelSignInResult),
    "github/signOut": (GitHubSignOutParams, GitHubSignOutResult),
    "github/repos": (GitHubReposParams, GitHubReposResult),
    "projects/list": (ProjectsListParams, ProjectsListResult),
    "projects/open": (ProjectsOpenParams, ProjectsOpenResult),
    "projects/archive": (ProjectsArchiveParams, ProjectsArchiveResult),
    "projects/delete": (ProjectsDeleteParams, ProjectsDeleteResult),
    "projects/clone": (ProjectsCloneParams, ProjectsCloneResult),
    "projects/cancelClone": (ProjectsCancelCloneParams, ProjectsCancelCloneResult),
    "projects/gitTools": (ProjectsGitToolsParams, ProjectsGitToolsResult),
    "projects/installGitTools": (ProjectsInstallGitToolsParams, ProjectsInstallGitToolsResult),
    "projects/git": (ProjectsGitParams, ProjectsGitResult),
    "projects/judge": (ProjectsJudgeParams, ProjectsJudgeResult),
    "projects/create": (ProjectsCreateParams, ProjectsCreateResult),
    "tools/list": (ToolsListParams, ToolsListResult),
    "tools/source": (ToolsSourceParams, ToolsSourceResult),
    "tools/check": (ToolsCheckParams, ToolsCheckResult),
    "tools/save": (ToolsSaveParams, ToolsSaveResult),
    "tools/confirm": (ToolsConfirmParams, ToolsConfirmResult),
    "tools/delete": (ToolsDeleteParams, ToolsDeleteResult),
    "tools/install": (ToolsInstallParams, ToolsInstallResult),
    "tools/test": (ToolsTestParams, ToolsTestResult),
    "tools/draft": (ToolsDraftParams, ToolsDraftResult),
    "agents/list": (AgentsListParams, AgentsListResult),
    "agents/save": (AgentsSaveParams, AgentsSaveResult),
    "agents/delete": (AgentsDeleteParams, AgentsDeleteResult),
    "skills/list": (SkillsListParams, SkillsListResult),
    "skills/add": (SkillsAddParams, SkillsAddResult),
    "skills/get": (SkillsGetParams, SkillsGetResult),
    "skills/save": (SkillsSaveParams, SkillsSaveResult),
    "skills/remove": (SkillsRemoveParams, SkillsRemoveResult),
    "skills/search": (SkillsSearchParams, SkillsSearchResult),
    "memory/list": (MemoryListParams, MemoryListResult),
    "memory/approve": (MemoryApproveParams, MemoryApproveResult),
    "memory/reject": (MemoryRejectParams, MemoryRejectResult),
    "memory/forget": (MemoryForgetParams, MemoryForgetResult),
    "session/new": (SessionNewParams, SessionNewResult),
    "session/list": (SessionListParams, SessionListResult),
    "session/open": (SessionOpenParams, SessionOpenResult),
    "session/changes": (SessionChangesParams, SessionChangesResult),
    "session/send": (SessionSendParams, SessionSendResult),
    "session/cancel": (SessionCancelParams, SessionCancelResult),
    "session/answer": (SessionAnswerParams, SessionAnswerResult),
    "session/search": (SessionSearchParams, SessionSearchResult),
    "session/setDetails": (SessionSetDetailsParams, SessionSetDetailsResult),
    "session/setMode": (SessionSetModeParams, SessionSetModeResult),
    "session/setModel": (SessionSetModelParams, SessionSetModelResult),
    "session/setAgent": (SessionSetAgentParams, SessionSetAgentResult),
    "session/delete": (SessionDeleteParams, SessionDeleteResult),
    "session/importable": (SessionImportableParams, SessionImportableResult),
    "session/import": (SessionImportParams, SessionImportResult),
    "taskforce/start": (TaskForceParams, TaskForceResult),
    "taskforce/decline": (TaskForceParams, TaskForceResult),
    "taskforce/stop": (TaskForceParams, TaskForceResult),
    "taskforce/allowMore": (TaskForceParams, TaskForceResult),
    "taskforce/resume": (TaskForceResumeParams, TaskForceResult),
    "taskforce/takeResults": (TaskForceParams, TaskForceResult),
    "taskforce/stopAgent": (TaskForceAgentParams, TaskForceStopAgentResult),
    "taskforce/record": (TaskForceAgentParams, TaskForceRecordResult),
}

#: Every notification the server sends: name -> params.
NOTIFICATIONS: dict[str, type[Message]] = {
    "session/event": SessionEventParams,
    "chatgpt/signInFinished": ChatGPTSignInFinishedParams,
    "memory/changed": MemoryChangedParams,
    "projects/cloneChanged": ProjectsCloneChangedParams,
    "projects/createChanged": ProjectsCreateChangedParams,
    "github/signInFinished": GitHubSignInFinishedParams,
}
