"""Builds the alpineagents Model from Settings."""

from __future__ import annotations

from alpineagents import Anthropic, Model, OpenAICompatible

from .config import ConfigError, Settings

_HOW_TO_SET = (
    "Set a model, for example:\n"
    "  export ALPINE_MODEL=anthropic/claude-sonnet-5   (with ANTHROPIC_API_KEY)\n"
    "  export ALPINE_MODEL=openai/gpt-5                 (with OPENAI_API_KEY)\n"
    "  export ALPINE_MODEL=ollama/qwen3-coder\n"
    "or any OpenAI-compatible server:\n"
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
    provider, _, model = name.partition("/")
    if provider == "anthropic" and model:
        return Anthropic(model, api_key=settings.api_key, **window)
    if provider == "openai" and model:
        return OpenAICompatible(model, api_key=settings.api_key, **window)
    return name
