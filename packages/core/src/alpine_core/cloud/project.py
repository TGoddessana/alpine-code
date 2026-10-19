"""A project's ``.alpine-code/cloud.toml``: how Alpine Cloud publishes it (decision 22). Everything else in the
folder is the project's own business."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import tomllib


@dataclass(frozen=True)
class CloudDescription:
    version: int
    kind: str
    """The template kind: ``web-lite``, ``web-pro``, ``blank``..."""
    adapter: str | None
    """How the project builds for Alpine Cloud (``cloudflare-workers``); ``None`` when it is not published."""
    database_kind: str | None = None
    migrations: str | None = None


def cloud_toml(project: Path) -> Path:
    return project / ".alpine-code" / "cloud.toml"


def read_description(project: Path) -> CloudDescription | None:
    """The project's description, or ``None`` when it has none or it cannot be read."""
    try:
        data = tomllib.loads(cloud_toml(project).read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None
    database = data.get("database") if isinstance(data.get("database"), dict) else {}
    adapter = data.get("adapter")
    return CloudDescription(
        version=data.get("version") if isinstance(data.get("version"), int) else 1,
        kind=str(data.get("kind") or "blank"),
        adapter=adapter if isinstance(adapter, str) and adapter else None,
        database_kind=database.get("kind") if isinstance(database.get("kind"), str) else None,
        migrations=database.get("migrations") if isinstance(database.get("migrations"), str) else None,
    )
