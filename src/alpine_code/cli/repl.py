"""The interactive loop: read a message with prompt_toolkit, run it through the Session, repeat."""

from __future__ import annotations

import os
from pathlib import Path

from prompt_toolkit import PromptSession
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.history import FileHistory, InMemoryHistory
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.styles import Style
from rich.console import Console
from rich.markup import escape

from alpine_code import __version__
from alpine_code.core import Session

from . import commands
from .theme import MODE_LABELS, PROMPT, PT_STYLE, STAR


class SlashCompleter(Completer):
    def get_completions(self, document, complete_event):
        text = document.text_before_cursor
        if not text.startswith("/") or " " in text:
            return
        for cmd in commands.unique():
            if cmd.name.startswith(text[1:]):
                yield Completion(f"/{cmd.name}", start_position=-len(text), display_meta=cmd.help)


def history_file() -> Path:
    base = os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state"
    return Path(base) / "alpine-code" / "history"


def _history():
    path = history_file()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        return FileHistory(str(path))
    except OSError:
        return InMemoryHistory()


class Repl:
    def __init__(self, session: Session, console: Console) -> None:
        self.session = session
        self.console = console
        self.ctx = commands.Context(session, console)
        self.prompt = PromptSession(
            history=_history(),
            completer=SlashCompleter(),
            complete_while_typing=True,
            key_bindings=self._keys(),
            bottom_toolbar=self._toolbar,
            style=Style.from_dict(PT_STYLE),
            multiline=False,
        )

    def _keys(self) -> KeyBindings:
        keys = KeyBindings()

        @keys.add("escape", "enter")
        @keys.add("c-j")
        def _(event) -> None:
            event.current_buffer.insert_text("\n")

        @keys.add("s-tab")
        def _(event) -> None:
            self.session.mode = self.session.mode.next()
            event.app.invalidate()

        @keys.add("c-c")
        def _(event) -> None:
            buffer = event.current_buffer
            if buffer.text:
                buffer.reset()
            else:
                event.app.exit(exception=KeyboardInterrupt)

        return keys

    def _toolbar(self):
        s = self.session
        mode = s.mode.value
        mode_style = "bottom-toolbar.yolo" if mode == "yolo" else "bottom-toolbar.mode"
        parts = [f"  {s.model_name}", f"{s.context_used:.0%} context"]
        cost = s.usage.cost
        if cost:
            parts.append(f"${cost:.2f}")
        return [
            ("class:bottom-toolbar", " · ".join(parts) + " · "),
            (f"class:{mode_style}", f"⏵⏵ {MODE_LABELS[mode]}"),
            ("class:bottom-toolbar", " (shift+tab to cycle)"),
        ]

    def banner(self) -> None:
        self.console.print(
            f"[accent]{STAR}[/] [bold]alpine-code[/] [muted]v{__version__}[/]\n"
            f"  [muted]model[/] {escape(self.session.model_name)}\n"
            f"  [muted]cwd[/]   {escape(str(self.session.cwd))}\n"
            f"  [muted]/help for commands · ctrl+d to exit[/]\n"
        )

    def read(self) -> str | None:
        """The next message, or ``None`` to exit."""
        armed = False
        while True:
            try:
                text = self.prompt.prompt(
                    HTML(f"<b>{PROMPT}</b> "),
                    show_frame=True,
                    placeholder=HTML('<placeholder>Ask anything, or type / for commands</placeholder>'),
                )
            except KeyboardInterrupt:
                if armed:
                    return None
                armed = True
                self.console.print("[muted]Press Ctrl+C again to exit[/]")
                continue
            except EOFError:
                return None
            if text.strip():
                return text.strip()

    def run(self, first: str | None = None) -> None:
        self.banner()
        if first:
            self.console.print(f"[user]{PROMPT} {escape(first)}[/]")
            if not self.handle(first):
                return
        while (text := self.read()) is not None:
            if not self.handle(text):
                return

    def handle(self, text: str) -> bool:
        """Runs one message or command. ``False`` means exit."""
        if text.startswith("/"):
            found = commands.find(text)
            if found:
                cmd, arg = found
                return cmd.run(self.ctx, arg)
            self.console.print(f"[error]Unknown command {escape(text.split()[0])}. Type /help[/]")
            return True
        self.session.send(text)
        self.console.print()
        return True
