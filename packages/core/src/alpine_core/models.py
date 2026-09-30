"""Builds the alpineagents Model from Settings, and asks a connection which models it offers."""

from __future__ import annotations

from enum import StrEnum

import anthropic
import openai
from alpineagents import Anthropic, Model, OpenAICompatible

from .config import ConfigError, Connection, Settings
from .providers import Api

_HOW_TO_SET = (
    "Connect a model in the app (Settings › Model connection), or in ~/.alpine-code/config.toml:\n"
    '  default_model = "anthropic/claude-sonnet-5"\n'
    "  [connections.anthropic]\n"
    '  provider = "anthropic"                      (key in ANTHROPIC_API_KEY)\n'
    "or for one run:\n"
    "  export ALPINE_MODEL=anthropic/claude-sonnet-5   (with ANTHROPIC_API_KEY)\n"
    "  export ALPINE_MODEL=<model> ALPINE_BASE_URL=https://.../v1 ALPINE_API_KEY=...\n"
    "or pass --model."
)


def make_model(settings: Settings) -> Model | str:
    """A Model object, or a ``provider/model`` string for alpineagents to resolve."""
    name = settings.model
    if not name:
        raise ConfigError("No model is set.\n" + _HOW_TO_SET)
    window = {"context_window": settings.context_window} if settings.context_window else {}
    if settings.base_url:
        return OpenAICompatible(name, base_url=settings.base_url, api_key=settings.api_key, **window)
    prefix, _, model = name.partition("/")
    connection = settings.connections.get(prefix)
    if connection is not None:
        if not model:
            raise ConfigError(f"No model after the connection name: write {prefix}/<model>")
        key = settings.api_key_for(connection)
        if connection.api is Api.ANTHROPIC:
            return Anthropic(model, api_key=key, base_url=connection.url, **window)
        return OpenAICompatible(model, base_url=connection.url, api_key=key, **window)
    if prefix == "anthropic" and model:
        return Anthropic(model, **window)
    if prefix == "openai" and model:
        return OpenAICompatible(model, **window)
    return name


class ModelListError(Exception):
    """A connection could not list its models. ``kind`` says why, so an app can word it."""

    class Kind(StrEnum):
        AUTH = "auth"
        """The key is missing or rejected."""
        UNREACHABLE = "unreachable"
        """No answer from the address."""
        UNSUPPORTED = "unsupported"
        """The server does not list models; the model name has to be typed."""
        OTHER = "other"

    def __init__(self, kind: ModelListError.Kind, message: str) -> None:
        super().__init__(message)
        self.kind = kind


def list_models(connection: Connection, api_key: str | None, *, timeout: float = 15) -> list[str]:
    """The model ids the connection offers, which also checks its key.

    Raises:
        ModelListError: The list could not be read.
    """
    kind = ModelListError.Kind
    try:
        if connection.api is Api.ANTHROPIC:
            client = anthropic.Anthropic(api_key=api_key, base_url=connection.url, timeout=timeout, max_retries=0)
            return [m.id for m in client.models.list(limit=1000)]
        # Local servers need no key, but the SDK refuses to start without one.
        client = openai.OpenAI(api_key=api_key or "not-needed", base_url=connection.url, timeout=timeout, max_retries=0)
        return sorted(m.id for m in client.models.list())
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as e:
        raise ModelListError(kind.AUTH, str(e)) from e
    except (openai.AuthenticationError, openai.PermissionDeniedError) as e:
        raise ModelListError(kind.AUTH, str(e)) from e
    except (anthropic.APIConnectionError, openai.APIConnectionError) as e:
        raise ModelListError(kind.UNREACHABLE, str(e)) from e
    except (anthropic.NotFoundError, openai.NotFoundError) as e:
        raise ModelListError(kind.UNSUPPORTED, str(e)) from e
    except (anthropic.AnthropicError, openai.OpenAIError) as e:
        raise ModelListError(kind.OTHER, str(e)) from e
