"""Message models. Each method has a ``<Method>Params`` and a ``<Method>Result``."""

from __future__ import annotations

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


#: Every method an app can call: name -> (params, result).
METHODS: dict[str, tuple[type[Message], type[Message]]] = {
    "initialize": (InitializeParams, InitializeResult),
}
