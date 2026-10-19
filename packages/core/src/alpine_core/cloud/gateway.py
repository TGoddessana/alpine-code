"""The Alpine model gateway as a model connection: ``alpine/<model>`` runs on the person's Alpine credits.

The gateway speaks OpenAI Chat Completions, so ``AlpineModel`` is ``OpenAICompatible`` with three differences: the
Bearer token is fetched (and refreshed) for every request like ``ChatGPTModel`` does, ``Alpine-Session`` says which
conversation asks, and the credits left (``Alpine-Credits-Remaining``) go to the app after each answer. A ``402
credits_exhausted`` becomes ``CreditsExhausted``, which a session shows as a failed run with the refill date.

The generic part (a token that is looked up per request, answers that carry account state) is meant to move into
alpineagents.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from alpineagents import AuthError, ProviderError
from alpineagents.models.base import OnEvent, OnText
from alpineagents.models.openai_compatible import OpenAICompatible
from alpineagents.types import Reply, Request

from ..config import ConfigError, Connection, Settings, remove_connection, save_connection, set_default_model
from ..context import save_reported
from ..providers import Auth
from . import settings
from .auth import AlpineTokens, SignedOut
from .client import CloudClient, CloudError

CONNECTION = "alpine"
CREDITS_HEADER = "alpine-credits-remaining"
SESSION_HEADER = "Alpine-Session"


class CreditsExhausted(ProviderError):
    """The account has no credits left until they refill. Nothing switches to another way of paying."""

    def __init__(self, message: str, refills_at: str | None = None) -> None:
        super().__init__(message)
        self.refills_at = refills_at


def is_alpine(connection: Connection) -> bool:
    return connection.provider is not None and connection.provider.auth is Auth.ALPINE


@dataclass(frozen=True)
class GatewayModel:
    id: str
    context_window: int | None = None
    default: bool = False


def list_gateway_models(client: CloudClient | None = None) -> list[GatewayModel]:
    """``GET /v1/gateway/models``. Raises ``CloudError`` or ``SignedOut``."""
    client = client or CloudClient(AlpineTokens())
    listed = client.get("/v1/gateway/models") or {}
    models = []
    for entry in listed.get("data", []) if isinstance(listed, dict) else []:
        if isinstance(entry, dict) and isinstance(entry.get("id"), str):
            window = entry.get("context_window")
            models.append(
                GatewayModel(entry["id"], window if isinstance(window, int) else None, bool(entry.get("default")))
            )
    return models


def connect() -> Connection:
    """Adds ``[connections.alpine]`` when missing, and makes ``alpine/<the gateway's default model>`` the default
    model only when none is set. Without an answer from the gateway the connection is still added; the person picks
    a model later."""
    connection = save_connection(CONNECTION, provider="alpine")
    try:
        if Settings.load().model is None:
            models = list_gateway_models()
            save_reported(CONNECTION, {m.id: m.context_window for m in models})
            chosen = next((m for m in models if m.default), models[0] if models else None)
            if chosen is not None:
                set_default_model(f"{CONNECTION}/{chosen.id}")
    except (CloudError, SignedOut, ConfigError):
        pass
    return connection


def disconnect() -> None:
    """Takes the connection out of ``config.toml`` (and the default model with it, when it was Alpine's)."""
    try:
        remove_connection(CONNECTION)
    except ConfigError:
        pass  # a config file that does not parse is config.py's to report


class AlpineModel(OpenAICompatible):
    """A model on the Alpine gateway. ``tokens`` gives a fresh Bearer token for every request."""

    provider = "alpine"

    def __init__(
        self,
        name: str,
        tokens: AlpineTokens,
        *,
        base_url: str | None = None,
        session_id: str | None = None,
        on_credits: Callable[[int], None] | None = None,
        **kwargs: Any,
    ) -> None:
        super().__init__(name, base_url=base_url or settings.gateway_url(), api_key=None, **kwargs)
        self._tokens = tokens
        self._on_credits = on_credits
        #: One id per model object, that is per conversation: the gateway keeps it with each usage entry.
        self.session_id = session_id or uuid.uuid4().hex
        self._current = ""

    # ---- the SDK clients: a token per request, and the credits header of each answer

    def _client_kwargs(self, *, is_async: bool = False) -> dict[str, Any]:
        import openai

        kwargs = super()._client_kwargs()
        kwargs["default_headers"] = {
            SESSION_HEADER: self.session_id,
            "Alpine-Client": settings.client_header(),
            "Accept-Language": settings.locale(),
        }
        if is_async:

            async def token() -> str:
                return self._current

            async def seen(response: Any) -> None:
                self._seen(response)

            kwargs["api_key"] = token
            kwargs["http_client"] = openai.DefaultAsyncHttpxClient(event_hooks={"response": [seen]})
        else:
            kwargs["api_key"] = lambda: self._current
            kwargs["http_client"] = openai.DefaultHttpxClient(event_hooks={"response": [self._seen]})
        return kwargs

    def _async_client(self) -> Any:
        loop = asyncio.get_running_loop()
        with self._client_lock:
            client = self._async_clients.get(loop)
            if client is None:
                import openai

                client = openai.AsyncOpenAI(**self._client_kwargs(is_async=True))
                self._async_clients[loop] = client
            return client

    def _seen(self, response: Any) -> None:
        value = response.headers.get(CREDITS_HEADER)
        if value is not None and self._on_credits is not None:
            try:
                self._on_credits(int(value))
            except ValueError:
                pass

    # ---- one request: a fresh token, and one retry after a 401

    def respond(self, request: Request, on_text: OnText | None = None, on_event: OnEvent | None = None) -> Reply:
        self._current = self._tokens.access_token()
        try:
            return super().respond(request, on_text, on_event)
        except AuthError:
            self._current = self._tokens.refresh_after_rejection(self._current)
            return super().respond(request, on_text, on_event)

    async def arespond(self, request: Request, on_text: OnText | None = None, on_event: OnEvent | None = None) -> Reply:
        self._current = await asyncio.to_thread(self._tokens.access_token)
        try:
            return await super().arespond(request, on_text, on_event)
        except AuthError:
            self._current = await asyncio.to_thread(self._tokens.refresh_after_rejection, self._current)
            return await super().arespond(request, on_text, on_event)

    @staticmethod
    def _wrap_error(e: Exception) -> Exception:
        import openai

        if isinstance(e, openai.APIStatusError) and e.status_code == 402:
            body = e.body if isinstance(e.body, dict) else {}
            if body.get("code") == "credits_exhausted":
                detail = body.get("detail") if isinstance(body.get("detail"), dict) else {}
                refills = detail.get("refills_at")
                message = str(body.get("message") or "Alpine credits are used up.")
                return CreditsExhausted(message, refills if isinstance(refills, str) else None)
        return OpenAICompatible._wrap_error(e)
