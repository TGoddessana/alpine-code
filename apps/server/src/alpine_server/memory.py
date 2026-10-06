"""The ``memory/*`` methods: a project's memories and the suggestions waiting for the user (docs/memory.md).

Approving runs on the event loop, where the sessions live, because approving tells the running sessions. A change
can come from any thread (the agent suggests from a tool's thread), so ``memory/changed`` is sent from the loop.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from alpine_core import Evidence, Memories, Memory, MemoryNotes, Refused, Suggestion
from alpine_protocol import (
    MemoryApproveParams,
    MemoryApproveResult,
    MemoryChangedParams,
    MemoryEvidence,
    MemoryForgetParams,
    MemoryForgetResult,
    MemoryInfo,
    MemoryListParams,
    MemoryListResult,
    MemoryRejectParams,
    MemoryRejectResult,
    MemorySuggestionInfo,
)

from .methods import APP_ERROR, MethodError

Notify = Callable[[MemoryChangedParams], None]


class MemoryMethods:
    def __init__(self, memories: Memories, notify: Notify) -> None:
        self.memories = memories
        self._notify = notify
        try:
            self._loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None
        memories.on_change(self._changed)

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "memory/list": self.list,
            "memory/approve": self.approve,
            "memory/reject": self.reject,
            "memory/forget": self.forget,
        }

    async def list(self, params: MemoryListParams) -> MemoryListResult:
        system = self.memories.of(_folder(params.cwd))
        return MemoryListResult(
            memories=[_memory(m, system.inbox.notes(m.scope, m.id)) for m in system.memories()],
            pending=[_suggestion(s) for s in system.inbox.pending()],
        )

    async def approve(self, params: MemoryApproveParams) -> MemoryApproveResult:
        folder = _folder(params.cwd)
        try:
            memory = self.memories.approve(folder, params.suggestion_id)
        except KeyError as e:
            raise MethodError(APP_ERROR, "No such suggestion", "not_found") from e
        except Refused as e:
            raise MethodError(APP_ERROR, str(e), "memory_full") from e
        notes = self.memories.of(folder).inbox.notes(memory.scope, memory.id)
        return MemoryApproveResult(memory=_memory(memory, notes))

    async def reject(self, params: MemoryRejectParams) -> MemoryRejectResult:
        try:
            self.memories.of(_folder(params.cwd)).inbox.reject(params.suggestion_id)
        except KeyError as e:
            raise MethodError(APP_ERROR, "No such suggestion", "not_found") from e
        return MemoryRejectResult()

    async def forget(self, params: MemoryForgetParams) -> MemoryForgetResult:
        self.memories.forget(_folder(params.cwd), params.scope, params.memory_id)
        return MemoryForgetResult()

    def _changed(self, project: Path) -> None:
        params = MemoryChangedParams(cwd=str(project))
        loop = self._loop
        if loop is None or _on(loop):
            self._notify(params)
        else:
            loop.call_soon_threadsafe(self._notify, params)


def _on(loop: asyncio.AbstractEventLoop) -> bool:
    try:
        return asyncio.get_running_loop() is loop
    except RuntimeError:
        return False


def _folder(cwd: str) -> Path:
    folder = Path(cwd)
    if not folder.is_dir():
        raise MethodError(APP_ERROR, f"Not a folder: {cwd}", "not_a_folder")
    return folder


def _evidence(evidence: Evidence) -> MemoryEvidence:
    return MemoryEvidence(session_id=evidence.session, at=evidence.at, quote=evidence.quote)


def _memory(memory: Memory, notes: MemoryNotes) -> MemoryInfo:
    return MemoryInfo(
        id=memory.id,
        kind=memory.kind,
        scope=memory.scope,
        headline=memory.headline,
        body=memory.body,
        path=str(memory.path) if memory.path else None,
        evidence=[_evidence(e) for e in notes.evidence],
        said_again=[_evidence(e) for e in notes.said_again],
    )


def _suggestion(suggestion: Suggestion) -> MemorySuggestionInfo:
    return MemorySuggestionInfo(
        id=suggestion.id,
        kind=suggestion.kind,
        scope=suggestion.scope,
        headline=suggestion.headline,
        body=suggestion.body,
        replaces=list(suggestion.replaces),
        evidence=[_evidence(e) for e in suggestion.evidence],
        source=suggestion.source,
        remove=suggestion.remove,
    )
