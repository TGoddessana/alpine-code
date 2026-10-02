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
            options.append(("allow_always", f"Yes, and don't ask again for {request.remember} in this conversation"))
        options.append(("deny", "No, and tell it what to do differently"))
        answer = choice(
            message=HTML("<b>Do you want to proceed?</b>"),
            options=options,
            symbol=PROMPT,
            style=self._style,
            key_bindings=esc,
        )
        if answer == "stop":
            return Decision("deny", stop=True)
        if answer == "deny":
            feedback = PromptSession(style=self._style).prompt(
                HTML("<ansigray>  What should it do instead? (Enter to stop) </ansigray>")
            ).strip()
            return Decision("deny", feedback) if feedback else Decision("deny", stop=True)
        return Decision(answer)

    def _panel(self, request: ApprovalRequest) -> Panel:
        body: list = []
        if request.reason:
            body.append(Text(f"⚠ {request.reason}", style="warn"))
        if request.preview:
            body.append(_preview(request.preview, request.preview_kind))
        return Panel(
            Group(*body),
            title=Text(request.title, style="bold"),
            title_align="left",
            border_style="warn",
            padding=(0, 1),
        )


def _preview(preview: str, kind: str) -> Syntax | Text:
    match kind:
        case "diff":
            return Syntax(preview, "diff", theme="ansi_dark", background_color="default")
        case "command":
            return Syntax(preview, "bash", theme="ansi_dark", background_color="default", word_wrap=True)
    return Text(preview)
