"""Memory: what the agent learns about a project and its user across sessions (docs/memory.md).

The parts are ports, each with one default, put together by ``memory_system``:

- kinds (``Kind``, default ``KINDS``): what is worth keeping
- store (``MemoryStore``, default ``MarkdownStore``): where memories are kept
- recall (``Recall``, default ``IndexRecall``): how they reach the model
- proposer (``Proposer``, default ``AgentProposes``): who suggests them, and when

The inbox between proposer and store is not a port: only what the user approves is kept.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..home import home_dir
from .inbox import CAP, Inbox, MemoryNotes, Refused, Similar, similar_text
from .model import KINDS, SCOPES, Evidence, Kind, Memory, Scope, Suggestion, project_key
from .proposer import AgentProposes, Proposer
from .recall import IndexRecall, Recall
from .store import MarkdownStore, MemoryStore, scope_folders

__all__ = [
    "CAP",
    "KINDS",
    "SCOPES",
    "AgentProposes",
    "Evidence",
    "Inbox",
    "IndexRecall",
    "Kind",
    "MarkdownStore",
    "Memory",
    "MemoryNotes",
    "MemoryStore",
    "MemorySystem",
    "Proposer",
    "Recall",
    "Refused",
    "Scope",
    "Similar",
    "Suggestion",
    "memory_system",
    "scope_folders",
    "similar_text",
]


@dataclass(frozen=True)
class MemorySystem:
    kinds: tuple[Kind, ...]
    store: MemoryStore
    recall: Recall
    proposer: Proposer
    inbox: Inbox

    def memories(self) -> list[Memory]:
        return [m for scope in SCOPES for m in self.store.list(scope)]

    def system_block(self) -> str:
        """For the system prompt when a session starts."""
        return self.recall.system_block(self.memories())

    def tools(self) -> list[Any]:
        """For the working agent: the proposer's tools and the recall's."""
        return [*self.proposer.tools(self.inbox), *self.recall.tools()]


def memory_system(
    project: Path,
    *,
    home: Path | None = None,
    kinds: Sequence[Kind] = KINDS,
    store: MemoryStore | None = None,
    recall: Recall | None = None,
    proposer: Proposer | None = None,
    cap: int = CAP,
    similar: Similar = similar_text,
) -> MemorySystem:
    """The memory of one project, with the defaults for every part left out. What the inbox knows is kept under
    ``<home>/projects/<project>/inbox.json``."""
    project = project.expanduser().resolve()
    home = home or home_dir()
    kinds = tuple(kinds)
    store = store or MarkdownStore(project, home)
    inbox = Inbox(store, home / "projects" / project_key(project) / "inbox.json", kinds=kinds, cap=cap, similar=similar)
    return MemorySystem(
        kinds=kinds,
        store=store,
        recall=recall or IndexRecall(project, kinds),
        proposer=proposer or AgentProposes(kinds),
        inbox=inbox,
    )
