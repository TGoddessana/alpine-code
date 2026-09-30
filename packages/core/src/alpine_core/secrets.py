"""Where saved API keys live. A port, so the macOS keychain can replace the file without touching its callers."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Protocol


class Secrets(Protocol):
    """Keys by connection name."""

    def get(self, name: str) -> str | None: ...

    def set(self, name: str, value: str) -> None: ...

    def delete(self, name: str) -> None: ...


class FileSecrets:
    """Keys in a JSON file only the user can read (``~/.alpine-code/auth.json``, mode 600).

    Plain text on disk, like opencode's and Codex's default; kept apart from ``config.toml`` so sharing settings
    never shares keys.
    """

    def __init__(self, path: Path) -> None:
        self.path = path

    def get(self, name: str) -> str | None:
        entry = self._read().get(name)
        return entry.get("api_key") if isinstance(entry, dict) else None

    def set(self, name: str, value: str) -> None:
        data = self._read()
        data[name] = {"api_key": value}
        self._write(data)

    def delete(self, name: str) -> None:
        data = self._read()
        if data.pop(name, None) is not None:
            self._write(data)

    def _read(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        return data if isinstance(data, dict) else {}

    def _write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        # Created 600 before any key is written, then swapped in, so the key is never readable by others.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, self.path)
