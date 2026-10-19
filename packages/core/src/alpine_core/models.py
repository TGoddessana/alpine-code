"""Builds the alpineagents Model from Settings, and asks a connection which models it offers."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from enum import StrEnum
from typing import Any

import anthropic
import openai
from alpineagents import Anthropic, Model, OpenAICompatible
from alpineagents.models.anthropic import DEFAULT_MAX_TOKENS as ANTHROPIC_DEFAULT_MAX_TOKENS

from .catalog import is_local, saved_catalog
from .chatgpt import ChatGPTError, ChatGPTModel, ChatGPTTokens, PlanUsageOff, SignInNeeded, fetch_models, is_chatgpt
from .config import ConfigError, Connection, Settings
from .context import ContextLimits, limits_for, remember, save_reported
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
    """A Model object, or a ``provider/model`` string for alpineagents to resolve. The window it was given and its
    tidy point are kept for ``context.limits_of``."""
    name = settings.model
    if not name:
        raise ConfigError("No model is set.\n" + _HOW_TO_SET)
    if settings.base_url:
        limits = ContextLimits(settings.context_window, reply=settings.output_limit)
        adapter = OpenAICompatible(
            name,
            base_url=settings.base_url,
            api_key=settings.api_key,
            max_tokens=settings.output_limit,
            **_window(limits),
        )
        return remember(adapter, limits)
    catalog = saved_catalog()
    prefix, _, model = name.partition("/")
    connection = settings.connections.get(prefix)
    if connection is not None:
        if not model:
            raise ConfigError(f"No model after the connection name: write {prefix}/<model>")
        if is_chatgpt(connection):
            written = connection.models.get(model)
            window = written.context_window if written else None
            return ChatGPTModel(model, chatgpt_tokens(settings, connection), context_window=window)
        key = settings.api_key_for(connection)
        if connection.api is Api.ANTHROPIC:
            limits = limits_for(connection, prefix, model, catalog, reply=_anthropic_reply(settings))
            adapter = Anthropic(
                model, api_key=key, base_url=connection.url, max_tokens=settings.output_limit, **_window(limits)
            )
            return remember(adapter, limits)
        limits = limits_for(connection, prefix, model, catalog, reply=settings.output_limit)
        adapter = OpenAICompatible(
            model, base_url=connection.url, api_key=key, max_tokens=settings.output_limit, **_window(limits)
        )
        return remember(adapter, limits)
    if prefix == "anthropic" and model:
        limits = limits_for(None, prefix, model, catalog, reply=_anthropic_reply(settings))
        return remember(Anthropic(model, max_tokens=settings.output_limit, **_window(limits)), limits)
    if prefix == "openai" and model:
        limits = limits_for(None, prefix, model, catalog, reply=settings.output_limit)
        return remember(OpenAICompatible(model, max_tokens=settings.output_limit, **_window(limits)), limits)
    return name


def _window(limits: ContextLimits) -> dict[str, int]:
    """The adapter's ``context_window=``; an unknown window leaves the adapter's own guess, which the loop does not
    tidy by (``context.limits_of`` says unknown)."""
    return {"context_window": limits.window} if limits.window else {}


def _anthropic_reply(settings: Settings) -> int:
    """The reply room the window keeps free: ``output_limit`` when set, else what alpineagents sends (64000, or the
    model's own lower limit, which only makes the reserve a little larger than needed)."""
    return settings.output_limit or ANTHROPIC_DEFAULT_MAX_TOKENS


def chatgpt_tokens(settings: Settings, connection: Connection) -> ChatGPTTokens:
    """The tokens of a ChatGPT connection, kept where ``settings`` keeps its keys."""
    store = settings.secrets
    if store is None or not hasattr(store, "get_oauth"):
        raise ConfigError("This key store cannot hold a ChatGPT sign-in.")
    return ChatGPTTokens(store, connection.name)  # type: ignore[arg-type]  # FileSecrets is also OAuthTokens


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


def _can_run_an_agent(info: dict[str, Any]) -> bool:
    """Whether a model can work as the agent, by what the server says about it: it reads and writes text, calls
    tools, and is still offered. Routers (OpenRouter, OneRouter) say this in their own fields; a server that says
    nothing (Ollama, vLLM, LM Studio) keeps every model."""
    architecture = info.get("architecture") if isinstance(info.get("architecture"), dict) else {}
    for key in ("input_modalities", "output_modalities"):
        kinds = architecture.get(key, info.get(key))
        if isinstance(kinds, list) and kinds and "text" not in {str(k).lower() for k in kinds}:
            return False
    parameters = info.get("supported_parameters")
    if isinstance(parameters, list) and "tools" not in parameters:
        return False
    if info.get("supports_function_calling") is False or info.get("deprecated") is True:
        return False
    category = info.get("category_type")
    return not isinstance(category, str) or category.upper() == "LLM"


def _reported_window(info: dict[str, Any]) -> int | None:
    """The window a server put in a model's entry of its list: OpenRouter's ``context_length``, vLLM's
    ``max_model_len``, LM Studio's ``max_context_length`` or the loaded instance's ``context_length``."""
    loaded = info.get("loaded_instances")
    for instance in loaded if isinstance(loaded, list) else []:
        config = instance.get("config") if isinstance(instance, dict) else None
        if isinstance(config, dict) and _tokens(config.get("context_length")):
            return _tokens(config["context_length"])
    for key in ("loaded_context_length", "context_length", "max_model_len", "max_context_length", "context_window"):
        if _tokens(info.get(key)):
            return _tokens(info[key])
    top = info.get("top_provider")
    return _tokens(top.get("context_length")) if isinstance(top, dict) else None


def _tokens(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _local_windows(url: str, models: list[str], timeout: float) -> dict[str, int | None]:
    """Windows a server on this computer tells on its own API, not on ``/v1/models``: LM Studio's ``/api/v1/models``
    (``/api/v0/models`` before 0.4), then Ollama's ``/api/show`` per model (``num_ctx`` when the model sets it,
    else ``<arch>.context_length``). A server that answers neither gets nothing."""
    root = url.rstrip("/").removesuffix("/v1")
    for path in ("/api/v1/models", "/api/v0/models"):
        listed = _get_json(root + path, None, timeout)
        entries = listed.get("models", listed.get("data")) if isinstance(listed, dict) else None
        if isinstance(entries, list):
            found = {
                str(e.get("id") or e.get("key")): _reported_window(e)
                for e in entries
                if isinstance(e, dict) and (e.get("id") or e.get("key"))
            }
            return {m: found.get(m) for m in models}
    windows: dict[str, int | None] = {}
    for model in models:
        shown = _get_json(root + "/api/show", {"model": model}, timeout)
        if not isinstance(shown, dict):
            break  # not Ollama, or it is gone
        windows[model] = _ollama_window(shown)
    return windows


def _ollama_window(shown: dict[str, Any]) -> int | None:
    parameters = shown.get("parameters")
    for line in parameters.splitlines() if isinstance(parameters, str) else []:
        name, _, value = line.strip().partition(" ")
        if name == "num_ctx" and value.strip().isdigit():
            return _tokens(int(value.strip()))
    info = shown.get("model_info")
    if isinstance(info, dict):
        return next((_tokens(v) for k, v in info.items() if k.endswith(".context_length") and _tokens(v)), None)
    return None


def _get_json(url: str, body: dict[str, Any] | None, timeout: float) -> Any:
    """The JSON answer of a GET (or, with ``body``, a POST), or ``None`` when there is none."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read())
    except (OSError, urllib.error.URLError, ValueError):
        return None


def list_models(
    connection: Connection, api_key: str | None, *, tokens: ChatGPTTokens | None = None, timeout: float = 15
) -> list[str]:
    """The model ids the connection offers, which also checks its key. A ChatGPT connection needs ``tokens``
    instead of ``api_key``, and lists its models in OpenAI's order.

    The windows the server reports for its models are kept for ``make_model`` (``context.save_reported``).

    Raises:
        ModelListError: The list could not be read.
    """
    kind = ModelListError.Kind
    if is_chatgpt(connection):
        if tokens is None:
            raise ModelListError(kind.AUTH, f"Connection {connection.name!r} needs its ChatGPT sign-in.")
        try:
            return [m.slug for m in fetch_models(tokens.access_token(), timeout=timeout)]
        except (SignInNeeded, PlanUsageOff) as e:
            raise ModelListError(kind.AUTH, str(e)) from e
        except ChatGPTError as e:
            raise ModelListError(kind.OTHER, str(e)) from e
    try:
        windows = _list(connection, api_key, timeout)
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
    if connection.url and is_local(connection.url) and not any(windows.values()):
        windows.update(_local_windows(connection.url, list(windows), min(timeout, 3)))
    save_reported(connection.name, windows)
    return list(windows)


def _list(connection: Connection, api_key: str | None, timeout: float) -> dict[str, int | None]:
    """The models by id, in the order shown, with the window the server reported for each."""
    if connection.api is Api.ANTHROPIC:
        client = anthropic.Anthropic(api_key=api_key, base_url=connection.url, timeout=timeout, max_retries=0)
        return {m.id: _tokens(m.max_input_tokens) for m in client.models.list(limit=1000)}
    # Local servers need no key, but the SDK refuses to start without one.
    client = openai.OpenAI(api_key=api_key or "not-needed", base_url=connection.url, timeout=timeout, max_retries=0)
    listed = [(m.id, m.model_extra or {}) for m in client.models.list()]
    return {name: _reported_window(extra) for name, extra in sorted(listed) if _can_run_an_agent(extra)}
