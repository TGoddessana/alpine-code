"""``alpine -p``: run one prompt without a UI. The answer goes to stdout, progress to stderr."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, fields
from pathlib import Path

from rich.console import Console

from alpine_core import ApprovalRequest, Decision, Failed, Interrupted, Session, Settings, TurnStarted, UsageInfo

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
        seen = self._seen
        step: dict = {
            f.name: getattr(usage, f.name) - getattr(seen, f.name) for f in fields(UsageInfo) if f.name != "cost"
        }
        seen_cost = seen.cost if seen.requests else 0.0
        step["cost"] = None if usage.cost is None or seen_cost is None else usage.cost - seen_cost
        if step["requests"]:
            self.steps.append(step)
        self._seen = usage
        doc = {"complete": complete, "total": asdict(usage), "steps": self.steps}
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(doc) + "\n")
        tmp.replace(self.path)


def run_headless(settings: Settings, prompt: str, *, usage_path: Path | None = None) -> int:
    stderr = Console(stderr=True, theme=THEME)
    renderer = Renderer(stderr, show_text=False)
    outcome: list = []
    usage_file = UsageFile(usage_path) if usage_path else None
    session: Session | None = None

    def on_event(event) -> None:
        if isinstance(event, (Failed, Interrupted)):
            outcome.append(event)
        if usage_file and session and isinstance(event, TurnStarted):
            usage_file.update(session.usage, complete=False)
        renderer(event)

    session = Session(settings, on_event=on_event, approver=HeadlessApprover())
    try:
        answer = session.send(prompt)
    finally:
        if usage_file:
            usage_file.update(session.usage, complete=True)
    if answer:
        sys.stdout.write(answer.rstrip() + "\n")
    if outcome:
        return 130 if isinstance(outcome[0], Interrupted) else 1
    return 0
