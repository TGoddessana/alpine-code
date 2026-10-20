"""Who is signed in, on which plan, with how many credits: ``GET /v1/me``, cached for 30 seconds.

``status`` is what the app shows. When the API does not answer, the last known status comes back with ``reachable``
false, so a flaky connection never looks like a sign-out. Listeners (the server) hear about every change, including
the credits that arrive with each gateway answer, at most once a second.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

from ..secrets import OAuthTokens
from . import auth, gateway, settings
from .auth import AlpineTokens, SignedOut, Tokens
from .client import CloudClient, CloudError, Unreachable

#: How long a ``/v1/me`` answer is believed.
CACHE_SECONDS = 30.0
#: How long ``/v1/meta`` is believed.
META_SECONDS = 600.0
#: Credits arriving with gateway answers are announced at most this often.
CREDITS_EVERY = 1.0


@dataclass(frozen=True)
class CloudStatus:
    signed_in: bool
    api_url: str
    app_domain: str | None = None
    account: dict[str, Any] | None = None
    plan: dict[str, Any] | None = None
    limits: dict[str, Any] | None = None
    credits: dict[str, Any] | None = None
    reachable: bool = True


_lock = threading.RLock()
_cache: tuple[float, CloudStatus] | None = None
_meta: tuple[float, str, dict[str, Any]] | None = None
_last_credits_notice = 0.0
_listeners: list[Callable[[CloudStatus], None]] = []


def subscribe(listener: Callable[[CloudStatus], None]) -> Callable[[], None]:
    """Calls ``listener(status)`` whenever sign-in, plan or credits change; returns the function that stops it.
    Listeners run on whatever thread caused the change."""
    _listeners.append(listener)
    return lambda: _listeners.remove(listener) if listener in _listeners else None


def changed() -> None:
    status = snapshot()
    for listener in list(_listeners):
        listener(status)


def invalidate() -> None:
    global _cache
    with _lock:
        _cache = None


def reset() -> None:
    """Forgets everything cached (for tests, and when the API address changes)."""
    global _cache, _meta, _last_credits_notice
    with _lock:
        _cache = _meta = None
        _last_credits_notice = 0.0


def meta(*, client: CloudClient | None = None) -> dict[str, Any] | None:
    """``GET /v1/meta`` (versions, ``app_domain``), cached; ``None`` when the API does not answer."""
    global _meta
    url = settings.api_url()
    with _lock:
        if _meta is not None and _meta[1] == url and time.monotonic() - _meta[0] < META_SECONDS:
            return _meta[2]
    try:
        body = (client or CloudClient()).get("/v1/meta", auth=False, timeout=10)
    except CloudError:
        return None
    if not isinstance(body, dict):
        return None
    with _lock:
        _meta = (time.monotonic(), url, body)
    return body


#: What a server that does not say (an older one, or none that answers) is taken to offer.
ALL_SIGN_IN_METHODS = ("google", "github", "email")


def sign_in_methods(*, client: CloudClient | None = None) -> list[str]:
    """The ways to sign in on this server (``sign_in_methods`` of ``GET /v1/meta``: ``google``, ``github``, ``email``).
    All three when the server does not say; a server that lists only ``email`` has no Google or GitHub."""
    listed = (meta(client=client) or {}).get("sign_in_methods")
    if not isinstance(listed, list):
        return list(ALL_SIGN_IN_METHODS)
    known = [m for m in ALL_SIGN_IN_METHODS if m in listed]
    return known or list(ALL_SIGN_IN_METHODS)


def snapshot(store: OAuthTokens | None = None) -> CloudStatus:
    """The status as last known, without asking the API."""
    tokens = AlpineTokens(store).current()
    if tokens is None:
        return CloudStatus(False, settings.api_url())
    with _lock:
        if _cache is not None and _cache[1].account and _cache[1].account.get("id") == tokens.account_id:
            return _cache[1]
    return _minimal(tokens)


def status(*, refresh: bool = False, store: OAuthTokens | None = None, locale: str | None = None) -> CloudStatus:
    """The signed-in account, plan, limits and credits. Never raises for an API that is down: ``reachable`` says so."""
    global _cache
    tokens_source = AlpineTokens(store)
    tokens = tokens_source.current()
    if tokens is None:
        return CloudStatus(False, settings.api_url())
    with _lock:
        cached = _cache
    known = snapshot(store)
    if not refresh and cached is not None and known is cached[1] and time.monotonic() - cached[0] < CACHE_SECONDS:
        return known
    client = CloudClient(tokens_source, locale=locale)
    try:
        me = client.get("/v1/me", timeout=15)
    except SignedOut:
        return CloudStatus(False, settings.api_url())
    except Unreachable:
        return replace(known, reachable=False)
    except CloudError as e:
        if e.status == 401:
            return CloudStatus(False, settings.api_url())
        return replace(known, reachable=False)
    domain = (meta(client=client) or {}).get("app_domain")
    fresh = _from_me(me, tokens, settings.api_url(), domain if isinstance(domain, str) else None)
    with _lock:
        _cache = (time.monotonic(), fresh)
    return fresh


def credits_seen(balance: int) -> None:
    """The credits left, as a gateway answer's ``Alpine-Credits-Remaining`` says. Announced at most once a second."""
    global _cache, _last_credits_notice
    with _lock:
        if _cache is None or not _cache[1].credits:
            return
        stamp, current = _cache
        _cache = (stamp, replace(current, credits={**current.credits, "balance": balance}))
        now = time.monotonic()
        if now - _last_credits_notice < CREDITS_EVERY:
            return
        _last_credits_notice = now
    changed()


def complete_sign_in(tokens: Tokens, store: OAuthTokens | None = None) -> CloudStatus:
    """Keeps a finished sign-in: saves the tokens, adds the ``alpine`` connection, and announces the new status."""
    invalidate()
    auth.save(tokens, store)
    gateway.connect()
    fresh = status(refresh=True, store=store)
    changed()
    return fresh


def sign_out(store: OAuthTokens | None = None) -> bool:
    """Signs out at the API, forgets the tokens and removes the ``alpine`` connection."""
    confirmed = auth.sign_out(store)
    gateway.disconnect()
    return confirmed


def _minimal(tokens: Tokens) -> CloudStatus:
    account = {
        "id": tokens.account_id,
        "email": tokens.email,
        "name": tokens.name,
        "avatar_url": tokens.avatar_url,
        "status": "active",
    }
    return CloudStatus(True, tokens.api_url, account=account, reachable=True)


def _from_me(me: Any, tokens: Tokens, api_url: str, app_domain: str | None) -> CloudStatus:
    me = me if isinstance(me, dict) else {}
    account = me.get("account") if isinstance(me.get("account"), dict) else _minimal(tokens).account
    plan = me.get("plan") if isinstance(me.get("plan"), dict) else None
    if plan is not None:
        plan = {k: plan.get(k) for k in ("id", "status", "trial_ends_at", "trial_used", "renews_at")}
    return CloudStatus(
        True,
        api_url,
        app_domain=app_domain,
        account=account,
        plan=plan,
        limits=me.get("limits") if isinstance(me.get("limits"), dict) else None,
        credits=me.get("credits") if isinstance(me.get("credits"), dict) else None,
    )


def _on_signed_out() -> None:
    invalidate()
    changed()


auth.on_change(_on_signed_out)
