"""The inbox: every suggestion goes through it, whoever proposed it, and only what the user approves is kept.

Its rules are fixed (docs/memory.md); everything around it is a port:

- A suggestion close to a pending one joins it, adding its evidence. A suggestion to remove a memory joins a pending
  one for the same memory.
- A suggestion close to an approved memory marks that memory "said again" and becomes a change of it.
- A suggestion on evidence the user already declined is refused.
- A scope is full at ``cap`` memories: a new one must name what it merges or removes, and both are approved at once.
- Nothing is written to the store before the user approves.

What the inbox knows besides the memories themselves (pending and declined suggestions, each memory's evidence and
"said again" dates) is kept in one JSON file outside the repository.
"""

from __future__ import annotations

import difflib
import json
import re
import threading
import uuid
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any

from .model import KINDS, Check, Evidence, Guard, Kind, Memory, Scope, Suggestion, file_name
from .rules import check_form, guard_form
from .store import MemoryStore

#: Most memories per scope to start with (docs/memory.md, Pruning).
CAP = 30


class Refused(ValueError):
    """The suggestion was not taken. The message says why, for the model to act on."""


@dataclass(frozen=True)
class MemoryNotes:
    """What the inbox keeps about an approved memory."""

    evidence: tuple[Evidence, ...] = ()
    said_again: tuple[Evidence, ...] = ()
    """Suggestions close to it after it was approved: it was not followed, or needs saying better."""


Similar = Callable[[str, str], bool]


def similar_text(a: str, b: str) -> bool:
    """The default test for "close": the same words give or take punctuation, one inside the other, or mostly the
    same characters. Cheap and local; a model-based test can replace it."""
    a, b = _normal(a), _normal(b)
    if not a or not b:
        return False
    return a in b or b in a or difflib.SequenceMatcher(None, a, b).ratio() >= 0.75


class Inbox:
    def __init__(
        self,
        store: MemoryStore,
        file: Path,
        *,
        kinds: Sequence[Kind] = KINDS,
        cap: int = CAP,
        similar: Similar = similar_text,
        on_change: Callable[[], None] | None = None,
    ) -> None:
        """``on_change`` is called after every change to what the inbox or the store holds, so an app can redraw."""
        self.store = store
        self.file = file
        self.kinds = {k.name: k for k in kinds}
        self.cap = cap
        self.similar = similar
        self.on_change = on_change
        # Reentrant: on_change runs while the lock is held and may read the inbox again.
        self._lock = threading.RLock()

    def propose(
        self,
        *,
        kind: str,
        scope: Scope,
        headline: str,
        body: str,
        name: str,
        evidence: Evidence,
        source: str,
        replaces: Sequence[str] = (),
        check: Check | None = None,
        guard: Guard | None = None,
    ) -> Suggestion:
        """Takes a suggestion to wait for the user. Returns it as it waits (joined with an earlier one, maybe).

        Raises:
            Refused: An unknown kind or a scope the kind may not use, a headline that is not one line, a check or
                guard not in the forms (``rules.py``), a memory in ``replaces`` that does not exist, evidence the
                user already declined, or a full scope.
        """
        headline = " ".join(headline.split())
        self._check(kind, scope, headline)
        try:
            if check is not None:
                check_form(check)
            if guard is not None:
                guard_form(guard)
        except ValueError as e:
            raise Refused(str(e)) from e
        with self._lock:
            data = self._read()
            memories = {m.id: m for m in self.store.list(scope)}
            unknown = [r for r in replaces if r not in memories]
            if unknown:
                raise Refused(f"no {scope} memory named {', '.join(unknown)}; use the names in the memory index")
            self._check_declined(data, scope, headline, evidence, remove=False)

            replaces = list(dict.fromkeys(replaces))
            for memory in memories.values():
                if memory.id not in replaces and self.similar(memory.headline, headline):
                    notes = self._notes(data, scope, memory.id)
                    data["memories"][_key(scope, memory.id)] = _dump_notes(
                        replace(notes, said_again=(*notes.said_again, evidence))
                    )
                    replaces.append(memory.id)

            for i, waiting in enumerate(data["pending"]):
                if (
                    not waiting.get("remove")
                    and waiting["scope"] == scope
                    and self.similar(waiting["headline"], headline)
                ):
                    joined = replace(
                        _load_suggestion(waiting),
                        kind=kind,
                        headline=headline,
                        body=body,
                        replaces=tuple(dict.fromkeys([*waiting["replaces"], *replaces])),
                        evidence=(*_load_suggestion(waiting).evidence, evidence),
                        source=source,
                        check=check,
                        guard=guard,
                    )
                    data["pending"][i] = _dump_suggestion(joined)
                    self._write(data)
                    return joined

            if len(memories) - len(replaces) + 1 > self.cap:
                raise Refused(
                    f"{scope} memory is full ({self.cap}); name the memories this one merges or removes in replaces"
                )
            suggestion = Suggestion(
                id=uuid.uuid4().hex[:12],
                kind=kind,
                scope=scope,
                headline=headline,
                body=body.strip(),
                name=file_name(name),
                replaces=tuple(replaces),
                evidence=(evidence,),
                source=source,
                check=check,
                guard=guard,
            )
            data["pending"].append(_dump_suggestion(suggestion))
            self._write(data)
            return suggestion

    def propose_removal(self, *, scope: Scope, memory_id: str, evidence: Evidence, source: str) -> Suggestion:
        """Takes a suggestion to remove a memory, to wait for the user like any other.

        Raises:
            Refused: No such memory, or the user already declined removing it on the same evidence.
        """
        with self._lock:
            data = self._read()
            memory = next((m for m in self.store.list(scope) if m.id == memory_id), None)
            if memory is None:
                raise Refused(f"no {scope} memory named {memory_id}")
            self._check_declined(data, scope, memory.headline, evidence, remove=True)
            for i, waiting in enumerate(data["pending"]):
                if waiting.get("remove") and waiting["scope"] == scope and waiting["replaces"] == [memory_id]:
                    joined = _load_suggestion(waiting)
                    if evidence.quote not in (e.quote for e in joined.evidence):
                        joined = replace(joined, evidence=(*joined.evidence, evidence))
                        data["pending"][i] = _dump_suggestion(joined)
                        self._write(data)
                    return joined
            suggestion = Suggestion(
                id=uuid.uuid4().hex[:12],
                kind=memory.kind,
                scope=scope,
                headline=memory.headline,
                body=memory.body,
                name=memory.id,
                replaces=(memory.id,),
                evidence=(evidence,),
                source=source,
                remove=True,
            )
            data["pending"].append(_dump_suggestion(suggestion))
            self._write(data)
            return suggestion

    def pending(self) -> list[Suggestion]:
        with self._lock:
            return [_load_suggestion(s) for s in self._read()["pending"]]

    def approve(self, suggestion_id: str) -> Memory:
        """Keeps the suggestion: writes it, removes what it replaces, and returns the memory as stored. A suggestion
        to remove a memory removes it and returns it as it was.

        Raises:
            KeyError: No such pending suggestion.
            Refused: Its scope filled up since it was made.
        """
        with self._lock:
            data = self._read()
            suggestion = self._take(data, suggestion_id)
            if suggestion.remove:
                [memory_id] = suggestion.replaces
                gone = next((m for m in self.store.list(suggestion.scope) if m.id == memory_id), None)
                self.store.remove(suggestion.scope, memory_id)
                data["memories"].pop(_key(suggestion.scope, memory_id), None)
                self._write(data)
                return gone or Memory(memory_id, suggestion.kind, suggestion.scope, suggestion.headline, "")
            existing = {m.id for m in self.store.list(suggestion.scope)}
            replaced = [r for r in suggestion.replaces if r in existing]
            if len(existing) - len(replaced) + 1 > self.cap:
                raise Refused(f"{suggestion.scope} memory is full ({self.cap})")
            memory_id = replaced[0] if replaced else _unique(suggestion.name, existing)
            # A change that does not mention the check or guard of what it changes keeps them.
            before = next((m for m in self.store.list(suggestion.scope) if m.id == memory_id), None)
            check = suggestion.check or (before.check if before else None)
            guard = suggestion.guard or (before.guard if before else None)
            evidence = [e for r in replaced for e in self._notes(data, suggestion.scope, r).evidence]
            memory = self.store.put(
                Memory(
                    memory_id,
                    suggestion.kind,
                    suggestion.scope,
                    suggestion.headline,
                    suggestion.body,
                    check=check,
                    guard=guard,
                )
            )
            for other in replaced[1:]:
                self.store.remove(suggestion.scope, other)
                data["memories"].pop(_key(suggestion.scope, other), None)
            data["memories"][_key(suggestion.scope, memory_id)] = _dump_notes(
                MemoryNotes(evidence=(*evidence, *suggestion.evidence))
            )
            self._write(data)
            return memory

    def reject(self, suggestion_id: str) -> None:
        """Declines the suggestion; it is never raised again on the same evidence.

        Raises:
            KeyError: No such pending suggestion.
        """
        with self._lock:
            data = self._read()
            suggestion = self._take(data, suggestion_id)
            data["rejected"].append(
                {
                    "scope": suggestion.scope,
                    "headline": suggestion.headline,
                    "quotes": [e.quote for e in suggestion.evidence],
                    "remove": suggestion.remove,
                }
            )
            self._write(data)

    def forget(self, scope: Scope, memory_id: str) -> None:
        """Removes a memory the user deleted. The user's own action needs no suggestion."""
        with self._lock:
            data = self._read()
            self.store.remove(scope, memory_id)
            data["memories"].pop(_key(scope, memory_id), None)
            self._write(data)

    def notes(self, scope: Scope, memory_id: str) -> MemoryNotes:
        with self._lock:
            return self._notes(self._read(), scope, memory_id)

    def _check(self, kind: str, scope: Scope, headline: str) -> None:
        if kind not in self.kinds:
            raise Refused(f"kind must be one of {', '.join(self.kinds)}")
        if scope not in self.kinds[kind].scopes:
            raise Refused(f"{kind} memories may only be kept in {', '.join(sorted(self.kinds[kind].scopes))}")
        if not headline:
            raise Refused("the headline is empty")

    def _check_declined(
        self, data: dict[str, Any], scope: Scope, headline: str, evidence: Evidence, *, remove: bool
    ) -> None:
        for declined in data["rejected"]:
            if (
                declined.get("remove", False) == remove
                and declined["scope"] == scope
                and evidence.quote in declined["quotes"]
                and self.similar(declined["headline"], headline)
            ):
                raise Refused("the user already declined this suggestion; do not suggest it again")

    def _take(self, data: dict[str, Any], suggestion_id: str) -> Suggestion:
        for i, waiting in enumerate(data["pending"]):
            if waiting["id"] == suggestion_id:
                return _load_suggestion(data["pending"].pop(i))
        raise KeyError(suggestion_id)

    def _notes(self, data: dict[str, Any], scope: Scope, memory_id: str) -> MemoryNotes:
        notes = data["memories"].get(_key(scope, memory_id))
        if notes is None:
            return MemoryNotes()
        return MemoryNotes(
            evidence=tuple(_load_evidence(e) for e in notes.get("evidence", [])),
            said_again=tuple(_load_evidence(e) for e in notes.get("said_again", [])),
        )

    def _read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        return {
            "pending": data.get("pending", []),
            "rejected": data.get("rejected", []),
            "memories": data.get("memories", {}),
        }

    def _write(self, data: dict[str, Any]) -> None:
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_name(f".{self.file.name}.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.file)
        if self.on_change is not None:
            self.on_change()


def _normal(text: str) -> str:
    return re.sub(r"[\W_]+", "", text.casefold())


def _key(scope: Scope, memory_id: str) -> str:
    return f"{scope}/{memory_id}"


def _unique(name: str, taken: set[str]) -> str:
    if name not in taken:
        return name
    n = 2
    while f"{name}-{n}" in taken:
        n += 1
    return f"{name}-{n}"


def _dump_evidence(evidence: Evidence) -> dict[str, str]:
    return {"session": evidence.session, "at": evidence.at.isoformat(), "quote": evidence.quote}


def _load_evidence(data: dict[str, str]) -> Evidence:
    return Evidence(data["session"], datetime.fromisoformat(data["at"]), data["quote"])


def _dump_notes(notes: MemoryNotes) -> dict[str, Any]:
    return {
        "evidence": [_dump_evidence(e) for e in notes.evidence],
        "said_again": [_dump_evidence(e) for e in notes.said_again],
    }


def _dump_suggestion(suggestion: Suggestion) -> dict[str, Any]:
    data = asdict(suggestion)
    data["replaces"] = list(suggestion.replaces)
    data["evidence"] = [_dump_evidence(e) for e in suggestion.evidence]
    return data


def _load_suggestion(data: dict[str, Any]) -> Suggestion:
    return Suggestion(
        id=data["id"],
        kind=data["kind"],
        scope=data["scope"],
        headline=data["headline"],
        body=data["body"],
        name=data["name"],
        replaces=tuple(data["replaces"]),
        evidence=tuple(_load_evidence(e) for e in data["evidence"]),
        source=data["source"],
        remove=data.get("remove", False),
        check=Check(**data["check"]) if data.get("check") else None,
        guard=Guard(**data["guard"]) if data.get("guard") else None,
    )
