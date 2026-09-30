"""Slash commands. Each command is a function that gets the REPL context and the text after the command name."""

from __future__ import annotations

import asyncio
import webbrowser
from collections.abc import Callable
from dataclasses import dataclass

from rich.console import Console
from rich.markup import escape
from rich.table import Table

from alpine_core import ConfigError, Mode, Session, Settings, chatgpt_tokens, home_dir
from alpine_core.chatgpt import (
    ChatGPTError,
    SignIn,
    SignInError,
    account_of,
    fetch_models,
    host_id,
    is_chatgpt,
    save_account,
    sign_out,
)

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


@command("login", "Sign in with ChatGPT to use your plan (/login [connection] signs in again)")
def _login(ctx: Context, arg: str) -> bool:
    settings = Settings.load()
    previous = None
    if arg:
        connection = settings.connections.get(arg)
        if connection is None or not is_chatgpt(connection):
            ctx.console.print(f"[error]No ChatGPT connection named {arg!r}.[/]")
            return True
        previous = account_of(connection, settings.secrets)
    try:
        account = asyncio.run(_sign_in(ctx.console, previous, consent=previous is not None and not previous.plan_usage))
    except KeyboardInterrupt:
        ctx.console.print("[muted]Cancelled signing in.[/]")
        return True
    except SignInError as e:
        ctx.console.print(f"[error]{escape(str(e))}[/]")
        return True
    name = save_account(account, settings.secrets, Settings.load().connections)
    who = account.email or "your ChatGPT account"
    if not account.plan_usage:
        ctx.console.print(
            f"Signed in as {escape(who)}, but using your ChatGPT plan was not allowed. "
            f"Run [accent]/login {name}[/] to allow it."
        )
        return True
    ctx.console.print(f"Signed in as {escape(who)} · connection [accent]{name}[/]. AI requests use your ChatGPT plan.")
    settings = Settings.load()
    try:
        models = [m.slug for m in fetch_models(chatgpt_tokens(settings, settings.connections[name]).access_token())]
    except ChatGPTError:
        models = []
    if models:
        ctx.console.print(f"Models: {', '.join(models)}. Switch with [accent]/model {name}/{models[0]}[/].")
    ctx.console.print("[muted]Manage usage: https://chatgpt.com/settings/usage[/]")
    return True


async def _sign_in(console: Console, previous, consent: bool):
    sign_in = await SignIn.start(host_id(home_dir()), previous=previous, consent=consent)
    console.print(f"Opening your browser to sign in with ChatGPT. If it does not open, visit:\n{sign_in.url}")
    webbrowser.open(sign_in.url)
    try:
        with console.status("[muted]Waiting for the browser… (Ctrl+C to cancel)[/]"):
            return await sign_in.wait()
    finally:
        sign_in.cancel()


@command("logout", "Sign out of a ChatGPT connection (/logout [connection])")
def _logout(ctx: Context, arg: str) -> bool:
    settings = Settings.load()
    signed_in = [c for c in settings.connections.values() if is_chatgpt(c)]
    if arg:
        signed_in = [c for c in signed_in if c.name == arg]
    if len(signed_in) != 1:
        names = ", ".join(c.name for c in signed_in) or "none"
        ctx.console.print(
            f"[error]Name the ChatGPT connection to sign out of: /logout <name> (connections: {names})[/]"
        )
        return True
    connection = signed_in[0]
    if sign_out(connection, settings.secrets):
        ctx.console.print(f"Signed out of [accent]{connection.name}[/]. /login {connection.name} signs in again.")
    else:
        ctx.console.print(
            f"Signed out of [accent]{connection.name}[/] here, but OpenAI did not confirm it. "
            "You can disconnect alpine-code in ChatGPT settings."
        )
    return True


@command("exit", "Exit", aliases=("quit", "q"))
def _exit(ctx: Context, arg: str) -> bool:
    return False
