"""Signing in to Alpine: the browser sign-in (loopback, state and PKCE), the email code, refresh and sign-out.

The app never talks to Supabase; it talks to the Alpine API (principle 2). Tokens live in ``auth.json`` under the
name ``alpine`` through the ``OAuthTokens`` port, refreshed inside ``locked()`` like the ChatGPT tokens, so two
processes never spend the same rotating refresh token. A record made for another ``api_url`` counts as signed out,
so a local test sign-in never reaches production.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import secrets
import time
import urllib.parse
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from enum import StrEnum
from typing import Any

from alpineagents import AuthError

from ..home import home_dir
from ..secrets import FileSecrets, OAuthTokens
from . import settings
from .client import CloudClient, CloudError

#: The connection name in ``auth.json`` (and the connection in ``config.toml``).
NAME = "alpine"
#: How long a browser sign-in waits for the browser before giving up.
SIGN_IN_TIMEOUT = 600.0
#: Refresh when less than this is left of the access token.
REFRESH_MARGIN = 120.0
CALLBACK_PATH = "/callback"


class SignedOut(AuthError):
    """Nobody is signed in to Alpine (never, signed out, or the refresh token died). Sign in again."""


def default_store() -> FileSecrets:
    return FileSecrets(home_dir() / "auth.json")


@dataclass(frozen=True)
class Tokens:
    """What ``auth.json`` keeps for the Alpine sign-in."""

    api_url: str
    access_token: str
    refresh_token: str
    expires_at: float
    """Unix seconds."""
    account_id: str
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None

    def needs_refresh(self, now: float | None = None) -> bool:
        return (time.time() if now is None else now) >= self.expires_at - REFRESH_MARGIN

    def to_record(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> Tokens | None:
        known = cls.__dataclass_fields__
        try:
            tokens = cls(**{k: v for k, v in record.items() if k in known})
        except TypeError:
            return None
        return tokens if tokens.access_token and tokens.refresh_token else None

    def with_response(self, response: dict[str, Any], now: float | None = None) -> Tokens:
        """These tokens with a token response (a sign-in or a refresh); its ``account`` updates the profile."""
        account = response.get("account") if isinstance(response.get("account"), dict) else {}
        return replace(
            self,
            access_token=response["access_token"],
            refresh_token=response.get("refresh_token") or self.refresh_token,
            expires_at=(time.time() if now is None else now) + float(response.get("expires_in", 3600)),
            account_id=account.get("id") or self.account_id,
            email=account.get("email", self.email),
            name=account.get("name", self.name),
            avatar_url=account.get("avatar_url", self.avatar_url),
        )


def _from_response(response: Any, api_url: str) -> Tokens:
    if not isinstance(response, dict) or "access_token" not in response:
        raise CloudError(502, "upstream", "The sign-in answer had no token.")
    blank = Tokens(api_url=api_url, access_token="", refresh_token="", expires_at=0.0, account_id="")
    return blank.with_response(response)


# ---------------------------------------------------------------- change announcements

_listeners: list[Callable[[], None]] = []


def on_change(listener: Callable[[], None]) -> None:
    """Calls ``listener`` after the tokens were forgotten here (``account`` keeps the status current)."""
    if listener not in _listeners:
        _listeners.append(listener)


def _announce() -> None:
    for listener in list(_listeners):
        listener()


# ---------------------------------------------------------------- the tokens


class AlpineTokens:
    """The access token for the Alpine API, refreshed when less than two minutes are left."""

    def __init__(self, store: OAuthTokens | None = None, api_url: str | None = None) -> None:
        self.store: OAuthTokens = store or default_store()
        self._api_url = api_url

    @property
    def api_url(self) -> str:
        return self._api_url or settings.api_url()

    def current(self) -> Tokens | None:
        """The saved tokens, or ``None`` when signed out (or signed in to another API address)."""
        record = self.store.get_oauth(NAME)
        tokens = Tokens.from_record(record) if record else None
        return tokens if tokens is not None and tokens.api_url == self.api_url else None

    def access_token(self) -> str:
        """A token good for at least two more minutes.

        Raises:
            SignedOut: Signed out, or the refresh token no longer works.
            CloudError: The API could not be reached to refresh; the saved tokens are kept.
        """
        tokens = self.current()
        if tokens is None:
            raise SignedOut("Not signed in to Alpine. Sign in again.")
        if not tokens.needs_refresh():
            return tokens.access_token
        return self._refresh(lambda current: current.needs_refresh())

    def refresh_after_rejection(self, rejected: str) -> str:
        """A new token after the API turned ``rejected`` down (401), unless another process already replaced it."""
        return self._refresh(lambda current: current.access_token == rejected)

    def _refresh(self, still_due: Callable[[Tokens], bool]) -> str:
        with self.store.locked():
            tokens = self.current()  # re-read: another process may have refreshed meanwhile
            if tokens is None:
                raise SignedOut("Not signed in to Alpine. Sign in again.")
            if not still_due(tokens):
                return tokens.access_token
            try:
                response = CloudClient(base_url=self.api_url).post(
                    "/v1/auth/token", {"grant_type": "refresh_token", "refresh_token": tokens.refresh_token}, auth=False
                )
            except CloudError as e:
                if e.status in (400, 401):
                    forget(self.store)
                    raise SignedOut("The Alpine sign-in has ended. Sign in again.") from e
                raise
            fresh = tokens.with_response(response)
            self.store.set_oauth(NAME, fresh.to_record())
            return fresh.access_token


def save(tokens: Tokens, store: OAuthTokens | None = None) -> None:
    """Keeps the tokens. Silent: ``account.complete_sign_in`` announces once the new status is known."""
    (store or default_store()).set_oauth(NAME, tokens.to_record())


def forget(store: OAuthTokens | None = None) -> None:
    """Drops the saved sign-in without telling the API."""
    store = store or default_store()
    if hasattr(store, "delete"):
        store.delete(NAME)
    else:
        store.set_oauth(NAME, {})
    _announce()


def signed_in(store: OAuthTokens | None = None) -> bool:
    return AlpineTokens(store).current() is not None


# ---------------------------------------------------------------- the browser sign-in


class SignInError(Exception):
    """A sign-in ended without an account. ``kind`` says how, so an app can word it."""

    class Kind(StrEnum):
        CANCELLED = "cancelled"
        """The person said no in the browser, or the app gave up."""
        TIMED_OUT = "timed_out"
        FAILED = "failed"

    def __init__(self, kind: SignInError.Kind, message: str) -> None:
        super().__init__(message)
        self.kind = kind


_PAGE = (
    "<!doctype html><meta charset=utf-8><title>Alpine Code</title>"
    "<body style='font-family:system-ui;padding:3rem;text-align:center'><h2>{title}</h2><p>{text}</p></body>"
)


class BrowserSignIn:
    """One browser sign-in (Google or GitHub). ``start`` opens the listener and makes ``url``; the caller opens ``url``
    in a browser, then awaits ``wait``. ``cancel`` gives up."""

    def __init__(self, provider: str, timeout: float, client: CloudClient) -> None:
        # Use ``await BrowserSignIn.start(...)``: the listener needs the running loop.
        self._provider = provider
        self._timeout = timeout
        self._client = client
        self._state = _random(32)
        self._verifier = _random(48)
        self._done: asyncio.Future[dict[str, str]] = asyncio.get_running_loop().create_future()
        self._server: asyncio.Server | None = None
        self.redirect_uri = ""
        self.url = ""

    @classmethod
    async def start(
        cls, provider: str, *, timeout: float = SIGN_IN_TIMEOUT, client: CloudClient | None = None
    ) -> BrowserSignIn:
        self = cls(provider, timeout, client or CloudClient())
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        port = self._server.sockets[0].getsockname()[1]
        self.redirect_uri = f"http://127.0.0.1:{port}{CALLBACK_PATH}"
        challenge = _b64url(hashlib.sha256(self._verifier.encode()).digest())
        query = urllib.parse.urlencode(
            {
                "provider": provider,
                "redirect_uri": self.redirect_uri,
                "state": self._state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        self.url = f"{self._client.base_url}/v1/auth/authorize?{query}"
        return self

    async def wait(self) -> Tokens:
        """The signed-in tokens (not yet saved), once the browser comes back and the code is exchanged.

        Raises:
            SignInError: Cancelled, timed out, or failed.
        """
        try:
            query = await asyncio.wait_for(asyncio.shield(self._done), self._timeout)
        except TimeoutError:
            raise SignInError(SignInError.Kind.TIMED_OUT, "Nobody finished signing in in the browser.") from None
        except asyncio.CancelledError:
            if self._done.cancelled():
                raise SignInError(SignInError.Kind.CANCELLED, "Signing in was cancelled.") from None
            raise
        finally:
            self._close()
        return await asyncio.to_thread(self._finish, query)

    def cancel(self) -> None:
        if not self._done.done():
            self._done.cancel()
        self._close()

    def _close(self) -> None:
        if self._server is not None:
            self._server.close()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            line = (await reader.readline()).decode("latin-1")
            while (await reader.readline()) not in (b"\r\n", b"\n", b""):
                pass
            parts = line.split()
            target = urllib.parse.urlparse(parts[1]) if len(parts) >= 2 else None
            query = {k: v[0] for k, v in urllib.parse.parse_qs(target.query).items()} if target else {}
            ours = (
                target is not None
                and target.path == CALLBACK_PATH
                and secrets.compare_digest(query.get("state", "").encode(), self._state.encode())
            )
            if not ours:
                # Not this sign-in's callback (a stray request, or an old attempt): keep waiting.
                self._respond(writer, 404, "Not found", "This is not the sign-in Alpine Code is waiting for.")
            elif "error" in query:
                self._respond(
                    writer, 200, "로그인하지 않았어요 / Not signed in", "앱으로 돌아가세요 / Go back to the app."
                )
            else:
                self._respond(
                    writer, 200, "Alpine에 로그인했어요 / Signed in", "앱으로 돌아가세요 / You can go back to the app."
                )
            await writer.drain()
            if ours and not self._done.done():
                self._done.set_result(query)
        finally:
            writer.close()

    @staticmethod
    def _respond(writer: asyncio.StreamWriter, status: int, title: str, text: str) -> None:
        body = _PAGE.format(title=title, text=text).encode()
        head = f"HTTP/1.1 {status} OK\r\nContent-Type: text/html; charset=utf-8\r\n"
        writer.write(f"{head}Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)

    def _finish(self, query: dict[str, str]) -> Tokens:
        fail = SignInError.Kind.FAILED
        if query.get("error") == "access_denied":
            raise SignInError(SignInError.Kind.CANCELLED, "Signing in was declined in the browser.")
        if "error" in query:
            raise SignInError(fail, f"Alpine answered {query['error']}.")
        try:
            response = self._client.post(
                "/v1/auth/token",
                {
                    "grant_type": "authorization_code",
                    "code": query.get("code", ""),
                    "code_verifier": self._verifier,
                    "redirect_uri": self.redirect_uri,
                },
                auth=False,
            )
            return _from_response(response, self._client.base_url)
        except CloudError as e:
            raise SignInError(fail, f"Exchanging the sign-in code failed: {e}") from e


# ---------------------------------------------------------------- the email code


def send_code(email: str, locale: str, client: CloudClient | None = None) -> None:
    """Mails a sign-in code. Raises ``CloudError`` (``invalid`` for a bad address)."""
    (client or CloudClient()).post("/v1/auth/email/start", {"email": email, "locale": locale}, auth=False)


def verify_code(email: str, code: str, client: CloudClient | None = None) -> Tokens:
    """The tokens for a right code (not yet saved). Raises ``CloudError`` with code ``invalid`` for a wrong one."""
    client = client or CloudClient()
    response = client.post("/v1/auth/email/verify", {"email": email, "code": code}, auth=False)
    return _from_response(response, client.base_url)


# ---------------------------------------------------------------- signing out


def sign_out(store: OAuthTokens | None = None) -> bool:
    """Ends the sign-in at the API and forgets the tokens. Returns whether the API confirmed it; either way the
    tokens are gone."""
    store = store or default_store()
    tokens = AlpineTokens(store).current()
    confirmed = tokens is None
    if tokens is not None:
        try:
            CloudClient(base_url=tokens.api_url).post(
                "/v1/auth/sign-out", {"refresh_token": tokens.refresh_token}, auth=False, timeout=10
            )
            confirmed = True
        except CloudError:
            confirmed = False
    forget(store)
    return confirmed


def _random(size: int) -> str:
    return _b64url(secrets.token_bytes(size))


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()
