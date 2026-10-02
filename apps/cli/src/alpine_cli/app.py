"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from prompt_toolkit.application import create_app_session

from alpine_core import ConfigError, Mode, ProjectList, Session, Settings

from ._version import __version__
from .approval import CliApprover
from .console import ReplayConsole
from .headless import run_headless
from .render import Renderer
from .repl import Repl, terminal_output
from .theme import THEME


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="alpine",
        description="A terminal coding agent built on alpineagents.",
        epilog="Settings: ~/.alpine-code/config.toml, or ALPINE_MODEL, ALPINE_BASE_URL, ALPINE_API_KEY",
    )
    parser.add_argument("prompt", nargs="*", help="Start with this message")
    parser.add_argument("-p", "--print", action="store_true", help="Answer the prompt and exit (non-interactive)")
    parser.add_argument("-m", "--model", help="<connection>/<model>, e.g. anthropic/claude-sonnet-5")
    parser.add_argument("--base-url", help="Base URL of an OpenAI-compatible server")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--accept-edits", action="store_true", help="Edit files without asking")
    mode.add_argument("--yolo", action="store_true", help="Never ask before editing files or running commands")
    parser.add_argument(
        "--usage-file",
        type=Path,
        metavar="PATH",
        help="With -p: write token usage (cached and uncached) to PATH as JSON",
    )
    parser.add_argument("-v", "--version", action="version", version=f"alpine-code {__version__}")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    console = ReplayConsole(theme=THEME, highlight=False)
    mode = Mode.YOLO if args.yolo else Mode.ACCEPT_EDITS if args.accept_edits else None
    prompt = " ".join(args.prompt).strip()
    if args.print and not sys.stdin.isatty():
        piped = sys.stdin.read().strip()
        prompt = f"{prompt}\n\n{piped}".strip() if piped else prompt

    try:
        settings = Settings.load(model=args.model, base_url=args.base_url, mode=mode)
        if args.print:
            if not prompt:
                console.print('[error]-p needs a prompt: alpine -p "..." (or pipe one in)[/]')
                sys.exit(2)
            sys.exit(run_headless(settings, prompt, usage_path=args.usage_file))
        renderer = Renderer(console)
        session = Session(settings, on_event=renderer, approver=CliApprover(console), projects=ProjectList.default())
        renderer.plan = lambda: session.plan
    except ConfigError as e:
        console.print(f"[error]{e}[/]")
        sys.exit(1)

    with create_app_session(output=terminal_output()):
        Repl(session, console).run(first=prompt or None)
