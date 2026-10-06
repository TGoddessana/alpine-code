"""Checks and guards: what a memory makes the harness do while the agent works (docs/memory.md, Following).

Both judge only what the harness observed (``Facts``: the commands that ran and the files that changed), never what
the model says. Both are ports: ``CheckRunner`` and ``GuardMatcher``, with ``FormChecks`` and ``PatternGuards`` as
the defaults, built from the memories that carry them.

The forms, in English so every model writes the same thing (``say`` is free text)::

    check:
      when:   before command "git commit"
              after a change to "supabase/migrations/*"
              when the run ends
              when the run ends after a change to "*.tsx"
      expect: command "pnpm lint" ran after the last change
              command "pnpm build" ran
              the file is new                  (only after a change)
    guard:
      before: command "supabase db execute --linked"
              editing ".env.production"

A command is matched by its words without flags, as a prefix (``pnpm lint`` matches ``pnpm lint --fix``; a trailing
``*`` changes nothing). A path is matched with ``fnmatch`` against the path relative to the project.
"""

from __future__ import annotations

import fnmatch
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Protocol

from .. import shell
from .model import Check, Guard, Memory

FORMS = (
    'check.when: before command "<command>" | after a change to "<path glob>" | when the run ends '
    '| when the run ends after a change to "<path glob>"; '
    'check.expect: command "<command>" ran after the last change | command "<command>" ran '
    "| the file is new (only with after a change to); "
    'guard.before: command "<command>" | editing "<path glob>"'
)

_BEFORE_COMMAND = re.compile(r'^before command "([^"]+)"$')
_AFTER_CHANGE = re.compile(r'^after a change to "([^"]+)"$')
_RUN_END = re.compile(r'^when the run ends(?: after a change to "([^"]+)")?$')
_RAN_AFTER_CHANGE = re.compile(r'^command "([^"]+)" ran after the last change$')
_RAN = re.compile(r'^command "([^"]+)" ran$')
_GUARD_COMMAND = re.compile(r'^command "([^"]+)"$')
_GUARD_EDITING = re.compile(r'^editing "([^"]+)"$')


@dataclass(frozen=True)
class Event:
    """One thing the harness saw happen, in order."""

    kind: Literal["command", "change"]
    words: tuple[str, ...] = ()
    """A command's words without flags."""
    path: str = ""
    """A changed file, relative to the project."""
    new: bool = False
    """The changed file did not exist before."""


@dataclass(frozen=True)
class Facts:
    events: tuple[Event, ...]
    run_start: int = 0
    """Where the current run's events begin."""


class CheckRunner(Protocol):
    def before_command(self, facts: Facts, command: str) -> list[str]:
        """What to tell the agent instead of running ``command``; empty when it may run."""
        ...

    def after_change(self, facts: Facts, change: Event) -> list[str]:
        """What to tell the agent after a file changed (``change`` is the last event of ``facts``)."""
        ...

    def at_run_end(self, facts: Facts) -> list[str]:
        """What to tell the agent when it answered."""
        ...


class GuardMatcher(Protocol):
    def asks(self, name: str, args: dict[str, Any], root: Path) -> str | None:
        """Why the user must be asked about this call, or ``None``."""
        ...


def check_form(check: Check) -> None:
    """Raises ``ValueError`` (with the forms) when ``check`` is not written in one of the forms."""
    when, expect = check.when.strip(), check.expect.strip()
    if not (_BEFORE_COMMAND.match(when) or _AFTER_CHANGE.match(when) or _RUN_END.match(when)):
        raise ValueError(f"check.when is not one of the forms. {FORMS}")
    if expect == "the file is new":
        if not _AFTER_CHANGE.match(when):
            raise ValueError(f'"the file is new" goes with after a change to "<path glob>". {FORMS}')
    elif not (_RAN_AFTER_CHANGE.match(expect) or _RAN.match(expect)):
        raise ValueError(f"check.expect is not one of the forms. {FORMS}")
    if not check.say.strip():
        raise ValueError("check.say is empty: say what the agent should do")


def guard_form(guard: Guard) -> None:
    """Raises ``ValueError`` (with the forms) when ``guard`` is not written in one of the forms."""
    before = guard.before.strip()
    if not (_GUARD_COMMAND.match(before) or _GUARD_EDITING.match(before)):
        raise ValueError(f"guard.before is not one of the forms. {FORMS}")
    if not guard.say.strip():
        raise ValueError("guard.say is empty: say why the user is asked")


class FormChecks:
    """``CheckRunner`` over the checks of the given memories, written in the forms above."""

    def __init__(self, memories: Sequence[Memory]) -> None:
        self.checks = [m.check for m in memories if m.check is not None and _valid(check_form, m.check)]

    def before_command(self, facts: Facts, command: str) -> list[str]:
        ran = _commands(command)
        failed = []
        for check in self.checks:
            match = _BEFORE_COMMAND.match(check.when.strip())
            at = next((i for i, words in enumerate(ran) if _runs(words, match[1])), None) if match else None
            if at is None:
                continue
            # What the same script runs first counts too: `pnpm lint && git commit` passes.
            earlier = Facts((*facts.events, *(Event("command", words) for words in ran[:at])), facts.run_start)
            if not _holds(check, earlier, None):
                failed.append(check.say)
        return failed

    def after_change(self, facts: Facts, change: Event) -> list[str]:
        failed = []
        for check in self.checks:
            match = _AFTER_CHANGE.match(check.when.strip())
            if match and fnmatch.fnmatch(change.path, match[1]) and not _holds(check, facts, change):
                failed.append(check.say)
        return failed

    def at_run_end(self, facts: Facts) -> list[str]:
        failed = []
        run = facts.events[facts.run_start :]
        for check in self.checks:
            match = _RUN_END.match(check.when.strip())
            if not match:
                continue
            if match[1] and not any(e.kind == "change" and fnmatch.fnmatch(e.path, match[1]) for e in run):
                continue
            if not _holds(check, facts, None):
                failed.append(check.say)
        return failed


class PatternGuards:
    """``GuardMatcher`` over the guards of the given memories: commands by their words, edits by their path."""

    def __init__(self, memories: Sequence[Memory]) -> None:
        self.guards = [m.guard for m in memories if m.guard is not None and _valid(guard_form, m.guard)]

    def asks(self, name: str, args: dict[str, Any], root: Path) -> str | None:
        for guard in self.guards:
            before = guard.before.strip()
            command = _GUARD_COMMAND.match(before)
            if command and name == "bash":
                if any(_runs(words, command[1]) for words in _commands(str(args.get("command", "")))):
                    return guard.say
            editing = _GUARD_EDITING.match(before)
            if editing and name in ("edit", "write") and fnmatch.fnmatch(relative(args.get("path"), root), editing[1]):
                return guard.say
        return None


def relative(path: Any, root: Path) -> str:
    """``path`` as the agent gave it, relative to ``root`` when inside it."""
    if not isinstance(path, str) or not path:
        return ""
    full = Path(path).expanduser()
    full = full if full.is_absolute() else root / full
    try:
        return full.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return full.as_posix()


def _holds(check: Check, facts: Facts, change: Event | None) -> bool:
    expect = check.expect.strip()
    if expect == "the file is new":
        return change is not None and change.new
    after = _RAN_AFTER_CHANGE.match(expect)
    pattern = after[1] if after else _RAN.match(expect)[1]  # type: ignore[index]  # check_form passed
    start = 0
    if after:
        changes = [i for i, e in enumerate(facts.events) if e.kind == "change"]
        start = changes[-1] + 1 if changes else 0
    return any(e.kind == "command" and _runs(e.words, pattern) for e in facts.events[start:])


def _runs(words: tuple[str, ...], pattern: str) -> bool:
    rule = tuple(w for w in pattern.rstrip("*").split() if not w.startswith("-"))
    return bool(rule) and shell.matches(words, rule)


def _commands(script: str) -> tuple[tuple[str, ...], ...]:
    return shell.analyze(script).commands if script.strip() else ()


def _valid(form: Any, rule: Any) -> bool:
    try:
        form(rule)
    except ValueError:
        return False  # a file edited by hand into a form the harness cannot read is left out, not guessed at
    return True
