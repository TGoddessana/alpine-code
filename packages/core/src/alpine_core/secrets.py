"""Where saved API keys and sign-ins live. Ports, so the macOS keychain can replace the file without touching its
callers."""

from __future__ import annotations

import fcntl
import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Protocol


class Secrets(Protocol):
    """Keys by connection name."""

    def get(self, name: str) -> str | None: ...

    def set(self, name: str, value: str) -> None: ...

    def delete(self, name: str) -> None: ...


class OAuthTokens(Protocol):
    """Sign-ins by connection name: a JSON object per connection (a ChatGPT sign-in's tokens and account)."""

    def get_oauth(self, name: str) -> dict[str, Any] | None: ...

    def set_oauth(self, name: str, record: dict[str, Any]) -> None: ...

    def locked(self) -> Iterator[None]:
        """A context manager held across read, refresh and write. It must also keep other processes out: the CLI
        and the app refresh the same rotating token, and the second one to use it loses the sign-in."""
        ...


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

    def get_oauth(self, name: str) -> dict[str, Any] | None:
        entry = self._read().get(name)
        record = entry.get("oauth") if isinstance(entry, dict) else None
        return record if isinstance(record, dict) else None

    def set_oauth(self, name: str, record: dict[str, Any]) -> None:
        data = self._read()
        data[name] = {"oauth": record}
        self._write(data)

    @contextmanager
    def locked(self) -> Iterator[None]:
        """An exclusive ``flock`` on ``auth.json.lock``, which also blocks other threads (each opens its own file)."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path.with_name(self.path.name + ".lock"), os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            os.close(fd)  # closing releases the lock

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
