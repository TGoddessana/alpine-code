"""Conversations from Claude Code and Codex, carried over to continue here.

``find_external_sessions(project)`` lists the conversations either app had in a project folder (or a folder inside
it); ``import_session`` saves one as a session of this app, the same way a session saves itself, so
``Session.resume`` opens it and the next message goes on from where the other app stopped. The model gets the
conversation with its tool calls and results as they were; thinking and anything encrypted for the other app's model
stays behind. The other app's files are only read.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from alpineagents import State

from ..items import item_to_dict
from ..storage import SessionInfo, Storage
from . import claude_code, codex
from ._transcript import SOURCE_NAMES, Transcript, model_messages, screen_items

__all__ = ["ExternalSession", "ImportSource", "SOURCE_NAMES", "find_external_sessions", "import_session"]

ImportSource = Literal["claude_code", "codex"]

_TITLE_LENGTH = 60


@dataclass(frozen=True)
class ExternalSession:
    """One conversation another app has on disk."""

    source: ImportSource
    id: str
    """The other app's id for it."""
    path: Path
    cwd: str
    """The folder it was started in."""
    title: str
    updated_at: str
    """UTC, ISO 8601: when its file last changed."""


def find_external_sessions(
    project: Path, *, claude_projects: Path | None = None, codex_root: Path | None = None
) -> list[ExternalSession]:
    """The conversations Claude Code and Codex had in ``project`` or a folder inside it, most recently changed first.
    ``claude_projects`` and ``codex_root`` replace where the apps keep them (``~/.claude/projects``, ``~/.codex``)."""
    project = project.resolve()
    found = [
        *_claude_code(project, claude_projects or claude_code.projects_dir()),
        *_codex(project, codex_root or codex.codex_home()),
    ]
    found.sort(key=lambda session: session.updated_at, reverse=True)
    return found


def import_session(
    storage: Storage, external: ExternalSession, project: Path, *, model: str, mode: str, agent: str | None = None
) -> SessionInfo:
    """Saves ``external`` as a new session of ``project`` and returns its info; open it with ``Session.resume``.

    Raises:
        ValueError: The conversation has nothing to carry over.
    """
    transcript = read(external)
    messages = model_messages(transcript, external.source)
    if not any(m.role == "assistant" for m in messages):
        raise ValueError(f"nothing to carry over from {external.path}")
    items = screen_items(transcript, external.source)
    session_id = uuid.uuid4().hex
    now = _now()
    info = SessionInfo(
        id=session_id,
        title=external.title,
        cwd=str(project.resolve()),
        model=model,
        mode=mode,
        created_at=now,
        updated_at=now,
        agent=agent,
        last_seq=len(items),
        imported_from={"source": external.source, "id": external.id, "updated_at": external.updated_at},
    )
    storage.states.save(State(id=session_id, messages=messages))
    try:
        storage.log.create(info)
        storage.log.append(session_id, [(seq, item_to_dict(item)) for seq, item in enumerate(items, start=1)])
    except BaseException:
        storage.log.delete(session_id)
        storage.states.delete(session_id)
        raise
    return info


def read(external: ExternalSession) -> Transcript:
    return claude_code.read(external.path) if external.source == "claude_code" else codex.read(external.path)


def _claude_code(project: Path, root: Path) -> list[ExternalSession]:
    found = []
    for folder in claude_code.folders_for(project, root):
        for path in folder.glob("*.jsonl"):
            try:
                summary = claude_code.summary(path)
            except OSError:
                continue
            if summary is None:
                continue
            cwd, title, first = summary
            if not _inside(cwd, project):
                continue
            found.append(ExternalSession("claude_code", path.stem, path, cwd, title or _title(first), _mtime(path)))
    return found


def _codex(project: Path, home: Path) -> list[ExternalSession]:
    latest: dict[str, ExternalSession] = {}
    names: dict[str, str] | None = None
    for path in codex.files(home):
        meta = codex.meta(path)
        if meta is None or not isinstance(meta.get("source", "cli"), str):  # an object: a subagent's thread
            continue
        thread, cwd = meta.get("id"), meta.get("cwd")
        if not isinstance(thread, str) or not isinstance(cwd, str) or not _inside(cwd, project):
            continue
        updated = _mtime(path)
        if thread in latest and latest[thread].updated_at >= updated:  # a reverted thread has older files
            continue
        if names is None:
            names = codex.titles(home)
        title = names.get(thread, "")
        if not title:
            try:
                title = _title(codex.first_message(path))
            except OSError:
                continue
            if not title:
                continue
        latest[thread] = ExternalSession("codex", thread, path, cwd, title, updated)
    return list(latest.values())


def _inside(cwd: str, project: Path) -> bool:
    if not cwd:
        return False
    try:
        return Path(cwd).resolve().is_relative_to(project)
    except (OSError, ValueError):
        return False


def _mtime(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(timespec="milliseconds")


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def _title(text: str) -> str:
    line = " ".join(text.split())
    return line if len(line) <= _TITLE_LENGTH else line[: _TITLE_LENGTH - 1].rstrip() + "…"
