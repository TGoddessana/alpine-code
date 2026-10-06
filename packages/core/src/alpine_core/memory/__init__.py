"""Memory: what the agent learns about a project and its user across sessions (docs/memory.md).

The parts are ports, each with one default, put together by ``memory_system``:

- kinds (``Kind``, default ``KINDS``): what is worth keeping
- store (``MemoryStore``, default ``MarkdownStore``): where memories are kept
- recall (``Recall``, default ``IndexRecall``): how they reach the model
- proposer (``Proposer``, default ``AgentProposes``): who suggests them, and when

The inbox between proposer and store is not a port: only what the user approves is kept.
"""

from __future__ import annotations

from .inbox import CAP, Inbox, MemoryNotes, Refused, Similar, similar_text
from .model import KINDS, SCOPES, Evidence, Kind, Memory, Scope, Suggestion, project_key
from .proposer import AgentProposes, Proposer
from .recall import IndexRecall, Recall
from .registry import Memories
from .store import MarkdownStore, MemoryStore, scope_folders
from .system import MemorySystem, memory_system

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
    "Memories",
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
    "project_key",
    "scope_folders",
    "similar_text",
]
