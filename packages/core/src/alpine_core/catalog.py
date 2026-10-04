"""Which of a connection's models the picker shows, with the models.dev catalog's families and release dates.

A router lists hundreds of models. Like OpenCode's app, the picker shows by default only the newest model of each
family released in the last six months; the user shows or hides any model by hand (``Connection.show``/``hide``).
A server the catalog does not know shows only the models chosen for it, and a server on this computer or the local
network shows everything, since the user installed those models.
"""

from __future__ import annotations

import ipaddress
import json
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Mapping
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .config import Connection
from .home import home_dir

CATALOG_URL = "https://models.dev/api.json"
#: The catalog changes when models come out, so it is fetched again after a day.
REFRESH_AFTER = 24 * 60 * 60
#: A family's newest model is shown by default only if it came out this recently.
RECENT = timedelta(days=183)

Catalog = Mapping[str, Any]
"""models.dev's ``api.json``: providers by id, each with ``api`` (its address) and ``models`` by id."""

_loaded: tuple[float, Catalog] | None = None
#: The app asks for every connection's models at once; one fetch serves them all.
_lock = threading.Lock()


def catalog_file() -> Path:
    return home_dir() / "cache" / "models.dev.json"


def load_catalog(*, timeout: float = 10) -> Catalog:
    """The catalog saved on this computer, fetched again when older than a day. A failed fetch keeps the old copy;
    with no copy at all the catalog is empty, so only chosen models show until it is fetched."""
    with _lock:
        return _load(timeout)


def _load(timeout: float) -> Catalog:
    global _loaded
    file = catalog_file()
    try:
        age = time.time() - file.stat().st_mtime
    except FileNotFoundError:
        age = None
    if age is None or age > REFRESH_AFTER:
        try:
            # models.dev refuses Python's default User-Agent.
            request = urllib.request.Request(CATALOG_URL, headers={"User-Agent": "alpine-code"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = response.read()
            json.loads(body)
            file.parent.mkdir(parents=True, exist_ok=True)
            tmp = file.with_suffix(".tmp")
            tmp.write_bytes(body)
            tmp.replace(file)
        except (OSError, urllib.error.URLError, ValueError):
            if age is None:
                return {}
    mtime = file.stat().st_mtime
    if _loaded is None or _loaded[0] != mtime:
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = {}
        _loaded = (mtime, data if isinstance(data, dict) else {})
    return _loaded[1]


def hidden_models(
    connection: Connection, models: list[str], catalog: Catalog, *, today: date | None = None
) -> list[str]:
    """The models the picker leaves out, in ``models``' order."""
    entries = _catalog_models(connection, catalog)
    if entries is None:
        shown_by_default: set[str] = set(models) if is_local(connection.url) else set()
    else:
        shown_by_default = _newest_of_each_family(models, entries, today or date.today())
    shown = (shown_by_default | set(connection.show)) - set(connection.hide)
    return [m for m in models if m not in shown]


def is_local(url: str | None) -> bool:
    """This computer or the local network: a server the user runs, not a hosted service."""
    host = urlsplit(url or "").hostname or ""
    if host == "localhost" or host.endswith((".local", ".localhost")):
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_unspecified


def _catalog_models(connection: Connection, catalog: Catalog) -> Mapping[str, Any] | None:
    """The catalog's models of the connection's provider, found by provider id or by address."""
    provider = catalog.get(connection.provider.id) if connection.provider else None
    if provider is None:
        url = _normal(connection.url)
        provider = next(
            (p for p in catalog.values() if isinstance(p, dict) and url and _normal(p.get("api")) == url), None
        )
    models = provider.get("models") if isinstance(provider, dict) else None
    return models if isinstance(models, dict) else None


def _normal(url: Any) -> str | None:
    return url.rstrip("/").lower() if isinstance(url, str) and url else None


def _newest_of_each_family(models: list[str], entries: Mapping[str, Any], today: date) -> set[str]:
    newest: dict[str, tuple[date, str]] = {}
    for model in models:
        entry = entries.get(model)
        if not isinstance(entry, dict):
            continue
        released = _date(entry.get("release_date"))
        if released is None or today - released > RECENT:
            continue
        family = entry.get("family") or model
        if family not in newest or released > newest[family][0]:
            newest[family] = (released, model)
    return {model for _, model in newest.values()}


def _date(text: Any) -> date | None:
    """``2026-09-22``, or ``2026-09`` as its first day."""
    if not isinstance(text, str):
        return None
    try:
        return date.fromisoformat(text[:10] if len(text) >= 10 else f"{text[:7]}-01")
    except ValueError:
        return None
