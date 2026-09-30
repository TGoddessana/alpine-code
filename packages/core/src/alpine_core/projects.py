"""The folders the user works in, for the app's rail. Sessions of a project are found by their folder.

A folder is added when the app opens it, or when a session in it sends its first message (so the CLI's folders show
up too, but not every folder the CLI was merely started in).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from .home import home_dir


@dataclass(frozen=True)
class Project:
    path: Path
    added_at: datetime
    last_used_at: datetime
    hidden: bool = False
    """Hidden from the rail; its sessions and memory stay."""

    @property
    def name(self) -> str:
        return self.path.name or str(self.path)


class ProjectList:
    """``~/.alpine-code/projects.json``."""

    def __init__(self, file: Path) -> None:
        self.file = file

    @classmethod
    def default(cls) -> ProjectList:
        return cls(home_dir() / "projects.json")

    def list(self) -> list[Project]:
        """Every project, the most recently used first."""
        return sorted(self._read().values(), key=lambda p: p.last_used_at, reverse=True)

    def open(self, folder: Path) -> Project:
        """Adds the folder, or marks it used now and shows it again if it was hidden.

        Raises:
            NotADirectoryError: The folder does not exist or is a file.
        """
        folder = folder.expanduser().resolve()
        if not folder.is_dir():
            raise NotADirectoryError(str(folder))
        projects = self._read()
        now = datetime.now(UTC)
        known = projects.get(folder)
        project = replace(known, last_used_at=now, hidden=False) if known else Project(folder, now, now)
        projects[folder] = project
        self._write(projects)
        return project

    def hide(self, folder: Path) -> None:
        """Takes the folder off the rail. Opening it again shows it again."""
        folder = folder.expanduser().resolve()
        projects = self._read()
        if folder in projects:
            projects[folder] = replace(projects[folder], hidden=True)
            self._write(projects)

    def clone_parent(self) -> Path:
        """Where a clone goes unless the user picks: next to the most recent project, else the home folder."""
        recent = self.list()
        return recent[0].path.parent if recent else Path.home()

    def _read(self) -> dict[Path, Project]:
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        projects = {}
        for entry in data.get("projects", []):
            path = Path(entry["path"])
            projects[path] = Project(
                path,
                datetime.fromisoformat(entry["added_at"]),
                datetime.fromisoformat(entry["last_used_at"]),
                entry.get("hidden", False),
            )
        return projects

    def _write(self, projects: dict[Path, Project]) -> None:
        data = {
            "projects": [
                {
                    "path": str(p.path),
                    "added_at": p.added_at.isoformat(),
                    "last_used_at": p.last_used_at.isoformat(),
                    "hidden": p.hidden,
                }
                for p in projects.values()
            ]
        }
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(self.file)
