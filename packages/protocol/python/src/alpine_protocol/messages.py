"""Message models. Each method has a ``<Method>Params`` and a ``<Method>Result``."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

#: Bumped on every change an older app or server cannot read.
PROTOCOL_VERSION = 1


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
        "auth", "unreachable", "unsupported", "other", "not_a_folder", "invalid_config", "exists", "clone_failed"
    ]
    """``auth``: the key is missing or rejected. ``unreachable``: no answer from the address. ``unsupported``: the
    server does not list its models, so the model name has to be typed. ``not_a_folder``: the path is not a folder.
    ``invalid_config``: config.toml cannot be read; the message says where. ``exists``: the clone's folder is already
    there. ``clone_failed``: git could not clone; the message is git's."""


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
    hidden: bool


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


class ProjectsHideParams(Message):
    """Takes a project off the rail; its sessions stay, and opening the folder shows it again."""

    path: str


class ProjectsHideResult(Message):
    pass


class ProjectsCloneParams(Message):
    """Clones into ``parent/<repo name>`` and opens it. Blocks until git is done."""

    address: str
    """A URL, ``git@...``, or GitHub's ``owner/repo``."""
    parent: str


class ProjectsCloneResult(Message):
    project: ProjectInfo


#: Every method an app can call: name -> (params, result).
METHODS: dict[str, tuple[type[Message], type[Message]]] = {
    "initialize": (InitializeParams, InitializeResult),
    "connections/list": (ConnectionsListParams, ConnectionsListResult),
    "connections/models": (ConnectionsModelsParams, ConnectionsModelsResult),
    "connections/add": (ConnectionsAddParams, ConnectionsAddResult),
    "connections/setDefault": (ConnectionsSetDefaultParams, ConnectionsSetDefaultResult),
    "projects/list": (ProjectsListParams, ProjectsListResult),
    "projects/open": (ProjectsOpenParams, ProjectsOpenResult),
    "projects/hide": (ProjectsHideParams, ProjectsHideResult),
    "projects/clone": (ProjectsCloneParams, ProjectsCloneResult),
}
