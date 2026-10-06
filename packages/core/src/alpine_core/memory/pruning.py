"""Proposers of the harness: suggestions from what it observes, never from the model (docs/memory.md, Pruning)."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from alpineagents import State

from .inbox import Inbox, Refused
from .model import Evidence, Memory, Scope
from .proposer import Proposer

#: Code spans in a memory's text: where a path would be written.
_CODE = re.compile(r"`([^`\s]+)`")


class MissingPaths(Proposer):
    """Suggests removing a memory when a path it names in backticks is gone from the project.

    Only relative paths with a ``/`` whose first folder still exists count, so a branch (``origin/main``), a package
    (``@alpine/ui``) or a command is never taken for a path, and a path is only called gone when the rest of the
    project is there. The user's memories for every project are not checked: they name no project's paths. The
    evidence's quote is the missing paths, so a removal the user declined is not suggested again while the same
    paths are missing.
    """

    source = "missing_paths"

    def __init__(self, project: Path) -> None:
        self.project = project.expanduser().resolve()

    def on_run_end(self, state: State, inbox: Inbox) -> int:
        waiting = {(s.scope, s.replaces) for s in inbox.pending() if s.remove}
        made = 0
        scopes: tuple[Scope, ...] = ("team", "project_me")
        for scope in scopes:
            for memory in inbox.store.list(scope):
                if (scope, (memory.id,)) in waiting:
                    continue
                missing = self.missing(memory)
                if not missing:
                    continue
                evidence = Evidence(state.id, datetime.now(UTC), ", ".join(missing))
                try:
                    inbox.propose_removal(scope=scope, memory_id=memory.id, evidence=evidence, source=self.source)
                except Refused:  # declined for these same paths
                    continue
                made += 1
        return made

    def missing(self, memory: Memory) -> list[str]:
        """The paths ``memory`` names that are gone, in the order it names them."""
        found = []
        for token in _CODE.findall(f"{memory.headline}\n{memory.body}"):
            path = token.rstrip("/")
            if "/" not in path or path.startswith(("/", "~", "@", ".")) or "://" in path:
                continue
            first = self.project / path.split("/")[0]
            if first.exists() and not (self.project / path).exists() and token not in found:
                found.append(token)
        return found
