"""Messages between alpine-code apps and the alpine-code server. The source of truth for the protocol.

Messages are JSON-RPC 2.0, one JSON object per line. Field names are camelCase on the wire and snake_case in Python.
``schema/protocol.schema.json`` and the TypeScript types are generated from these models (see ``schema.py``).

Three rules hold for every method added here:

1. The server owns session state. An app shows what the server sends and asks for a snapshot when it (re)connects.
2. Every session event carries a sequence number, so an app can ask for what it missed after a given one.
3. Answers and approvals name the question or approval they answer. The first answer wins; later ones are refused.
"""

from .messages import (
    PROTOCOL_VERSION,
    ErrorObject,
    InitializeParams,
    InitializeResult,
    Request,
    Response,
    ServerInfo,
)

__all__ = [
    "PROTOCOL_VERSION",
    "Request",
    "Response",
    "ErrorObject",
    "InitializeParams",
    "InitializeResult",
    "ServerInfo",
]
