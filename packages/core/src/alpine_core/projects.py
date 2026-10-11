"""The folders the user works in, for the app's rail. Sessions of a project are found by their folder.

A folder is added when the app opens it, or when a session in it sends its first message (so the CLI's folders show
up too, but not every folder the CLI was merely started in).
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path

from .home import home_dir
from .memory.model import project_key


@dataclass(frozen=True)
class Project:
    path: Path
    added_at: datetime
    last_used_at: datetime
    archived: bool = False
    """Off the rail; its sessions and memory stay."""
    last_agent: str | None = None
    """The id of the agent last put to work here; a new session in the project starts with it."""

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
        """Adds the folder, or marks it used now and brings it back if it was archived.

        Raises:
            NotADirectoryError: The folder does not exist or is a file.
        """
        folder = folder.expanduser().resolve()
        if not folder.is_dir():
            raise NotADirectoryError(str(folder))
        projects = self._read()
        now = datetime.now(UTC)
        known = projects.get(folder)
        project = replace(known, last_used_at=now, archived=False) if known else Project(folder, now, now)
        projects[folder] = project
        self._write(projects)
        return project

    def get(self, folder: Path) -> Project | None:
        return self._read().get(folder.expanduser().resolve())

    def set_agent(self, folder: Path, agent_id: str | None) -> None:
        """Remembers the agent last used in the folder. Does nothing for a folder that is not a project."""
        folder = folder.expanduser().resolve()
        projects = self._read()
        if folder in projects:
            projects[folder] = replace(projects[folder], last_agent=agent_id)
            self._write(projects)

    def archive(self, folder: Path) -> None:
        """Takes the folder off the rail. Opening it again brings it back."""
        folder = folder.expanduser().resolve()
        projects = self._read()
        if folder in projects:
            projects[folder] = replace(projects[folder], archived=True)
            self._write(projects)

    def delete(self, folder: Path) -> None:
        """Forgets the folder. Never touches the folder itself; opening it again starts it afresh.

        The user's own memory of the project and its suggestions (``<home>/projects/<project>/``) go with it. Team
        memory is in the folder (``.alpine/memory``), so it stays, and so do the sessions, until the core can tell
        a project's sessions apart from the rest.
        """
        folder = folder.expanduser().resolve()
        projects = self._read()
        if projects.pop(folder, None):
            self._write(projects)
        shutil.rmtree(self.file.parent / "projects" / project_key(folder), ignore_errors=True)

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
                entry.get("archived", False),
                entry.get("last_agent"),
            )
        return projects

    def _write(self, projects: dict[Path, Project]) -> None:
        data = {
            "projects": [
                {
                    "path": str(p.path),
                    "added_at": p.added_at.isoformat(),
                    "last_used_at": p.last_used_at.isoformat(),
                    "archived": p.archived,
                    "last_agent": p.last_agent,
                }
                for p in projects.values()
            ]
        }
        self.file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.file.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(self.file)
