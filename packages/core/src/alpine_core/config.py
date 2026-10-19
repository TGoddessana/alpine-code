"""Settings, from (lowest to highest priority) the config file, the environment, and explicit overrides.

Config file: ``~/.alpine-code/config.toml`` (see ``home_dir``)::

    default_model = "anthropic/claude-sonnet-5"   # <connection>/<model>
    # mode = "default"                             # default | accept_edits | auto | yolo
    # review_model = "openrouter/qwen3"           # auto mode's reviewer; unset: the session's model
    # clone_folder = "~/Developments"              # where the app puts repositories; unset: ~/AlpineCode
    # output_limit = 64000                         # most tokens one reply may write; unset: models.py picks

    [connections.anthropic]
    provider = "anthropic"                         # a provider from providers.py

    [connections.local]
    base_url = "http://localhost:11434/v1"         # any OpenAI-compatible server
    # show = ["qwen3"]                             # models the picker shows or hides besides its defaults
    # hide = ["qwen3-4b"]                          # (catalog.py)

    # [connections.local.models."qwen3"]          # one model's settings
    # context_window = 131072                      # tokens it reads at once; unset: what the server or the
    #                                              # models.dev catalog says (context.py)

Keys are not in this file: a connection's key comes from its provider's environment variable
(``ANTHROPIC_API_KEY``...) or from ``auth.json`` (``secrets.py``).

Environment: ``ALPINE_MODEL`` overrides ``default_model``. ``ALPINE_BASE_URL``, ``ALPINE_API_KEY`` and
``ALPINE_CONTEXT_WINDOW`` point at a one-off OpenAI-compatible server that is not a connection (scripts, benchmarks);
the window is that server's model's.
``ALPINE_OUTPUT_LIMIT`` overrides ``output_limit``.
"""

from __future__ import annotations

import functools
import os
import re
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, fields, replace
from pathlib import Path
from typing import Any

import tomlkit
import tomllib

from .cloning import default_clone_folder
from .home import home_dir
from .permissions import Mode
from .providers import PROVIDERS, Api, Billing, Provider
from .secrets import FileSecrets, Secrets

#: Settings fields -> the environment variables that override them.
_ENV = {
    "model": "ALPINE_MODEL",
    "base_url": "ALPINE_BASE_URL",
    "api_key": "ALPINE_API_KEY",
    "context_window": "ALPINE_CONTEXT_WINDOW",
    "output_limit": "ALPINE_OUTPUT_LIMIT",
}

#: Keys of config.toml -> Settings fields.
_FILE_KEYS = {
    "default_model": "model",
    "mode": "mode",
    "review_model": "review_model",
    "clone_folder": "clone_folder",
    "output_limit": "output_limit",
}

#: Keys of config.toml that are gone -> how to say the same now.
_MOVED_KEYS = {
    "context_window": 'context_window is set per model now: [connections.<name>.models."<model>"] context_window = ...',
}

_CONNECTION_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")

#: The server runs requests on threads; each change reads config.toml and writes it back whole.
_writing = threading.Lock()


def _locked[**P, R](change: Callable[P, R]) -> Callable[P, R]:
    @functools.wraps(change)
    def locked(*args: P.args, **kwargs: P.kwargs) -> R:
        with _writing:
            return change(*args, **kwargs)

    return locked


class ConfigError(Exception):
    """The settings are missing or invalid. The message says how to fix it."""


def config_file() -> Path:
    return home_dir() / "config.toml"


@dataclass(frozen=True)
class ModelSettings:
    """What the user wrote for one of a connection's models."""

    context_window: int | None = None
    """Tokens the model reads at once; ``None``: the server or the catalog says (``context.py``)."""


@dataclass(frozen=True)
class Connection:
    """A place models come from: a provider, or the address of an OpenAI-compatible server."""

    name: str
    provider: Provider | None = None
    base_url: str | None = None
    """Overrides the provider's address; the whole address for a local or compatible server."""
    show: tuple[str, ...] = ()
    """Models the picker shows although they are not shown by default (``catalog.py``)."""
    hide: tuple[str, ...] = ()
    """Models the picker leaves out although they are shown by default."""
    models: Mapping[str, ModelSettings] = field(default_factory=dict)
    """Settings of single models, by model id: ``[connections.<name>.models."<model>"]``."""

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
    """The window of ``base_url``'s model (``ALPINE_CONTEXT_WINDOW``); a connection's models set theirs per model."""
    output_limit: int | None = None
    """Most tokens one reply may write; ``None``: ``make_model`` picks for the model."""
    mode: Mode = Mode.DEFAULT
    review_model: str | None = None
    """``<connection>/<model>`` of auto mode's reviewer; ``None``: the session's model."""
    clone_folder: Path = field(default_factory=default_clone_folder)
    """Where the app puts the repositories it clones."""
    connections: Mapping[str, Connection] = field(default_factory=dict)
    secrets: Secrets | None = field(default=None, compare=False, repr=False)

    @classmethod
    def load(cls, *, secrets: Secrets | None = None, **overrides: Any) -> Settings:
        """Reads the config file and the environment, then applies ``overrides`` that are not ``None``.

        ``secrets`` defaults to ``auth.json`` in the home folder.
        """
        values = _from_file(config_file())
        values.update({key: os.environ[env] for key, env in _ENV.items() if os.environ.get(env)})
        values.update({key: value for key, value in overrides.items() if value is not None})
        unknown = sorted(set(values) - {f.name for f in fields(cls)})
        if unknown:
            raise ConfigError(f"Unknown settings: {', '.join(unknown)}")
        _convert(values)
        values["secrets"] = secrets if secrets is not None else FileSecrets(home_dir() / "auth.json")
        return cls(**values)

    def with_model(self, model: str) -> Settings:
        return replace(self, model=model)

    def api_key_for(self, connection: Connection) -> str | None:
        """The provider's environment variable, else the saved key."""
        env = connection.provider.key_env if connection.provider else None
        if env and os.environ.get(env):
            return os.environ[env]
        return self.secrets.get(connection.name) if self.secrets else None


@_locked
def save_connection(
    name: str, *, provider: str | None = None, base_url: str | None = None, model: str | None = None
) -> Connection:
    """Adds the connection to config.toml, or replaces the one with that name and keeps which models it shows.
    ``model``, the one chosen while connecting, is shown in the picker. Comments in the file are kept."""
    if not _CONNECTION_NAME.fullmatch(name):
        raise ConfigError(f"Connection names use letters, digits, '.', '_' and '-' (got {name!r})")
    doc = _edit()
    connections = doc.setdefault("connections", tomlkit.table(is_super_table=True))
    old = connections.get(name, {})
    table = tomlkit.table()
    if provider is not None:
        table["provider"] = provider
    if base_url is not None:
        table["base_url"] = base_url
    show, hide = list(old.get("show", [])), list(old.get("hide", []))
    if model is not None:
        show, hide = _with(show, model), [m for m in hide if m != model]
    if show:
        table["show"] = show
    if hide:
        table["hide"] = hide
    if "models" in old:
        table["models"] = old["models"]
    connection = _connection(name, table, config_file())
    connections[name] = table
    _save(doc)
    return connection


@_locked
def show_model(name: str, model: str, shown: bool) -> Connection:
    """Shows the connection's model in the picker, or leaves it out."""
    doc = _edit()
    table = doc.get("connections", {}).get(name)
    if table is None:
        raise ConfigError(f"No connection named {name!r}")
    add, drop = ("show", "hide") if shown else ("hide", "show")
    table[add] = _with(list(table.get(add, [])), model)
    rest = [m for m in table.get(drop, []) if m != model]
    if rest:
        table[drop] = rest
    elif drop in table:
        del table[drop]
    connection = _connection(name, table, config_file())
    _save(doc)
    return connection


def _with(models: list[str], model: str) -> list[str]:
    return models if model in models else [*models, model]


@_locked
def remove_connection(name: str) -> bool:
    """Takes the connection out of config.toml, and the default and reviewer models with it when they were the
    connection's.
    Its saved key stays: the caller forgets it. ``False`` when there was no such connection."""
    doc = _edit()
    connections = doc.get("connections")
    if connections is None or name not in connections:
        return False
    del connections[name]
    for key in ("default_model", "review_model"):
        if str(doc.get(key, "")).startswith(f"{name}/"):
            del doc[key]
    _save(doc)
    return True


@_locked
def set_default_model(model: str) -> None:
    doc = _edit()
    doc["default_model"] = model
    _save(doc)


@_locked
def set_default_mode(mode: Mode) -> None:
    """The permission mode new sessions start with."""
    doc = _edit()
    doc["mode"] = mode.value
    _save(doc)


@_locked
def set_clone_folder(folder: Path | None) -> None:
    """Where the app puts the repositories it clones; ``None`` goes back to ``~/AlpineCode``."""
    doc = _edit()
    if folder is not None:
        doc["clone_folder"] = str(folder)
    elif "clone_folder" in doc:
        del doc["clone_folder"]
    _save(doc)


@_locked
def set_review_model(model: str | None) -> None:
    """The model auto mode's reviewer uses, or ``None`` for each session's own model."""
    doc = _edit()
    if model:
        doc["review_model"] = model
    elif "review_model" in doc:
        del doc["review_model"]
    _save(doc)


def _read(file: Path) -> dict[str, Any]:
    if not file.is_file():
        return {}
    try:
        return tomllib.loads(file.read_text(encoding="utf-8"))
    except tomllib.TOMLDecodeError as e:
        raise ConfigError(f"{file} is not valid TOML: {e}") from e


def _from_file(file: Path) -> dict[str, Any]:
    """The settings config.toml sets, by ``Settings`` field name."""
    data = _read(file)
    moved = [hint for key, hint in _MOVED_KEYS.items() if key in data]
    if moved:
        raise ConfigError(f"{file}: " + "; ".join(moved))
    unknown = sorted(set(data) - set(_FILE_KEYS) - {"connections"})
    if unknown:
        raise ConfigError(f"Unknown settings in {file}: {', '.join(unknown)}")
    values = {name: data[key] for key, name in _FILE_KEYS.items() if key in data}
    values["connections"] = _connections(data.get("connections", {}), file)
    return values


def _convert(values: dict[str, Any]) -> None:
    """Turns the text values of the file and the environment into their types, in place."""
    for key in ("context_window", "output_limit"):
        if values.get(key) is not None:
            try:
                values[key] = int(values[key])
            except ValueError as e:
                raise ConfigError(f"{key} must be an integer (got {values[key]!r})") from e
    if values.get("clone_folder") is not None:
        values["clone_folder"] = Path(values["clone_folder"]).expanduser()
    try:
        values["mode"] = Mode(values.get("mode", Mode.DEFAULT))
    except ValueError as e:
        raise ConfigError(f"mode must be one of: {', '.join(Mode)}") from e


def _connections(tables: Any, file: Path) -> dict[str, Connection]:
    if not isinstance(tables, dict):
        raise ConfigError(f"'connections' in {file} must be a table: [connections.<name>]")
    return {name: _connection(name, table, file) for name, table in tables.items()}


def _connection(name: str, table: Mapping[str, Any], file: Path) -> Connection:
    where = f"[connections.{name}] in {file}"
    unknown = sorted(set(table) - {"provider", "base_url", "show", "hide", "models"})
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
    lists = {key: table.get(key, []) for key in ("show", "hide")}
    for key, models in lists.items():
        if not isinstance(models, list) or not all(isinstance(m, str) for m in models):
            raise ConfigError(f"{key} in {where} must be a list of model names")
    models = _model_settings(table.get("models", {}), where)
    return Connection(name, provider, base_url, tuple(lists["show"]), tuple(lists["hide"]), models)


def _model_settings(tables: Any, where: str) -> dict[str, ModelSettings]:
    if not isinstance(tables, Mapping):
        raise ConfigError(f'models in {where} must be tables: [connections.<name>.models."<model>"]')
    models = {}
    for model, table in tables.items():
        if not isinstance(table, Mapping):
            raise ConfigError(f'models.{model} in {where} must be a table: [connections.<name>.models."{model}"]')
        unknown = sorted(set(table) - {"context_window"})
        if unknown:
            raise ConfigError(f"Unknown settings for model {model!r} in {where}: {', '.join(unknown)}")
        window = table.get("context_window")
        if window is not None and (isinstance(window, bool) or not isinstance(window, int) or window <= 0):
            raise ConfigError(f"context_window of model {model!r} in {where} must be a positive integer")
        models[model] = ModelSettings(context_window=window)
    return models


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
