"""Profiles: which tools a session gets, chosen by its project and model.

A profile names where it applies (a project folder, a model, both, or neither) and which tools are on. A new session
takes the most specific profile that matches: project and model, then project only, then model only, then the
default profile, which always exists and matches everything. Two profiles may not claim the same place.

Kept in ``~/.alpine-code/profiles.json``. Tool names cover built-in and user tools alike.
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, replace
from pathlib import Path

from .home import home_dir
from .toolbox import BUILTIN

DEFAULT_ID = "default"


class ProfileConflict(ValueError):
    """Another profile already applies to the same project and model."""


@dataclass(frozen=True)
class Profile:
    id: str
    name: str
    """Empty for the default profile, whose name the app translates."""
    project: str | None = None
    """An absolute folder path; ``None`` for every project."""
    model: str | None = None
    """``<connection>/<model>``; ``None`` for every model."""
    tools: tuple[str, ...] = BUILTIN

    @property
    def is_default(self) -> bool:
        return self.id == DEFAULT_ID

    def matches(self, project: Path, model: str | None) -> bool:
        if self.project is not None and Path(self.project) != project:
            return False
        return self.model is None or self.model == model

    @property
    def rank(self) -> int:
        return (2 if self.project is not None else 0) + (1 if self.model is not None else 0)


class ProfileList:
    """The profiles in ``home/profiles.json``. Safe to use from several threads."""

    def __init__(self, home: Path | None = None) -> None:
        self._file = (home or home_dir()) / "profiles.json"
        self._lock = threading.Lock()

    def list(self) -> list[Profile]:
        """The default profile first, then the others in the order they were made."""
        with self._lock:
            return self._read()

    def get(self, profile_id: str) -> Profile | None:
        return next((p for p in self.list() if p.id == profile_id), None)

    def resolve(self, project: Path, model: str | None) -> Profile:
        """The profile a new session in ``project`` with ``model`` takes."""
        project = project.resolve()
        matching = [p for p in self.list() if p.matches(project, model)]
        return max(matching, key=lambda p: p.rank)  # max keeps the first of equal ranks: the default comes first

    def save(self, profile: Profile) -> Profile:
        """Adds a profile (an empty ``id`` gets a new one) or replaces the one with its id. The default profile
        keeps applying everywhere.

        Raises:
            ProfileConflict: Another profile has the same project and model.
        """
        if profile.project is not None:
            profile = replace(profile, project=str(Path(profile.project).resolve()))
        if profile.is_default:
            profile = replace(profile, name="", project=None, model=None)
        elif not profile.id:
            profile = replace(profile, id=uuid.uuid4().hex[:12])
        with self._lock:
            profiles = self._read()
            for other in profiles:
                if other.id != profile.id and (other.project, other.model) == (profile.project, profile.model):
                    raise ProfileConflict(f"{other.name or 'The default profile'} already applies there")
            index = next((i for i, p in enumerate(profiles) if p.id == profile.id), None)
            if index is None:
                profiles.append(profile)
            else:
                profiles[index] = profile
            self._write(profiles)
        return profile

    def delete(self, profile_id: str) -> None:
        """Removes a profile. The default profile cannot be removed; nothing happens."""
        if profile_id == DEFAULT_ID:
            return
        with self._lock:
            self._write([p for p in self._read() if p.id != profile_id])

    def enable(self, profile_id: str, tool: str) -> None:
        """Turns one tool on in one profile."""
        with self._lock:
            profiles = self._read()
            self._write(
                [
                    replace(p, tools=(*p.tools, tool)) if p.id == profile_id and tool not in p.tools else p
                    for p in profiles
                ]
            )

    def forget_tools(self, tools: set[str]) -> None:
        """Turns these tools off everywhere, after their file was deleted."""
        with self._lock:
            self._write([replace(p, tools=tuple(t for t in p.tools if t not in tools)) for p in self._read()])

    def _read(self) -> list[Profile]:
        try:
            data = json.loads(self._file.read_text("utf-8"))
        except (OSError, ValueError):
            data = {}
        profiles = [
            Profile(
                id=str(item["id"]),
                name=str(item.get("name", "")),
                project=item.get("project"),
                model=item.get("model"),
                tools=tuple(item.get("tools", BUILTIN)),
            )
            for item in data.get("profiles", [])
            if isinstance(item, dict) and item.get("id")
        ]
        default = next((p for p in profiles if p.is_default), Profile(DEFAULT_ID, ""))
        return [replace(default, project=None, model=None), *(p for p in profiles if not p.is_default)]

    def _write(self, profiles: list[Profile]) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "profiles": [
                {"id": p.id, "name": p.name, "project": p.project, "model": p.model, "tools": list(p.tools)}
                for p in profiles
            ]
        }
        tmp = self._file.with_name(".profiles.json.tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), "utf-8")
        tmp.replace(self._file)
