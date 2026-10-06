"""Who suggests memories, and when. The default gives the working agent ``propose_memory``; other proposers (a
review before compacting, a forked review every few turns, the harness's pruning) act at the moments below."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any

from alpineagents import State, ToolError, tool

from .inbox import Inbox, Refused
from .model import KINDS, Evidence, Kind

#: Longest quote of the user's message kept as evidence.
QUOTE_CHARS = 500


class Proposer:
    """Base for proposers: every moment does nothing unless a subclass says otherwise."""

    source = "proposer"

    def tools(self, inbox: Inbox) -> list[Any]:
        """Tools given to the working agent."""
        return []

    async def on_turn_end(self, agent: Any, state: State, inbox: Inbox) -> None:
        pass

    async def on_before_compact(self, agent: Any, state: State, inbox: Inbox) -> None:
        pass

    async def on_session_end(self, agent: Any, state: State, inbox: Inbox) -> None:
        pass


class AgentProposes(Proposer):
    """The working agent suggests a memory the moment it notices one, through ``propose_memory``."""

    source = "agent"

    def __init__(self, kinds: Sequence[Kind] = KINDS) -> None:
        self.kinds = tuple(kinds)

    def tools(self, inbox: Inbox) -> list[Any]:
        kinds = "\n".join(
            f"- {k.name}: {k.guide}. Headline: {k.headline}."
            + ("" if len(k.scopes) == 3 else f" Only in {' or '.join(sorted(k.scopes))}.")
            for k in self.kinds
        )
        description = (
            "Suggest something to remember in later sessions. The user approves or declines it later; carry on "
            "with your work. Suggest when you learn something that will matter again, typically when the user "
            "corrects you. Do not suggest what the code, AGENTS.md or the memory index already says, a failure you "
            "did not solve, or a one-off detail of this task.\n\n"
            f"Kinds:\n{kinds}\n\n"
            "Scopes: team (kept in the repository, for everyone working on it), project_me (this project, only "
            "this user), me (this user, every project)."
        )
        source = self.source

        @tool(name="propose_memory", description=description, read_only=True, open_world=False)
        def propose_memory(
            kind: str,
            scope: str,
            headline: str,
            body: str,
            name: str,
            state: State,
            replaces: list[str] | None = None,
        ) -> str:
            """
            Args:
                kind: One of the kinds above
                scope: team, project_me or me
                headline: One line, what must be known without opening it (see the kind)
                body: Why, with concrete examples (commands, paths, what happened). Keep the specifics
                name: A short file name in English, like lint-before-commit
                replaces: Names of memories in the same scope that this one changes, merges or removes
            """
            try:
                suggestion = inbox.propose(
                    kind=kind,
                    scope=scope,  # type: ignore[arg-type]  # checked by the inbox
                    headline=headline,
                    body=body,
                    name=name,
                    evidence=Evidence(state.id, datetime.now(UTC), _last_user_text(state)),
                    source=source,
                    replaces=replaces or (),
                )
            except Refused as e:
                raise ToolError(str(e)) from e
            changes = f" It changes {', '.join(suggestion.replaces)}." if suggestion.replaces else ""
            return f"Suggested; it waits for the user's approval.{changes} Carry on."

        return [propose_memory]


def _last_user_text(state: State) -> str:
    for message in reversed(state.messages):
        if message.role == "user" and not message.is_notice and message.text.strip():
            return message.text.strip()[:QUOTE_CHARS]
    return ""
