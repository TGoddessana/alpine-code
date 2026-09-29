"""Asks the user in the terminal whether a tool call may run."""

from __future__ import annotations

from prompt_toolkit import PromptSession
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.shortcuts import choice
from prompt_toolkit.styles import Style
from rich.console import Console, Group
from rich.panel import Panel
from rich.syntax import Syntax
from rich.text import Text

from alpine_core import ApprovalRequest, Decision

from .theme import PROMPT, PT_STYLE


class CliApprover:
    def __init__(self, console: Console) -> None:
        self.console = console
        self._style = Style.from_dict(PT_STYLE)

    def approve(self, request: ApprovalRequest) -> Decision:
        self.console.print(self._panel(request))
        esc = KeyBindings()

        @esc.add("escape", eager=True)
        def _(event) -> None:
            event.app.exit(result="stop")

        options = [("allow", "Yes")]
        if request.remember:
            options.append(("allow_always", f"Yes, and don't ask again for {request.remember} this session"))
        options.append(("deny", "No, and tell it what to do differently"))
        answer = choice(
            message=HTML("<b>Do you want to proceed?</b>"),
            options=options,
            symbol=PROMPT,
            style=self._style,
            key_bindings=esc,
        )
        if answer == "stop":
            return Decision("deny")
        if answer == "deny":
            feedback = PromptSession(style=self._style).prompt(
                HTML("<ansigray>  What should it do instead? (Enter to stop) </ansigray>")
            ).strip()
            return Decision("deny", feedback or None)
        return Decision(answer)

    def _panel(self, request: ApprovalRequest) -> Panel:
        body: list = []
        if request.preview_kind == "diff" and request.preview:
            body.append(Syntax(request.preview, "diff", theme="ansi_dark", background_color="default"))
        elif request.preview_kind == "command" and request.preview:
            body.append(Syntax(request.preview, "bash", theme="ansi_dark", background_color="default", word_wrap=True))
        elif request.preview:
            body.append(Text(request.preview))
        if request.reason:
            body.insert(0, Text(f"⚠ {request.reason}", style="warn"))
        return Panel(Group(*body) if body else Text(""), title=Text(request.title, style="bold"),
                     title_align="left", border_style="warn", padding=(0, 1))
