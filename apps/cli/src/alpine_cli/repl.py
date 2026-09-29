"""The interactive loop: read a message with prompt_toolkit, run it through the Session, repeat."""

from __future__ import annotations

import asyncio
import os
import signal
import threading
from pathlib import Path

from prompt_toolkit import PromptSession
from prompt_toolkit.application import get_app
from prompt_toolkit.completion import Completer, Completion
from prompt_toolkit.filters import Condition, is_done, to_filter
from prompt_toolkit.formatted_text import HTML
from prompt_toolkit.history import FileHistory, InMemoryHistory
from prompt_toolkit.key_binding import KeyBindings
from prompt_toolkit.layout import ConditionalContainer, FormattedTextControl, HSplit, Window
from prompt_toolkit.output import create_output
from prompt_toolkit.styles import Style
from rich.console import Console
from rich.markup import escape
from rich.table import Table
from rich.text import Text

from alpine_core import Session

from . import commands
from ._version import __version__
from .console import ReplayConsole
from .theme import HARE, MODE, MODE_LABELS, PIXELS, PROMPT, PT_STYLE, pixel_art

#: Seconds the terminal size must stay put before the scrollback is printed again.
RESIZE_SETTLE = 0.15


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


def terminal_output():
    """Terminal output without cursor position requests, for every prompt in the REPL, approvals included.

    With a cursor position report, prompt_toolkit draws the prompt down to the bottom of the terminal. While a
    window is being resized that report is stale, the prompt comes out taller than the screen, its top scrolls
    into scrollback where the redraw can't erase it, and a copy of the input box is left behind per resize.
    """
    output = create_output()
    output.enable_cpr = False  # read by Vt100_Output; other outputs never send the request
    return output


def _tilde(path: str | Path) -> str:
    path, home = Path(path), Path.home()
    return f"~/{path.relative_to(home)}" if path.is_relative_to(home) and path != home else str(path)


class Repl:
    def __init__(self, session: Session, console: Console) -> None:
        self.session = session
        self.console = console
        self._resized = False  # since the scrollback was last printed
        self._seen = None  # terminal size at the last render of the open prompt
        self._replay_timer: asyncio.TimerHandle | None = None
        self.ctx = commands.Context(session, console)
        self.prompt = PromptSession(
            history=_history(),
            completer=SlashCompleter(),
            # Completing only slash commands keeps prompt_toolkit from reserving menu rows under every prompt.
            complete_while_typing=Condition(self._typing_command),
            reserve_space_for_menu=min(len(commands.unique()), 8),
            key_bindings=self._keys(),
            style=Style.from_dict(PT_STYLE),
            multiline=False,
            # The finished prompt is echoed through rich instead, so a resize can print it again.
            erase_when_done=True,
        )
        self._fit_layout()
        self.prompt.app.before_render += self._watch_size
        self._watch_winch()

    def _watch_winch(self) -> None:
        """Notes resizes while no prompt is open. Each prompt puts back the default handler when it ends."""
        if hasattr(signal, "SIGWINCH") and threading.current_thread() is threading.main_thread():
            signal.signal(signal.SIGWINCH, self._on_winch)

    def _on_winch(self, *_) -> None:
        self._resized = True

    def _watch_size(self, app) -> None:
        """Prints the scrollback again once the terminal has been resized and stayed that size for a moment.

        prompt_toolkit only erases the rows it drew itself, and after a resize those are no longer where it left
        them: terminals rewrap lines when they get narrower. So the old input box stays behind, once per resize.
        """
        size = app.output.get_size()
        if size == self._seen:
            return
        if self._seen is not None:
            self._resized = True
        self._seen = size
        self._cancel_replay()
        if self._resized and isinstance(self.console, ReplayConsole):
            self._replay_timer = asyncio.get_running_loop().call_later(RESIZE_SETTLE, self._replay, app)

    def _replay(self, app) -> None:
        self._replay_timer = None
        self._resized = False
        app.renderer.reset()
        self.console.replay()
        app.invalidate()

    def _cancel_replay(self) -> None:
        if self._replay_timer is not None:
            self._replay_timer.cancel()
            self._replay_timer = None

    def _fit_layout(self) -> None:
        """Keeps the frame as tall as the input, with the status line right under it.

        prompt_toolkit never shrinks the prompt while it is open, so the input window stops at its content and an
        empty window at the bottom takes the rest: the frame shrinks back after the completion menu closes.
        The status line lives here rather than in ``bottom_toolbar``, which shows only after a cursor position
        report, and those are off (see ``terminal_output``).
        """
        layout = self.prompt.layout
        for window in layout.find_all_windows():
            if getattr(window.content, "buffer", None) is self.prompt.default_buffer:
                window.dont_extend_height = to_filter(True)
        root = layout.container
        assert isinstance(root, HSplit)
        status = Window(FormattedTextControl(self._toolbar), style="class:bottom-toolbar", height=1)
        root.children += [ConditionalContainer(status, filter=~is_done), Window()]

    def _typing_command(self) -> bool:
        text = self.prompt.default_buffer.text
        return text.startswith("/") and " " not in text

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
        """Model, context, cost and mode, dropping the least useful parts first when the terminal is narrow."""
        s = self.session
        mode = s.mode.value
        mode_style = "bottom-toolbar.yolo" if mode == "yolo" else "bottom-toolbar.mode"
        parts = [f"  {s.model_name}", f"{s.context_used:.0%} context"]
        cost = s.usage.cost
        if cost:
            parts.append(f"${cost:.2f}")
        width = get_app().output.get_size().columns
        hint = " (shift+tab to cycle)"
        mode_text = f"{MODE} {MODE_LABELS[mode]}"
        while len(parts) > 1 and len(" · ".join(parts)) + 3 + len(mode_text) >= width:
            parts.pop()
        head = " · ".join(parts) + " · "
        if len(head) + len(mode_text) + len(hint) >= width:
            hint = ""
        return [
            ("class:bottom-toolbar", head),
            (f"class:{mode_style}", mode_text),
            ("class:bottom-toolbar", hint),
        ]

    def banner(self) -> None:
        info = (
            f"[bold]alpine-code[/] [muted]v{__version__}[/]",
            f"[muted]model[/] {escape(self.session.model_name)}",
            f"[muted]cwd[/]   {escape(_tilde(self.session.cwd))}",
            "[muted]/help for commands · ctrl+d to exit[/]",
        )
        # One cell per column, and info lines are cut rather than wrapped, so a narrow terminal can't split the hare.
        grid = Table.grid(padding=(0, 2))
        grid.add_column(no_wrap=True, min_width=len(HARE[0]))
        grid.add_column()
        text = Text.from_markup("\n".join(info), overflow="ellipsis")
        text.no_wrap = True
        grid.add_row(Text("\n").join(pixel_art(HARE, PIXELS)), text)
        self.console.print(grid)
        self.console.print()

    def echo(self, text: str) -> None:
        """Prints a message the user sent."""
        grid = Table.grid(padding=(0, 1))
        grid.add_row(Text(PROMPT, style="user"), Text(text, style="user"))
        self.console.print(grid)

    def read(self) -> str | None:
        """The next message, or ``None`` to exit."""
        armed = False
        while True:
            self._seen = None
            try:
                text = self.prompt.prompt(
                    HTML(f"<b>{PROMPT}</b> "),
                    prompt_continuation=" " * (len(PROMPT) + 1),
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
            finally:
                self._cancel_replay()
                self._watch_winch()
            if text.strip():
                self.echo(text.strip())
                return text.strip()

    def run(self, first: str | None = None) -> None:
        self.banner()
        if first:
            self.echo(first)
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
