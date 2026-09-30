"""Settings, from (lowest to highest priority) the config file, the environment, and explicit overrides.

Config file: ``~/.alpine-code/config.toml`` (see ``home_dir``)::

    default_model = "anthropic/claude-sonnet-5"   # <connection>/<model>
    # mode = "default"                             # default | accept_edits | yolo
    # context_window = 128000

    [connections.anthropic]
    provider = "anthropic"                         # a provider from providers.py

    [connections.local]
    base_url = "http://localhost:11434/v1"         # any OpenAI-compatible server

Keys are not in this file: a connection's key comes from its provider's environment variable
(``ANTHROPIC_API_KEY``...) or from ``auth.json`` (``secrets.py``).

Environment: ``ALPINE_MODEL`` overrides ``default_model``. ``ALPINE_BASE_URL``, ``ALPINE_API_KEY`` and
``ALPINE_CONTEXT_WINDOW`` point at a one-off OpenAI-compatible server that is not a connection (scripts, benchmarks).
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field, fields, replace
from pathlib import Path
from typing import Any

import tomlkit
import tomllib

from .home import home_dir
from .permissions import Mode
from .providers import PROVIDERS, Api, Billing, Provider
from .secrets import FileSecrets, Secrets

_ENV = {
    "model": "ALPINE_MODEL",
    "base_url": "ALPINE_BASE_URL",
    "api_key": "ALPINE_API_KEY",
    "context_window": "ALPINE_CONTEXT_WINDOW",
}

#: Keys of config.toml -> Settings fields.
_FILE_KEYS = {"default_model": "model", "mode": "mode", "context_window": "context_window"}

_CONNECTION_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")


class ConfigError(Exception):
    """The settings are missing or invalid. The message says how to fix it."""


def config_file() -> Path:
    return home_dir() / "config.toml"


@dataclass(frozen=True)
class Connection:
    """A place models come from: a provider, or the address of an OpenAI-compatible server."""

    name: str
    provider: Provider | None = None
    base_url: str | None = None
    """Overrides the provider's address; the whole address for a local or compatible server."""

    @property
    def url(self) -> str | None:
        return self.base_url or (self.provider.base_url if self.provider else None)

    @property
    def api(self) -> Api:
        return self.provider.api if self.provider else Api.OPENAI

    @property
    def billing(self) -> Billing:
        return self.provider.billing if self.provider else Billing.NONE


@dataclass(frozen=True)
class Settings:
    model: str | None = None
    """``<connection>/<model>``; also ``anthropic/``, ``openai/`` or ``ollama/`` with the provider's usual key."""
    base_url: str | None = None
    """A one-off OpenAI-compatible server. When set, ``model`` is that server's model name."""
    api_key: str | None = None
    """The key for ``base_url``."""
    context_window: int | None = None
    mode: Mode = Mode.DEFAULT
    connections: Mapping[str, Connection] = field(default_factory=dict)
    secrets: Secrets | None = field(default=None, compare=False, repr=False)

    @classmethod
    def load(cls, *, secrets: Secrets | None = None, **overrides: Any) -> Settings:
        """Reads the config file and the environment, then applies ``overrides`` that are not ``None``.

        ``secrets`` defaults to ``auth.json`` in the home folder.
        """
        file = config_file()
        data = _read(file)
        values: dict[str, Any] = {}
        unknown = sorted(set(data) - set(_FILE_KEYS) - {"connections"})
        if unknown:
            raise ConfigError(f"Unknown settings in {file}: {', '.join(unknown)}")
        for key, name in _FILE_KEYS.items():
            if key in data:
                values[name] = data[key]
        values["connections"] = _connections(data.get("connections", {}), file)
        for key, env in _ENV.items():
            if os.environ.get(env):
                values[key] = os.environ[env]
        values.update({k: v for k, v in overrides.items() if v is not None})

        known = {f.name for f in fields(cls)}
        unknown = sorted(set(values) - known)
        if unknown:
            raise ConfigError(f"Unknown settings: {', '.join(unknown)}")
        if values.get("context_window") is not None:
            try:
                values["context_window"] = int(values["context_window"])
            except ValueError as e:
                raise ConfigError(f"context_window must be an integer (got {values['context_window']!r})") from e
        try:
            values["mode"] = Mode(values.get("mode", Mode.DEFAULT))
        except ValueError as e:
            raise ConfigError(f"mode must be one of: {', '.join(Mode)}") from e
        values["secrets"] = secrets if secrets is not None else FileSecrets(home_dir() / "auth.json")
        return cls(**values)

    def with_model(self, model: str) -> Settings:
        return replace(self, model=model)

    def api_key_for(self, connection: Connection) -> str | None:
        """The provider's environment variable, else the saved key."""
        if connection.provider and os.environ.get(connection.provider.key_env):
            return os.environ[connection.provider.key_env]
        return self.secrets.get(connection.name) if self.secrets else None


def save_connection(name: str, *, provider: str | None = None, base_url: str | None = None) -> Connection:
    """Adds the connection to config.toml, or replaces the one with that name. Comments in the file are kept."""
    if not _CONNECTION_NAME.fullmatch(name):
        raise ConfigError(f"Connection names use letters, digits, '.', '_' and '-' (got {name!r})")
    table = tomlkit.table()
    if provider is not None:
        table["provider"] = provider
    if base_url is not None:
        table["base_url"] = base_url
    connection = _connection(name, table, config_file())
    doc = _edit()
    doc.setdefault("connections", tomlkit.table(is_super_table=True))[name] = table
    _save(doc)
    return connection


def set_default_model(model: str) -> None:
    doc = _edit()
    doc["default_model"] = model
    _save(doc)


def _read(file: Path) -> dict[str, Any]:
    if not file.is_file():
        return {}
    try:
        return tomllib.loads(file.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{file} is not valid TOML: {e}") from e


def _connections(tables: Any, file: Path) -> dict[str, Connection]:
    if not isinstance(tables, dict):
        raise ConfigError(f"'connections' in {file} must be a table: [connections.<name>]")
    return {name: _connection(name, table, file) for name, table in tables.items()}


def _connection(name: str, table: Mapping[str, Any], file: Path) -> Connection:
    where = f"[connections.{name}] in {file}"
    unknown = sorted(set(table) - {"provider", "base_url"})
    if unknown:
        raise ConfigError(f"Unknown settings in {where}: {', '.join(unknown)}")
    provider_id, base_url = table.get("provider"), table.get("base_url")
    if provider_id is None and base_url is None:
        raise ConfigError(f"{where} needs a provider or a base_url")
    provider = None
    if provider_id is not None:
        provider = PROVIDERS.get(provider_id)
        if provider is None:
            raise ConfigError(f"Unknown provider {provider_id!r} in {where}. Known: {', '.join(PROVIDERS)}")
    return Connection(name, provider, base_url)


def _edit() -> tomlkit.TOMLDocument:
    file = config_file()
    _read(file)  # refuse to rewrite a file that does not parse
    return tomlkit.parse(file.read_text(encoding="utf-8")) if file.is_file() else tomlkit.document()


def _save(doc: tomlkit.TOMLDocument) -> None:
    file = config_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(".tmp")
    tmp.write_text(tomlkit.dumps(doc), encoding="utf-8")
    tmp.replace(file)
