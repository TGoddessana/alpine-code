"""Turns alpineagents Reporter notifications into core events."""

from __future__ import annotations

import threading
from collections.abc import Callable

from alpineagents import ContextChange, Image, ModelEvent, Reply, Reporter, State, ToolCall, ToolOutcome
from alpineagents.types import ToolResultContent, result_text

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

    def on_tool_end(self, state: State, call: ToolCall, result: ToolResultContent, outcome: ToolOutcome) -> None:
        images = 0 if isinstance(result, str) else sum(isinstance(block, Image) for block in result)
        self._send(ToolFinished(call.id, call.name, dict(call.args), result_text(result), outcome.kind, images))

    def on_context_change(self, state: State, change: ContextChange) -> None:
        if change.kind == "compact":
            self._send(ContextCompacted(change.before_tokens, change.after_tokens))

    def on_model_event(self, state: State, event: ModelEvent) -> None:
        self._send(Notice(event.message))
