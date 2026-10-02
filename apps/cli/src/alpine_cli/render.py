"""Renders core events to the terminal with rich."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.spinner import Spinner
from rich.table import Table
from rich.text import Text

from alpine_core import (
    AssistantDone,
    ContextCompacted,
    Event,
    Failed,
    Interrupted,
    Notice,
    Plan,
    RunFinished,
    TextDelta,
    ToolFinished,
    ToolStarted,
    TurnStarted,
)

from .theme import BULLET, PEAK, RESULT

#: Lines of tool output shown under a tool call.
PREVIEW_LINES = 4
#: Characters of a tool argument shown in the tool call line.
ARG_CHARS = 80
#: Tools whose result is a list, summarized as a count of these.
COUNTED = {"glob": "files", "grep": "matches"}


class Renderer:
    """Consumes core events. Final output goes to the scrollback; spinners and streaming text are transient.
    ``plan`` gives the session's plan, printed as a checklist after each ``update_plan`` call."""

    def __init__(
        self, console: Console, *, show_text: bool = True, plan: Callable[[], Plan | None] | None = None
    ) -> None:
        self.console = console
        self.show_text = show_text
        self.plan = plan
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
                self.console.print(f"[muted]{PEAK} Context compacted: {_k(before)} → {_k(after)} tokens[/]")
            case Notice(text=text):
                self.console.print(f"[muted]{PEAK} {text}[/]")
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
        failed = event.is_error or (event.detail is not None and event.detail.get("passed") is False)
        color = "warn" if event.kind in ("denied", "cancelled") else "error" if failed else "ok"
        if event.name == "update_plan":
            head = Text.assemble((f"{BULLET} ", color), ("Plan", "tool"))
        else:
            arg = call_label(event.name, event.args, full=False)
            head = Text.assemble((f"{BULLET} ", color), (event.name, "tool"), f"({arg})")
        self.console.print(head)
        lines = summarize(event)
        if event.name == "update_plan" and event.kind == "done" and self.plan is not None:
            plan = self.plan()
            lines = checklist(plan, event.detail) if plan is not None else lines
        for i, line in enumerate(lines):
            prefix = f"  {RESULT}  " if i == 0 else "     "
            self.console.print(Text(prefix, style="muted") + line)


def call_label(name: str, args: dict[str, Any], *, full: bool = True) -> str:
    """The main argument of a call: the path for file tools, the command for bash, the label for a check."""
    value = args.get("pattern") or args.get("path") or args.get("command") or args.get("label")
    if value is None:
        value = ", ".join(f"{k}={v!r}" for k, v in args.items()) or "."
    text = " ".join(str(value).split()) if name == "bash" else str(value)
    if len(text) > ARG_CHARS:
        text = text[: ARG_CHARS - 1] + "…"
    return text if not full else f"{name}({text})"


def summarize(event: ToolFinished) -> list[Text]:
    """The lines shown under a finished tool call."""
    match event.kind:
        case "denied":
            return [_line("Declined", "warn")]
        case "cancelled":
            return [_line("Not run", "warn")]
        case "interrupted":
            return [_line("Interrupted", "error")]
    result = event.result.rstrip()
    if event.is_error:
        return [_line(result.splitlines()[0] if result else event.kind, "error")]
    detail = event.detail
    if detail is not None and detail.get("kind") == "check":
        if detail["judge"] == "agent":
            verdict = "passed" if detail["passed"] else "did not pass"
            return [_line(f"Agent's judgement · {verdict} · {len(detail['evidence'])} calls as evidence")]
        if detail["passed"]:
            return [_line("Passed", "ok")]
        lines = result.splitlines()
        shown = [_line(line, "error") for line in lines[:PREVIEW_LINES]]
        if len(lines) > PREVIEW_LINES:
            shown.append(_line(f"… +{len(lines) - PREVIEW_LINES} lines"))
        return shown
    if event.name == "read":
        return [_line(_summarize_read(result, event.images))]
    if event.name in COUNTED:
        if result.startswith(("No ", "(empty")):
            return [_line(result.splitlines()[0])]
        count = sum(1 for line in result.splitlines() if not line.startswith("["))  # "[12 more ...]" is not one
        return [_line(f"Found {count} {COUNTED[event.name]}")]
    lines = result.splitlines() or ["(no output)"]
    shown = [_line(line) for line in lines[:PREVIEW_LINES]]
    if len(lines) > PREVIEW_LINES:
        shown.append(_line(f"… +{len(lines) - PREVIEW_LINES} lines"))
    return shown


def checklist(plan: Plan, detail: dict[str, Any] | None) -> list[Text]:
    """The plan as Claude Code prints its todos: ☒ done (struck through), ☐ to do, the step now in bold. Then what this
    update dropped, and the checks when they were set or changed."""
    lines = []
    for step in plan.steps:
        if step.status == "done":
            lines.append(Text.assemble(("☒ ", "muted"), (step.text, "muted strike")))
        else:
            lines.append(Text.assemble(("☐ ", "muted"), (step.text, "bold" if step.status == "now" else "default")))
    if detail is not None:
        for text in detail.get("dropped", ()):
            lines.append(_line(f"Dropped from the plan: {text}", "warn"))
        if plan.checks and (detail.get("created") or detail.get("checks_changed")):
            judges = {"harness": "", "agent": " (agent)", "user": " (you)"}
            lines.append(_line("Checks: " + ", ".join(c.label + judges[c.judge] for c in plan.checks)))
    return lines or [_line("(empty plan)")]


def _summarize_read(result: str, images: int) -> str:
    if images:
        return f"Viewed image {result}"
    lines = result.splitlines()
    numbered = sum(1 for line in lines if "\t" in line)  # file lines are "<number>\t<text>"
    if numbered or not lines or result.startswith("(empty file)"):
        return f"Read {numbered} lines"
    return f"Listed {len(lines)} entries"


def _line(text: str, style: str = "muted") -> Text:
    return Text(text, style=style)


def _bulleted(renderable: Any, style: str = "default") -> Table:
    grid = Table.grid(padding=(0, 1))
    grid.add_column(width=1, no_wrap=True)
    grid.add_column()
    grid.add_row(Text(BULLET, style=style), renderable)
    return grid


def _k(tokens: int) -> str:
    return f"{tokens / 1000:.0f}k" if tokens >= 1000 else str(tokens)
