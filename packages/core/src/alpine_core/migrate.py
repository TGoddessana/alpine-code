"""Moves a project's files from where older versions kept them. Delete this module once no one runs 0.1.x.

- ``<project>/.alpine/{map,memory,skills}`` → ``<project>/.alpine-code/`` (the folder was renamed);
- ``<home>/product-map/<sha256 of the path>/`` → ``<home>/projects/<project>/product-map/`` (one folder per project).

Nothing is ever overwritten or merged: when the new place already exists, the old one is left as it is. A link is
never moved. Running it again does nothing.
"""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from .home import home_dir
from .memory.model import project_key

log = logging.getLogger(__name__)

_OLD_FOLDERS = ("map", "memory", "skills")


def migrate_projects(home: Path | None = None) -> None:
    """Moves the old files of every listed project; the server does this when it starts."""
    from .projects import ProjectList

    home = home or home_dir()
    try:
        projects = ProjectList(home / "projects.json").list()
    except (OSError, ValueError) as e:  # an unreadable list must not keep the app from starting
        log.warning("Could not read the projects to move their old files: %s", e)
        return
    for project in projects:
        migrate_project(project.path, home)


def migrate_project(folder: Path, home: Path | None = None) -> None:
    """Moves one project's old files. A failure is logged and left for the next time."""
    folder = folder.expanduser().resolve()
    home = home or home_dir()
    try:
        _move_project_folder(folder)
        _move_local_map(folder, home)
    except OSError as e:
        log.warning("Could not move the old files of %s: %s", folder, e)


def _move_project_folder(folder: Path) -> None:
    old = folder / ".alpine"
    if old.is_symlink() or not old.is_dir():
        return
    new = folder / ".alpine-code"
    if new.is_symlink() or (new.exists() and not new.is_dir()):
        return
    # Only Alpine's own folders: another tool may use a folder named .alpine too.
    for name in _OLD_FOLDERS:
        source, target = old / name, new / name
        if source.is_dir() and not source.is_symlink() and not target.exists():
            new.mkdir(exist_ok=True)
            source.rename(target)
    if not any(old.iterdir()):
        old.rmdir()


def _move_local_map(folder: Path, home: Path) -> None:
    root = home / "product-map"
    old = root / hashlib.sha256(str(folder).encode()).hexdigest()
    if old.is_symlink() or not old.is_dir():
        return
    target = home / "projects" / project_key(folder) / "product-map"
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        old.rename(target)
    if not any(root.iterdir()):
        root.rmdir()
