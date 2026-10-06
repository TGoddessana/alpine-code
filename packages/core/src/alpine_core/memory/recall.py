"""How memories reach the model. The default puts an index in the system prompt; bodies are read with ``read``."""

from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path
from typing import Any, Protocol

from .model import KINDS, SCOPES, Kind, Memory

_SCOPE_NAMES = {"team": "team", "project_me": "this project, this user", "me": "this user, every project"}
_HEADINGS = {
    "team": "Team (kept in the repository, shared with everyone working on it)",
    "project_me": "This project, this user",
    "me": "This user, every project",
}


class Recall(Protocol):
    def system_block(self, memories: Sequence[Memory]) -> str:
        """Text for the system prompt, built once when a session starts so the prompt cache holds. Empty when
        there is nothing to recall."""
        ...

    def notice(self, memory: Memory) -> str:
        """Text for a memory approved while a session runs, added to the conversation instead of the prompt."""
        ...

    def tools(self) -> list[Any]:
        """Tools this way of recalling needs (a search, say). The default needs none."""
        ...


class IndexRecall:
    """One line per memory, grouped by scope: what to know, and the file with its reason and examples."""

    def __init__(self, project: Path, kinds: Sequence[Kind] = KINDS) -> None:
        self.project = project.expanduser().resolve()
        self.order = [k.name for k in kinds]

    def system_block(self, memories: Sequence[Memory]) -> str:
        if not memories:
            return ""
        parts = [
            "# Memory\n"
            "What was learned working here and approved by the user. Each line is what to know; its file has the "
            "reason and examples. Read the file when you need them."
        ]
        for scope in SCOPES:
            lines = [self._line(m) for m in sorted(memories, key=self._rank) if m.scope == scope]
            if lines:
                parts.append(f"## {_HEADINGS[scope]}\n" + "\n".join(lines))
        return "\n\n".join(parts)

    def notice(self, memory: Memory) -> str:
        return f"The user approved a new memory ({_SCOPE_NAMES[memory.scope]}):\n{self._line(memory)}"

    def tools(self) -> list[Any]:
        return []

    def _rank(self, memory: Memory) -> tuple[int, str]:
        kind = self.order.index(memory.kind) if memory.kind in self.order else len(self.order)
        return kind, memory.id

    def _line(self, memory: Memory) -> str:
        if memory.path is None:
            return f"- {memory.kind}: {memory.headline}"
        path = memory.path
        shown = path.relative_to(self.project) if path.is_relative_to(self.project) else path
        return f"- {memory.kind}: {memory.headline} ({shown})"
