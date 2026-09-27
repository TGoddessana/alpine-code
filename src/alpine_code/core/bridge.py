"""Turns alpineagents Reporter notifications into core events."""

from __future__ import annotations

import threading
from collections.abc import Callable

from alpineagents import ContextChange, ModelEvent, Reply, Reporter, State, ToolCall, ToolOutcome

from .events import (
    AssistantDone,
    ContextCompacted,
    Event,
    Notice,
    TextDelta,
    ToolFinished,
    ToolStarted,
    TurnStarted,
)


class EventReporter(Reporter):
    def __init__(self, emit: Callable[[Event], None]) -> None:
        self._emit = emit
        self._lock = threading.Lock()

    def _send(self, event: Event) -> None:
        with self._lock:
            self._emit(event)

    def on_think_start(self, state: State) -> None:
        self._send(TurnStarted(state.turn))

    def on_text(self, state: State, chunk: str) -> None:
        self._send(TextDelta(chunk))

    def on_think_end(self, state: State, reply: Reply) -> None:
        self._send(AssistantDone(reply.text))

    def on_tool_start(self, state: State, call: ToolCall) -> None:
        self._send(ToolStarted(call.id, call.name, dict(call.args)))

    def on_tool_end(self, state: State, call: ToolCall, result: str, outcome: ToolOutcome) -> None:
        self._send(ToolFinished(call.id, call.name, dict(call.args), result, outcome.kind))

    def on_context_change(self, state: State, change: ContextChange) -> None:
        if change.kind == "compact":
            self._send(ContextCompacted(change.before_tokens, change.after_tokens))

    def on_model_event(self, state: State, event: ModelEvent) -> None:
        self._send(Notice(event.message))
