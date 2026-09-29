"""``alpine -p``: run one prompt without a UI. The answer goes to stdout, progress to stderr."""

from __future__ import annotations

import sys

from rich.console import Console

from alpine_core import ApprovalRequest, Decision, Failed, Interrupted, Session, Settings

from .render import Renderer
from .theme import THEME


class HeadlessApprover:
    """Nobody can answer, so calls the permission mode does not allow are declined, with a reason the model sees."""

    def approve(self, request: ApprovalRequest) -> Decision:
        return Decision(
            "deny",
            "Not allowed in non-interactive mode. Do what you can without it, and say what the user should run.",
        )


def run_headless(settings: Settings, prompt: str) -> int:
    stderr = Console(stderr=True, theme=THEME)
    renderer = Renderer(stderr, show_text=False)
    outcome: list = []

    def on_event(event) -> None:
        if isinstance(event, (Failed, Interrupted)):
            outcome.append(event)
        renderer(event)

    session = Session(settings, on_event=on_event, approver=HeadlessApprover())
    answer = session.send(prompt)
    if answer:
        sys.stdout.write(answer.rstrip() + "\n")
    if outcome:
        return 130 if isinstance(outcome[0], Interrupted) else 1
    return 0
