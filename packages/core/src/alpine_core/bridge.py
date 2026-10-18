"""Turns alpineagents Reporter notifications into core events."""

from __future__ import annotations

import json
import subprocess
import threading
from collections.abc import Callable
from typing import TypeVar

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
from .work_changes import WorkChanges

T = TypeVar("T")
_READ_ONLY = {"read", "glob", "grep", "skill", "propose_memory"}
#: Stop reasons of a reply cut off at the output limit: Anthropic's, and OpenAI-compatible servers'.
_CUT_OFF = {"max_tokens", "length"}


class EventReporter(Reporter):
    def __init__(self, emit: Callable[[Event], None], changes: WorkChanges | None = None) -> None:
        self._emit = emit
        self._changes = changes
        self._lock = threading.Lock()

    def _collect(self, action: Callable[[], T]) -> T | None:
        try:
            return action()
        except (OSError, TimeoutError, subprocess.TimeoutExpired) as e:
            self._send(Notice(f"Actual file changes could not be collected: {e}"))
            return None

    def _send(self, event: Event) -> None:
        with self._lock:
            self._emit(event)

    def on_think_start(self, state: State) -> None:
        self._send(TurnStarted(state.turn))

    def on_text(self, state: State, chunk: str) -> None:
        self._send(TextDelta(chunk))

    def on_think_end(self, state: State, reply: Reply) -> None:
        self._send(AssistantDone(reply.text, reply.stop_reason in _CUT_OFF))

    def on_tool_start(self, state: State, call: ToolCall) -> None:
        if self._changes is not None and call.name not in _READ_ONLY:
            self._collect(lambda: self._changes.start(call.name, dict(call.args)))
        self._send(ToolStarted(call.id, call.name, dict(call.args)))

    def on_tool_end(self, state: State, call: ToolCall, result: ToolResultContent, outcome: ToolOutcome) -> None:
        images = 0 if isinstance(result, str) else sum(isinstance(block, Image) for block in result)
        text = result_text(result)
        command = None
        if call.name == "bash":
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict) and "exit_code" in parsed:
                    command = parsed
                    text = (
                        "\n".join(part for part in (parsed.get("stdout"), parsed.get("stderr")) if part)
                        or "(no output)"
                    )
                    if parsed.get("timed_out"):
                        text += f"\n[{parsed.get('message')}]"
                    elif parsed.get("exit_code") != 0:
                        text += f"\n[exit code {parsed.get('exit_code')}]"
            except (ValueError, TypeError):
                pass
            if outcome.kind == "interrupted":
                command = {"stdout": "", "stderr": "", "exit_code": None, "timed_out": False, "cancelled": True}
        changes = (
            self._collect(self._changes.finish) if self._changes is not None and call.name not in _READ_ONLY else None
        )
        self._send(ToolFinished(call.id, call.name, dict(call.args), text, outcome.kind, images, command, changes))

    def on_context_change(self, state: State, change: ContextChange) -> None:
        if change.kind == "compact":
            self._send(ContextCompacted(change.before_tokens, change.after_tokens))

    def on_model_event(self, state: State, event: ModelEvent) -> None:
        self._send(Notice(event.message))
