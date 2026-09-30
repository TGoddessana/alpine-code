"""Slash commands. Each command is a function that gets the REPL context and the text after the command name."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from rich.console import Console
from rich.table import Table

from alpine_core import ConfigError, Session

from .theme import MODE_LABELS


@dataclass
class Context:
    session: Session
    console: Console


@dataclass(frozen=True)
class Command:
    name: str
    help: str
    run: Callable[[Context, str], bool]
    """Returns ``False`` to exit the REPL."""
    aliases: tuple[str, ...] = ()


COMMANDS: dict[str, Command] = {}


def command(name: str, help: str, aliases: tuple[str, ...] = ()):
    def register(fn: Callable[[Context, str], bool]) -> Callable[[Context, str], bool]:
        cmd = Command(name, help, fn, aliases)
        for key in (name, *aliases):
            COMMANDS[key] = cmd
        return fn

    return register


def find(line: str) -> tuple[Command, str] | None:
    """The command a ``/name args`` line calls, or ``None`` when ``name`` is not a command."""
    name, _, arg = line[1:].partition(" ")
    cmd = COMMANDS.get(name)
    return (cmd, arg.strip()) if cmd else None


def unique() -> list[Command]:
    return list({id(c): c for c in COMMANDS.values()}.values())


@command("help", "Show commands and keys", aliases=("?",))
def _help(ctx: Context, arg: str) -> bool:
    table = Table.grid(padding=(0, 3))
    for cmd in unique():
        table.add_row(f"[accent]/{cmd.name}[/]", cmd.help)
    ctx.console.print(table)
    ctx.console.print()
    keys = Table.grid(padding=(0, 3))
    for key, what in [
        ("Enter", "Send"),
        ("Alt+Enter, Ctrl+J", "New line"),
        ("Shift+Tab", "Change permission mode"),
        ("Ctrl+C", "Stop the agent · clear input · exit (twice)"),
        ("Esc", "Decline a tool call and stop"),
        ("Ctrl+D", "Exit"),
    ]:
        keys.add_row(f"[accent]{key}[/]", what)
    ctx.console.print(keys)
    return True


@command("clear", "Start a new conversation", aliases=("new", "reset"))
def _clear(ctx: Context, arg: str) -> bool:
    ctx.session.clear()
    ctx.console.clear()
    ctx.console.print("[muted]Started a new conversation.[/]")
    return True


@command("compact", "Summarize the conversation to free context")
def _compact(ctx: Context, arg: str) -> bool:
    with ctx.console.status("[muted]Compacting…[/]"):
        done = ctx.session.compact()
    if not done:
        ctx.console.print("[muted]Nothing to compact.[/]")
    return True


@command("model", "Show or switch the model (/model <name>). Switching starts a new conversation")
def _model(ctx: Context, arg: str) -> bool:
    if not arg:
        ctx.console.print(f"Model: [accent]{ctx.session.model_name}[/]")
        return True
    try:
        ctx.session.set_model(arg)
    except ConfigError as e:
        ctx.console.print(f"[error]{e}[/]")
        return True
    ctx.console.print(f"Switched to [accent]{arg}[/]. Started a new conversation.")
    return True


@command("mode", "Show or set the permission mode (default, accept_edits, yolo)")
def _mode(ctx: Context, arg: str) -> bool:
    from alpine_core import Mode

    if arg:
        try:
            ctx.session.mode = Mode(arg)
        except ValueError:
            ctx.console.print(f"[error]Unknown mode {arg!r}. Choose one of: {', '.join(Mode)}[/]")
            return True
    ctx.console.print(f"Mode: [accent]{MODE_LABELS[ctx.session.mode]}[/]")
    return True


@command("cost", "Show token usage and cost of this conversation", aliases=("usage",))
def _cost(ctx: Context, arg: str) -> bool:
    u = ctx.session.usage
    cost = f"${u.cost:.4f}" if u.cost is not None else "unknown (no price for this model)"
    ctx.console.print(
        f"Requests: {u.requests}\nInput: {u.input_tokens:,} tokens (+{u.cache_read_tokens:,} read from cache, "
        f"+{u.cache_write_tokens:,} written to cache)\n"
        f"Output: {u.output_tokens:,} tokens\nCost: {cost}\nContext: {ctx.session.context_used:.0%} used"
    )
    return True


@command("exit", "Exit", aliases=("quit", "q"))
def _exit(ctx: Context, arg: str) -> bool:
    return False
