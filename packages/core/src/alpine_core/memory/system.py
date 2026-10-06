"""A project's memory: its parts put together."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from alpineagents import State

from ..home import home_dir
from .inbox import CAP, Inbox, Similar, similar_text
from .model import KINDS, SCOPES, Kind, Memory, project_key
from .proposer import AgentProposes, Proposer
from .pruning import MissingPaths
from .recall import IndexRecall, Recall
from .store import MarkdownStore, MemoryStore


@dataclass(frozen=True)
class MemorySystem:
    kinds: tuple[Kind, ...]
    store: MemoryStore
    recall: Recall
    proposers: tuple[Proposer, ...]
    inbox: Inbox

    def memories(self) -> list[Memory]:
        return [m for scope in SCOPES for m in self.store.list(scope)]

    def system_block(self) -> str:
        """For the system prompt when a session starts."""
        return self.recall.system_block(self.memories())

    def tools(self) -> list[Any]:
        """For the working agent: the proposers' tools and the recall's."""
        return [*(t for p in self.proposers for t in p.tools(self.inbox)), *self.recall.tools()]

    def on_run_end(self, state: State) -> dict[str, int]:
        """Lets every proposer look after a run. Returns how many new suggestions each made, by source, leaving out
        the ones that made none."""
        made = {p.source: p.on_run_end(state, self.inbox) for p in self.proposers}
        return {source: n for source, n in made.items() if n}

    def readable(self) -> list[Path]:
        """Folders the agent may read without asking, so a memory's file can be opened."""
        return self.store.folders()


def memory_system(
    project: Path,
    *,
    home: Path | None = None,
    kinds: Sequence[Kind] = KINDS,
    store: MemoryStore | None = None,
    recall: Recall | None = None,
    proposers: Sequence[Proposer] | None = None,
    cap: int = CAP,
    similar: Similar = similar_text,
    on_change: Callable[[], None] | None = None,
) -> MemorySystem:
    """The memory of one project, with the defaults for every part left out. What the inbox knows is kept under
    ``<home>/projects/<project>/inbox.json``."""
    project = project.expanduser().resolve()
    home = home or home_dir()
    kinds = tuple(kinds)
    store = store or MarkdownStore(project, home)
    inbox = Inbox(
        store,
        home / "projects" / project_key(project) / "inbox.json",
        kinds=kinds,
        cap=cap,
        similar=similar,
        on_change=on_change,
    )
    return MemorySystem(
        kinds=kinds,
        store=store,
        recall=recall or IndexRecall(project, kinds),
        proposers=tuple(proposers) if proposers is not None else (AgentProposes(kinds), MissingPaths(project)),
        inbox=inbox,
    )
