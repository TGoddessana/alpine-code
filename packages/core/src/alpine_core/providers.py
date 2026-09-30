"""The providers a connection can name, so a user picks one instead of typing its address.

A provider fixes the API shape, the address and how it is paid for. Paying decides what the app shows as the limit
(a subscription's time windows, or this month's spend), not the way the key was entered: a coding plan is a
subscription even though it connects with an API key.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Api(StrEnum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    """Chat Completions, as OpenAI and most other servers speak it."""


class Billing(StrEnum):
    SUBSCRIPTION = "subscription"
    """A monthly plan with usage windows."""
    USAGE = "usage"
    """Paid per token."""
    NONE = "none"
    """A local or self-run server: nothing to show."""


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    api: Api
    base_url: str | None
    """``None`` means the SDK's own default (Anthropic's or OpenAI's API)."""
    billing: Billing
    key_env: str
    """The environment variable that holds its key; it wins over a saved key."""


PROVIDERS: dict[str, Provider] = {
    p.id: p
    for p in [
        Provider("anthropic", "Anthropic", Api.ANTHROPIC, None, Billing.USAGE, "ANTHROPIC_API_KEY"),
        Provider("openai", "OpenAI", Api.OPENAI, None, Billing.USAGE, "OPENAI_API_KEY"),
        Provider(
            "google",
            "Google Gemini",
            Api.OPENAI,
            "https://generativelanguage.googleapis.com/v1beta/openai",
            Billing.USAGE,
            "GEMINI_API_KEY",
        ),
        Provider(
            "openrouter", "OpenRouter", Api.OPENAI, "https://openrouter.ai/api/v1", Billing.USAGE, "OPENROUTER_API_KEY"
        ),
        # Coding plans: the plan's own endpoint; the general API of the same company bills per token.
        Provider(
            "zai-coding-plan",
            "GLM Coding Plan",
            Api.OPENAI,
            "https://api.z.ai/api/coding/paas/v4",
            Billing.SUBSCRIPTION,
            "ZAI_API_KEY",
        ),
        Provider(
            "kimi-for-coding",
            "Kimi For Coding",
            Api.OPENAI,
            "https://api.kimi.com/coding/v1",
            Billing.SUBSCRIPTION,
            "KIMI_API_KEY",
        ),
        Provider(
            "minimax-coding-plan",
            "MiniMax Coding Plan",
            Api.OPENAI,
            "https://api.minimax.io/v1",
            Billing.SUBSCRIPTION,
            "MINIMAX_API_KEY",
        ),
    ]
}
