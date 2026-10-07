"""Auto mode's reviewer: decides in the user's place about the calls the rules would ask about (``docs/auto-mode.md``).

The parts are separate so each can be replaced:

- ``Reviewer`` decides. ``ModelReviewer`` asks a model; another one could ask a classifier API or read the
  conversation its own way. The core hands every reviewer the whole conversation and the reviewer picks what to read.
- ``user_view`` is what ``ModelReviewer`` reads: the user's messages and the agent's tool calls. The agent's own text
  and every tool result are left out, so the agent cannot talk the reviewer round and text injected into a file or a
  web page never reaches it.
- ``TrustedSource`` gives the user's own words about what is fine (``GlobalAgentsMd``). Only what the user wrote or
  approved belongs here; a project's AGENTS.md may be someone else's words and is never one.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from alpineagents import Agent, Message, Model, State
from alpineagents.types import TextBlock

from .home import home_dir

if TYPE_CHECKING:
    from .approval import ApprovalRequest

#: Longest argument value shown for a call in the conversation; the call under review is shown whole.
ARG_LENGTH = 400
#: Most characters of conversation the reviewer reads; older entries are left out first (the first message stays).
CONVERSATION_LENGTH = 40_000


@dataclass(frozen=True)
class TrustedNote:
    source: str
    """Where it comes from, as the user would recognise it, e.g. ``~/.alpine-code/AGENTS.md``."""
    text: str


class TrustedSource(Protocol):
    """Gives the user's own words about what the agent may do. Called once per review."""

    def notes(self, cwd: Path) -> list[TrustedNote]: ...


@dataclass(frozen=True)
class ReviewRequest:
    call: ApprovalRequest
    """The call, as the user would have been asked about it."""
    conversation: Sequence[Message]
    """The whole conversation so far, the reply with the call included. The reviewer picks what to read."""
    trusted: Sequence[TrustedNote] = ()
    """The user's own words, from the trusted sources."""


@dataclass(frozen=True)
class Review:
    allow: bool
    reason: str | None = None
    """Why it was blocked, in a few words the user and the agent are both shown."""


class Reviewer(Protocol):
    """Decides about one call. Raising (or taking too long) is a failure: the user is asked instead."""

    async def review(self, request: ReviewRequest) -> Review: ...


class GlobalAgentsMd:
    """The global instructions file, which only the user writes."""

    def notes(self, cwd: Path) -> list[TrustedNote]:
        file = home_dir() / "AGENTS.md"
        try:
            text = file.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return []
        return [TrustedNote("~/.alpine-code/AGENTS.md", text)] if text else []


def user_view(conversation: Sequence[Message]) -> list[Message]:
    """The user's messages (text only, no notices, no tool results) and the agent's tool calls (no text, no
    thinking), in order. Messages left with nothing are dropped."""
    view: list[Message] = []
    for message in conversation:
        if message.role == "user":
            if message.is_notice:
                continue
            blocks: tuple[Any, ...] = tuple(b for b in message.content if isinstance(b, TextBlock))
        else:
            blocks = message.tool_calls
        if blocks:
            view.append(Message(message.role, blocks))
    return view


@dataclass(frozen=True)
class _Answer:
    allow: bool
    reason: str = ""
    """Required when blocking: a few words saying what is wrong with this call."""


class ModelReviewer:
    """Asks a model, with a fixed set of rules (``prompts/review.md``), about the ``user_view`` of the conversation.
    An answer that does not fit the format is asked again once, then it is a failure."""

    def __init__(self, model: Model | str) -> None:
        self._agent = Agent(model, system=review_instructions(), reporter=None, human=None)

    async def review(self, request: ReviewRequest) -> Review:
        state = State(messages=[Message.user(render(request))])
        answer: _Answer = await self._agent.aask(state, QUESTION, returns=_Answer, retries=1)
        if answer.allow:
            return Review(True)
        return Review(False, answer.reason.strip() or None)


QUESTION = "Decide about the action under review. Answer with allow, and a reason when you block it."


def review_instructions() -> str:
    return files("alpine_core").joinpath("prompts/review.md").read_text(encoding="utf-8")


def render(request: ReviewRequest) -> str:
    """What ``ModelReviewer`` sends: the user's own words, the conversation's user view and the call."""
    parts = []
    for note in request.trusted:
        parts.append(f'<user_instructions source="{note.source}">\n{note.text}\n</user_instructions>')
    entries = [_entry(m) for m in user_view(request.conversation)]
    parts.append("<conversation>\n" + "\n".join(_fit(entries)) + "\n</conversation>")
    call = request.call
    action = [f"tool: {call.tool}", f"arguments: {_json(call.args)}"]
    if call.reason:
        action.append(f"why the rules did not let it run on their own: {call.reason}")
    parts.append("<action_under_review>\n" + "\n".join(action) + "\n</action_under_review>")
    return "\n\n".join(parts)


def _entry(message: Message) -> str:
    if message.role == "user":
        return f"<user>\n{message.text}\n</user>"
    return "\n".join(f'<tool_call name="{c.name}">{_json(c.args, ARG_LENGTH)}</tool_call>' for c in message.tool_calls)


def _fit(entries: list[str]) -> list[str]:
    """Leaves out the oldest entries but the first until the rest fit ``CONVERSATION_LENGTH``."""
    if not entries:
        return entries
    first, rest = entries[0], entries[1:]
    total = len(first)
    kept: list[str] = []
    for entry in reversed(rest):
        if total + len(entry) > CONVERSATION_LENGTH:
            return [first, f"({len(rest) - len(kept)} earlier entries left out)", *reversed(kept)]
        total += len(entry)
        kept.append(entry)
    return [first, *reversed(kept)]


def _json(args: Mapping[str, Any], limit: int | None = None) -> str:
    values = {k: _cut(v, limit) if limit is not None else v for k, v in args.items()}
    return json.dumps(values, ensure_ascii=False, default=str)


def _cut(value: Any, limit: int) -> Any:
    if isinstance(value, str) and len(value) > limit:
        return value[:limit] + f"... ({len(value) - limit} more characters)"
    return value
