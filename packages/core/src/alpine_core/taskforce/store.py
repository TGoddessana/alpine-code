"""Where a session's TF runs are kept: ``<root>/<session id>/<run id>.json``, deleted with the session (decision 8).

A record holds what the screens and a rerun need: the proposal (title, plan, minutes, script), how far it got and the
answers of the finished agents, by the key of what was asked."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any


class RunStore:
    def __init__(self, root: str | os.PathLike[str]) -> None:
        self._root = Path(root)

    def save(self, session_id: str, run_id: str, record: dict[str, Any]) -> None:
        folder = self._folder(session_id)
        folder.mkdir(parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=f".{run_id}.", dir=folder)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(record, file, ensure_ascii=False)
        os.replace(name, folder / f"{_safe(run_id)}.json")

    def load(self, session_id: str, run_id: str) -> dict[str, Any] | None:
        try:
            data = json.loads((self._folder(session_id) / f"{_safe(run_id)}.json").read_text("utf-8"))
        except (OSError, ValueError):
            return None
        return data if isinstance(data, dict) else None

    def list(self, session_id: str) -> list[dict[str, Any]]:
        """The session's runs, oldest first."""
        folder = self._folder(session_id)
        if not folder.is_dir():
            return []
        records = []
        for file in sorted(folder.glob("*.json"), key=lambda f: f.stat().st_mtime):
            try:
                data = json.loads(file.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(data, dict):
                records.append(data)
        return records

    def delete(self, session_id: str) -> None:
        shutil.rmtree(self._folder(session_id), ignore_errors=True)

    def _folder(self, session_id: str) -> Path:
        return self._root / _safe(session_id)


def _safe(name: str) -> str:
    if not name or name.startswith(".") or "/" in name or "\\" in name or "\0" in name:
        raise ValueError(f"not a valid id: {name!r}")
    return name
