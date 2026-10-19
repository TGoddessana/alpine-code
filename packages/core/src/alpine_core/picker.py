"""The models the model picker shows, per connection: what the connection lists (``models.list_models``) less what the
picker leaves out (``catalog.hidden_models``: at first each family's newest, then what the user switched on or off in
모델 관리). The server's picker and the TF tool's description (``taskforce/team.py``) use the same lists.

A connection's list is read once and kept while the app runs: the picker keeps what it read (``keep``), and
``fetch_missing`` reads, in the background, the lists nobody has read yet. Which models are hidden is worked out each
time from the settings, so switching a model on or off counts at once.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable

from .catalog import Catalog, hidden_models
from .chatgpt import is_chatgpt
from .config import Connection, Settings
from .models import chatgpt_tokens, list_models

#: How long a connection whose list could not be read is left alone before it is tried again.
RETRY_AFTER = 300.0

_lock = threading.Lock()
_listed: dict[tuple[str, str | None], list[str]] = {}
_failed: dict[tuple[str, str | None], float] = {}
_reading: set[tuple[str, str | None]] = set()


def _key(connection: Connection) -> tuple[str, str | None]:
    return connection.name, connection.url


def keep(connection: Connection, models: list[str]) -> None:
    """Keeps what ``list_models`` said for the saved connection."""
    with _lock:
        _listed[_key(connection)] = list(models)
        _failed.pop(_key(connection), None)


def listed(connection: Connection) -> list[str] | None:
    """The connection's models as last read; ``None`` when they were not read while the app runs."""
    with _lock:
        models = _listed.get(_key(connection))
    return list(models) if models is not None else None


def shown(connection: Connection, models: list[str], catalog: Catalog) -> list[str]:
    """The ones of ``models`` the picker shows. A ChatGPT connection lists a handful, all shown."""
    if is_chatgpt(connection):
        return list(models)
    hidden = set(hidden_models(connection, models, catalog))
    return [m for m in models if m not in hidden]


def read(settings: Settings, connection: Connection, *, timeout: float = 15) -> list[str]:
    """Reads the connection's list now and keeps it.

    Raises:
        ModelListError: The list could not be read.
        ConfigError: A ChatGPT connection without its sign-in.
    """
    tokens = chatgpt_tokens(settings, connection) if is_chatgpt(connection) else None
    key = None if tokens else settings.api_key_for(connection)
    models = list_models(connection, key, tokens=tokens, timeout=timeout)
    keep(connection, models)
    return models


def fetch_missing(settings: Settings, done: Callable[[], None] | None = None) -> bool:
    """Reads, each in a thread of its own, the lists of the connections not read yet (one that failed is tried again
    after ``RETRY_AFTER``); ``done`` is called after each one read. ``True`` when one was started."""
    now = time.monotonic()
    wanted = []
    with _lock:
        for connection in settings.connections.values():
            key = _key(connection)
            if key in _listed or key in _reading or now - _failed.get(key, -RETRY_AFTER) < RETRY_AFTER:
                continue
            _reading.add(key)
            wanted.append(connection)

    def go(connection: Connection) -> None:
        try:
            read(settings, connection)
        except Exception:  # unreachable, no key, signed out: the description falls back
            with _lock:
                _failed[_key(connection)] = time.monotonic()
            return
        finally:
            with _lock:
                _reading.discard(_key(connection))
        if done is not None:
            done()

    for connection in wanted:
        threading.Thread(target=go, args=(connection,), daemon=True, name=f"models-{connection.name}").start()
    return bool(wanted)


def forget() -> None:
    """Drops every kept list (tests)."""
    with _lock:
        _listed.clear()
        _failed.clear()
        _reading.clear()
