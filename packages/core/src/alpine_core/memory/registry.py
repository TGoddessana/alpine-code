"""The memory of every project one process works in, shared by its sessions and the app."""

from __future__ import annotations

import threading
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from ..home import home_dir
from .model import Memory, Scope
from .system import MemorySystem, memory_system


class _Build(Protocol):
    def __call__(self, project: Path, *, home: Path, on_change: Callable[[], None]) -> MemorySystem: ...


class Memories:
    """One ``MemorySystem`` per project folder, so one inbox guards each project's files.

    Approve and forget through ``approve`` and ``forget`` rather than the inbox itself: they are what tell the
    running sessions. A session hears of memories of its own project, and of the user's memories for every project
    from anywhere.
    """

    def __init__(self, home: Path | None = None, *, build: _Build | None = None) -> None:
        self.home = home or home_dir()
        self._build: _Build = build or memory_system
        self._systems: dict[Path, MemorySystem] = {}
        self._approved: dict[int, tuple[Path, Callable[[Memory, bool], None]]] = {}
        self._changed: dict[int, Callable[[Path], None]] = {}
        self._next = 0
        self._lock = threading.Lock()

    def of(self, project: Path) -> MemorySystem:
        project = project.expanduser().resolve()
        with self._lock:
            if project not in self._systems:
                self._systems[project] = self._build(
                    project, home=self.home, on_change=lambda: self._tell_changed(project)
                )
            return self._systems[project]

    def approve(self, project: Path, suggestion_id: str) -> Memory:
        """``Inbox.approve``, then tells the sessions the memory applies to.

        Raises:
            KeyError: No such pending suggestion.
            Refused: Its scope filled up since it was made.
        """
        project = project.expanduser().resolve()
        inbox = self.of(project).inbox
        removing = any(s.id == suggestion_id and s.remove for s in inbox.pending())
        memory = inbox.approve(suggestion_id)
        self._tell_approved(project, memory, removing)
        return memory

    def forget(self, project: Path, scope: Scope, memory_id: str) -> None:
        """``Inbox.forget``, then tells the sessions the memory applied to that it is gone."""
        project = project.expanduser().resolve()
        system = self.of(project)
        memory = next((m for m in system.store.list(scope) if m.id == memory_id), None)
        system.inbox.forget(scope, memory_id)
        if memory is not None:
            self._tell_approved(project, memory, True)

    def on_approved(self, project: Path, listener: Callable[[Memory, bool], None]) -> Callable[[], None]:
        """Calls ``listener(memory, removed)`` for every memory approved for ``project``, or removed from it.
        Returns what stops it."""
        return self._add(self._approved, (project.expanduser().resolve(), listener))

    def on_change(self, listener: Callable[[Path], None]) -> Callable[[], None]:
        """Calls ``listener`` with the project folder whenever its memories or suggestions change."""
        return self._add(self._changed, listener)

    def _add[T](self, listeners: dict[int, T], value: T) -> Callable[[], None]:
        with self._lock:
            key = self._next
            self._next += 1
            listeners[key] = value

        def stop() -> None:
            with self._lock:
                listeners.pop(key, None)

        return stop

    def _tell_approved(self, project: Path, memory: Memory, removed: bool) -> None:
        with self._lock:
            listeners = [
                listener for where, listener in self._approved.values() if memory.scope == "me" or where == project
            ]
        for listener in listeners:
            listener(memory, removed)

    def _tell_changed(self, project: Path) -> None:
        with self._lock:
            listeners = list(self._changed.values())
        for listener in listeners:
            listener(project)
