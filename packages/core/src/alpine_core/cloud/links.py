"""Which Alpine app a project publishes to: ``~/.alpine-code/cloud/apps.json``.

One entry per project folder: the app id (and the API address that app lives at, so a local test app is never taken
for a production one), the source of the last publish (``git`` commit and tree, to count unpublished changes), and
whether the first-live-read notice was shown. The file is read and written whole under a lock, atomically.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..home import home_dir
from . import settings

_lock = threading.Lock()


@dataclass(frozen=True)
class Published:
    """The source of the last publish: ``git rev-parse HEAD`` and a tree of the working files."""

    commit: str
    tree: str
    at: str | None = None


@dataclass(frozen=True)
class Link:
    app_id: str
    api_url: str
    published: Published | None = None
    live_read_notice: bool = False
    """The first-live-read notice (``live_data_first_read``) was shown for this project."""


def links_file() -> Path:
    return home_dir() / "cloud" / "apps.json"


def get(project: Path | str) -> Link | None:
    """The link of ``project`` for the current API address, or ``None``."""
    entry = _read().get(_key(project))
    link = _link(entry) if isinstance(entry, dict) else None
    return link if link is not None and link.api_url == settings.api_url() else None


def link(project: Path | str, app_id: str) -> Link:
    """Links ``project`` to the app. A project linked to another app starts over (nothing was published to this one)."""
    with _lock:
        data = _read()
        current = _link(data.get(_key(project)) or {})
        if current is not None and current.app_id == app_id and current.api_url == settings.api_url():
            return current
        fresh = Link(app_id, settings.api_url())
        data[_key(project)] = _entry(fresh)
        _write(data)
        return fresh


def unlink(project: Path | str) -> None:
    with _lock:
        data = _read()
        if data.pop(_key(project), None) is not None:
            _write(data)


def record_published(project: Path | str, published: Published) -> None:
    _update(project, published=published)


def mark_live_read_notice(project: Path | str) -> bool:
    """Notes that the first-live-read notice was shown. ``True`` for the call that noted it, ``False`` when it was
    already there: the notice is shown once per project."""
    return _update(project, live_read_notice=True)


def _update(project: Path | str, **changes: Any) -> bool:
    with _lock:
        data = _read()
        current = _link(data.get(_key(project)) or {})
        if current is None or current.api_url != settings.api_url():
            return False
        updated = Link(
            current.app_id,
            current.api_url,
            changes.get("published", current.published),
            changes.get("live_read_notice", current.live_read_notice),
        )
        if updated == current:
            return False
        data[_key(project)] = _entry(updated)
        _write(data)
        return True


def _key(project: Path | str) -> str:
    return str(Path(project).expanduser().resolve())


def _entry(value: Link) -> dict[str, Any]:
    entry: dict[str, Any] = {"app_id": value.app_id, "api_url": value.api_url}
    if value.published is not None:
        entry["published"] = {"commit": value.published.commit, "tree": value.published.tree, "at": value.published.at}
    if value.live_read_notice:
        entry["live_read_notice"] = True
    return entry


def _link(entry: dict[str, Any]) -> Link | None:
    app_id, api_url = entry.get("app_id"), entry.get("api_url")
    if not isinstance(app_id, str) or not isinstance(api_url, str):
        return None
    published = entry.get("published")
    if (
        isinstance(published, dict)
        and isinstance(published.get("commit"), str)
        and isinstance(published.get("tree"), str)
    ):
        at = published.get("at")
        published = Published(published["commit"], published["tree"], at if isinstance(at, str) else None)
    else:
        published = None
    return Link(app_id, api_url, published, bool(entry.get("live_read_notice")))


def _read() -> dict[str, Any]:
    try:
        data = json.loads(links_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    projects = data.get("projects") if isinstance(data, dict) else None
    return projects if isinstance(projects, dict) else {}


def _write(projects: dict[str, Any]) -> None:
    file = links_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(json.dumps({"projects": projects}, indent=2), encoding="utf-8")
    os.replace(tmp, file)
