"""What a memory is: its kind, its scope, and the suggestion it starts as (docs/memory.md)."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

Scope = Literal["team", "project_me", "me"]
"""Team (in the repository, shared), this project · me, me · every project."""

SCOPES: tuple[Scope, ...] = ("team", "project_me", "me")


@dataclass(frozen=True)
class Kind:
    """One kind of memory. The kinds are a port: a list of these, which can grow or be replaced."""

    name: str
    guide: str
    """For whoever proposes: what belongs to this kind."""
    headline: str
    """What its index line says, so it is known without opening the file."""
    scopes: frozenset[Scope] = frozenset(SCOPES)


KINDS: tuple[Kind, ...] = (
    Kind(
        "rule",
        "how to work here: something to do or not to do, typically after the user corrected you",
        "the rule itself",
    ),
    Kind(
        "fact",
        "something about the project or its environment that the code does not say: where it is deployed, which "
        "services and accounts it uses",
        "the fact itself",
    ),
    Kind(
        "lesson",
        "a problem that cost time here and what solved it",
        'the symptom, then what to do: "bookings do not show → check the Supabase RLS policies first"',
    ),
    Kind(
        "user",
        "something about the user that changes how to work with them: how much code they know, what they care about",
        "the trait",
        frozenset({"project_me", "me"}),
    ),
)


@dataclass(frozen=True)
class Memory:
    id: str
    """Unique within its scope; the file name without ``.md`` in the default store."""
    kind: str
    scope: Scope
    headline: str
    """One line: what must be known without opening it."""
    body: str
    """The reason, examples and, for a lesson, what happened."""
    path: Path | None = None
    """Where the store keeps it, when it is a file."""


@dataclass(frozen=True)
class Evidence:
    """Where a suggestion came from, as the harness saw it (never the model's claim)."""

    session: str
    at: datetime
    quote: str
    """The user's last message when the suggestion was made."""


@dataclass(frozen=True)
class Suggestion:
    id: str
    kind: str
    scope: Scope
    headline: str
    body: str
    name: str
    """The file name it asks for; the store keeps names unique."""
    replaces: tuple[str, ...]
    """Memories of the same scope it changes, merges or removes."""
    evidence: tuple[Evidence, ...]
    source: str
    """Which proposer made it ("agent", "missing_paths", ...), so the app can say who and why."""
    remove: bool = False
    """It removes the one memory in ``replaces``; ``headline`` and ``body`` are that memory's."""


_NAME = re.compile(r"[a-z0-9][a-z0-9-]{0,63}")


def file_name(name: str) -> str:
    """A safe memory name: lowercase letters, digits and dashes. Other text (Korean, spaces) becomes dashes, and
    a name left empty becomes ``memory``."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64].strip("-")
    return slug if _NAME.fullmatch(slug) else "memory"


def project_key(project: Path) -> str:
    """The folder name for a project's own data under the home folder: readable, and unique per path."""
    path = str(project.expanduser().resolve())
    return f"{file_name(Path(path).name)}-{hashlib.sha256(path.encode()).hexdigest()[:8]}"
