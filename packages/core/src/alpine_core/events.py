"""Events the core sends to a frontend while it works.

A frontend passes ``on_event`` to ``Session`` and renders what arrives. Events are plain frozen dataclasses so any
frontend (terminal, TUI, IDE, web socket) can consume or serialize them without importing alpineagents.
Events arrive on the thread that called ``Session.send``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ToolResultKind = Literal["done", "error", "input_error", "aborted", "interrupted", "denied", "cancelled"]
"""How a tool call ended. ``denied``: the user or the permission rules refused it. ``cancelled``: not run because the
user declined another call of the same turn."""

StopReason = Literal["answered", "limit", "finish"]


@dataclass(frozen=True)
class UsageInfo:
    """Token counts. The three input counts do not overlap: total input is their sum."""

    input_tokens: int = 0
    """Input tokens that did not go through the cache."""
    output_tokens: int = 0
    cache_read_tokens: int = 0
    """Input tokens read from the cache."""
    cache_write_tokens: int = 0
    """Input tokens newly written to the cache."""
    requests: int = 0
    cost: float | None = None
    """Dollars, or ``None`` when the model has no known price."""


@dataclass(frozen=True)
class TurnStarted:
    """The model is about to be asked."""

    turn: int


@dataclass(frozen=True)
class TextDelta:
    """A chunk of the model's reply text, as it streams."""

    text: str


@dataclass(frozen=True)
class AssistantDone:
    """The model finished its reply. ``text`` is the full text (may be empty when it only calls tools)."""

    text: str


@dataclass(frozen=True)
class ToolStarted:
    id: str
    name: str
    args: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ToolFinished:
    """A tool call ended. A call that was denied or cancelled gets this without a ``ToolStarted``."""

    id: str
    name: str
    args: dict[str, Any]
    result: str
    """What the model was told, for display. Each image in it is a line like ``(image/png, 34.2KB)``."""
    kind: ToolResultKind
    images: int = 0
    """How many images the result sent to the model."""

    @property
    def is_error(self) -> bool:
        return self.kind != "done"


@dataclass(frozen=True)
class ContextCompacted:
    before_tokens: int
    after_tokens: int


@dataclass(frozen=True)
class Notice:
    """Something worth a short line, such as a model fallback."""

    text: str


@dataclass(frozen=True)
class RunFinished:
    """``Session.send`` finished normally."""

    stopped_by: StopReason | None
    usage: UsageInfo


@dataclass(frozen=True)
class Interrupted:
    """The run was stopped by the user (Ctrl+C, or declining a tool call without saying what to do instead).
    The conversation is kept; the next message continues it."""


@dataclass(frozen=True)
class Failed:
    """The run ended with an error from the model provider (auth, rate limit, network...)."""

    message: str


Event = (
    TurnStarted
    | TextDelta
    | AssistantDone
    | ToolStarted
    | ToolFinished
    | ContextCompacted
    | Notice
    | RunFinished
    | Interrupted
    | Failed
)
