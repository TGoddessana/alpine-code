"""``alpine -p``: run one prompt without a UI. The answer goes to stdout, progress to stderr."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, fields
from pathlib import Path

from rich.console import Console

from alpine_core import (
    ApprovalRequest,
    Decision,
    Event,
    Failed,
    Interrupted,
    Session,
    Settings,
    TurnStarted,
    UsageInfo,
)

from .render import Renderer
from .theme import THEME


class HeadlessApprover:
    """Nobody can answer, so calls the permission mode does not allow are declined, with a reason the model sees."""

    def approve(self, request: ApprovalRequest) -> Decision:
        return Decision(
            "deny",
            "Not allowed in non-interactive mode. Do what you can without it, and say what the user should run.",
        )


class UsageFile:
    """Writes token usage to a JSON file: the run's totals and one entry per model step, each split into input
    that missed the cache, input read from the cache and input written to it.

    The file is rewritten before every model request, so a run killed from outside (a deadline) still leaves the
    steps it finished; ``complete`` is ``false`` then, and the step that was in flight is missing.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self.steps: list[dict] = []
        self._seen = UsageInfo()

    def update(self, usage: UsageInfo, *, complete: bool) -> None:
        step = _difference(usage, self._seen)
        if step["requests"]:
            self.steps.append(step)
        self._seen = usage
        doc = {"complete": complete, "total": asdict(usage), "steps": self.steps}
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(doc) + "\n")
        tmp.replace(self.path)


def _difference(now: UsageInfo, before: UsageInfo) -> dict:
    """What was used between two readings. Cost is ``None`` when either reading has no price."""
    step: dict = {f.name: getattr(now, f.name) - getattr(before, f.name) for f in fields(UsageInfo) if f.name != "cost"}
    before_cost = before.cost if before.requests else 0.0
    step["cost"] = None if now.cost is None or before_cost is None else now.cost - before_cost
    return step


def run_headless(settings: Settings, prompt: str, *, usage_path: Path | None = None) -> int:
    """Runs ``prompt`` and returns the exit code: 0 when it answered, 1 when it failed, 130 when interrupted."""
    renderer = Renderer(Console(stderr=True, theme=THEME), show_text=False)
    usage_file = UsageFile(usage_path) if usage_path else None
    exit_code = 0

    def on_event(event: Event) -> None:
        nonlocal exit_code
        if isinstance(event, Interrupted):
            exit_code = exit_code or 130
        elif isinstance(event, Failed):
            exit_code = exit_code or 1
        elif isinstance(event, TurnStarted) and usage_file:
            usage_file.update(session.usage, complete=False)
        renderer(event)

    session = Session(settings, on_event=on_event, approver=HeadlessApprover())
    renderer.plan = lambda: session.plan
    try:
        answer = session.send(prompt)
    finally:
        if usage_file:
            usage_file.update(session.usage, complete=True)
    if answer:
        sys.stdout.write(answer.rstrip() + "\n")
    return exit_code
