"""Settings, from (lowest to highest priority) the config file, the environment, and explicit overrides.

Config file: ``$XDG_CONFIG_HOME/alpine-code/config.toml`` (default ``~/.config/alpine-code/config.toml``)::

    model = "anthropic/claude-sonnet-5"
    # base_url = "https://openrouter.ai/api/v1"   # any OpenAI-compatible server
    # context_window = 128000
    # mode = "default"                             # default | accept_edits | yolo

Environment: ``ALPINE_MODEL``, ``ALPINE_BASE_URL``, ``ALPINE_API_KEY``, ``ALPINE_CONTEXT_WINDOW``.
The API key is best kept in the environment, not the file.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, fields, replace
from pathlib import Path
from typing import Any

import tomllib

from .permissions import Mode

_ENV = {
    "model": "ALPINE_MODEL",
    "base_url": "ALPINE_BASE_URL",
    "api_key": "ALPINE_API_KEY",
    "context_window": "ALPINE_CONTEXT_WINDOW",
}


class ConfigError(Exception):
    """The settings are missing or invalid. The message says how to fix it."""


def config_dir() -> Path:
    base = os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config"
    return Path(base) / "alpine-code"


@dataclass(frozen=True)
class Settings:
    model: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    context_window: int | None = None
    mode: Mode = Mode.DEFAULT

    @classmethod
    def load(cls, **overrides: Any) -> Settings:
        """Reads the config file and the environment, then applies ``overrides`` that are not ``None``."""
        values: dict[str, Any] = {}
        file = config_dir() / "config.toml"
        if file.is_file():
            try:
                values.update(tomllib.loads(file.read_text(encoding="utf-8")))
            except tomllib.TOMLDecodeError as e:
                raise ConfigError(f"{file} is not valid TOML: {e}") from e
        for key, env in _ENV.items():
            if os.environ.get(env):
                values[key] = os.environ[env]
        values.update({k: v for k, v in overrides.items() if v is not None})

        known = {f.name for f in fields(cls)}
        unknown = sorted(set(values) - known)
        if unknown:
            raise ConfigError(f"Unknown settings in {file}: {', '.join(unknown)}")
        if values.get("context_window") is not None:
            try:
                values["context_window"] = int(values["context_window"])
            except ValueError as e:
                raise ConfigError(f"context_window must be an integer (got {values['context_window']!r})") from e
        try:
            values["mode"] = Mode(values.get("mode", Mode.DEFAULT))
        except ValueError as e:
            raise ConfigError(f"mode must be one of: {', '.join(Mode)}") from e
        return cls(**values)

    def with_model(self, model: str) -> Settings:
        return replace(self, model=model)
