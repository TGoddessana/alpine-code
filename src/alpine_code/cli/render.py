"""Renders core events to the terminal with rich."""

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.spinner import Spinner
from rich.table import Table
from rich.text import Text

from alpine_code.core import (
    AssistantDone,
    ContextCompacted,
    Event,
    Failed,
    Interrupted,
    Notice,
    RunFinished,
    TextDelta,
    ToolFinished,
    ToolStarted,
    TurnStarted,
)

from .theme import BULLET, RESULT, STAR

#: Lines of tool output shown under a tool call.
PREVIEW_LINES = 4
#: Characters of a tool argument shown in the tool call line.
ARG_CHARS = 80
#: Tools whose result is a list; summarized as a count.
COUNTED = {"ls": ("Listed", "entries"), "glob": ("Found", "files"), "grep": ("Found", "matches")}


class Renderer:
    """Consumes core events. Final output goes to the scrollback; spinners and streaming text are transient."""

    def __init__(self, console: Console, *, show_text: bool = True) -> None:
        self.console = console
        self.show_text = show_text
        self._live: Live | None = None
        self._buffer = ""
        self._running: dict[str, str] = {}

    def __call__(self, event: Event) -> None:
        match event:
            case TurnStarted():
                self._buffer = ""
                self._show(Spinner("dots", Text("Thinking…", style="muted"), style="accent"))
            case TextDelta(text=text):
                self._buffer += text
                if self.show_text:
                    self._show(Markdown(self._buffer))
            case AssistantDone(text=text):
                self._stop()
                if self.show_text and text.strip():
                    self.console.print(_bulleted(Markdown(text.strip())))
            case ToolStarted(id=call_id, name=name, args=args):
                self._running[call_id] = call_label(name, args)
                label = ", ".join(self._running.values())
                self._show(Spinner("dots", Text(f"Running {label}", style="muted"), style="accent"))
            case ToolFinished():
                self._running.pop(event.id, None)
                if not self._running:
                    self._stop()
                self._print_tool(event)
            case ContextCompacted(before_tokens=before, after_tokens=after):
                self._stop()
                self.console.print(f"[muted]{STAR} Context compacted: {_k(before)} → {_k(after)} tokens[/]")
            case Notice(text=text):
                self.console.print(f"[muted]{STAR} {text}[/]")
            case RunFinished(stopped_by="limit"):
                self._stop()
                self.console.print("[warn]Stopped: reached the turn limit. Send a message to continue.[/]")
            case RunFinished():
                self._stop()
            case Interrupted():
                self._stop()
                self._running.clear()
                self.console.print(f"  [muted]{RESULT}[/] [error]Interrupted[/] [muted]· What should it do instead?[/]")
            case Failed(message=message):
                self._stop()
                self._running.clear()
                self.console.print(f"[error]{BULLET} {message}[/]")
        return None

    # ------------------------------------------------------------ helpers

    def _show(self, renderable: Any) -> None:
        if self._live is None:
            self._live = Live(renderable, console=self.console, transient=True, refresh_per_second=12)
            self._live.start()
        else:
            self._live.update(renderable)

    def _stop(self) -> None:
        if self._live is not None:
            self._live.stop()
            self._live = None

    def _print_tool(self, event: ToolFinished) -> None:
        color = "error" if event.is_error else "ok"
        if event.kind == "denied":
            color = "warn"
        arg = call_label(event.name, event.args, full=False)
        head = Text.assemble((f"{BULLET} ", color), (event.name, "tool"), f"({arg})")
        self.console.print(head)
        for i, line in enumerate(summarize(event)):
            prefix = f"  {RESULT}  " if i == 0 else "     "
            self.console.print(Text(prefix, style="muted") + line)


def call_label(name: str, args: dict[str, Any], *, full: bool = True) -> str:
    """The main argument of a call: the path for file tools, the command for bash."""
    value = args.get("pattern") or args.get("path") or args.get("command")
    if value is None:
        value = ", ".join(f"{k}={v!r}" for k, v in args.items()) or "."
    text = " ".join(str(value).split()) if name == "bash" else str(value)
    if len(text) > ARG_CHARS:
        text = text[: ARG_CHARS - 1] + "…"
    return text if not full else f"{name}({text})"


def summarize(event: ToolFinished) -> list[Text]:
    result = event.result.rstrip()
    if event.kind == "denied":
        return [Text("Declined", style="warn")]
    if event.kind == "interrupted":
        return [Text("Interrupted", style="error")]
    if event.is_error:
        first = result.splitlines()[0] if result else event.kind
        return [Text(first, style="error")]
    if event.name == "read":
        n = sum(1 for line in result.splitlines() if "\t" in line)
        return [Text(f"Read {n} lines", style="muted")]
    if event.name in COUNTED:
        if result.startswith("No ") or result.startswith("(empty"):
            return [Text(result.splitlines()[0], style="muted")]
        n = sum(1 for line in result.splitlines() if not line.startswith("["))
        noun = COUNTED[event.name]
        return [Text(f"{noun[0]} {n} {noun[1]}", style="muted")]
    lines = result.splitlines() or ["(no output)"]
    shown = [Text(line, style="muted") for line in lines[:PREVIEW_LINES]]
    if len(lines) > PREVIEW_LINES:
        shown.append(Text(f"… +{len(lines) - PREVIEW_LINES} lines", style="muted"))
    return shown


def _bulleted(renderable: Any, style: str = "default") -> Table:
    grid = Table.grid(padding=(0, 1))
    grid.add_column(width=1, no_wrap=True)
    grid.add_column()
    grid.add_row(Text(BULLET, style=style), renderable)
    return grid


def _k(tokens: int) -> str:
    return f"{tokens / 1000:.0f}k" if tokens >= 1000 else str(tokens)
