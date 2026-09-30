"""Sign in with ChatGPT, the flow OpenAI offers open-source apps (developers.openai.com/siwc).

The first sign-in registers alpine-code as a client of the user's account (``client_id=dynamic_agent_client``) and
gets back an issued ``client_id``; later sign-ins to the same account reuse it. A browser does the signing in and
comes back to a listener on ``127.0.0.1``. No client secret exists: PKCE protects the code.

HTTP goes through ``post_form`` and ``get_json`` (``urllib``, run on a thread by the async callers), which tests
replace.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, replace
from enum import StrEnum
from pathlib import Path
from typing import Any

ISSUER = "https://auth.openai.com"
AUTHORIZE_URL = f"{ISSUER}/api/accounts/authorize"
TOKEN_URL = f"{ISSUER}/api/accounts/oauth/token"
DISCOVERY_URL = f"{ISSUER}/.well-known/openid-configuration"
RESOURCE = "https://api.openai.com/v1"
#: The permission to spend the user's ChatGPT plan. A sign-in without it is kept, but cannot run a model.
PLAN_SCOPE = "chatgpt.tokens.use.direct"
SCOPES = ("openid", "profile", "email", "offline_access", "resource.invoke", PLAN_SCOPE)
#: The name the user sees when approving the app; OpenAI asks for the same one on every install.
APP_NAME = "alpine-code"
NEW_CLIENT = "dynamic_agent_client"
CALLBACK_PATH = "/auth/callback"
PORT = 1455
#: How long a sign-in waits for the browser before giving up.
SIGN_IN_TIMEOUT = 600.0
#: Refresh this long before the access token (one hour) expires.
REFRESH_MARGIN = 300.0

PostForm = Callable[[str, dict[str, str]], tuple[int, Any]]
"""``(url, fields) -> (status, body)``: a form POST whose JSON body is parsed (text when it is not JSON)."""
GetJson = Callable[[str], Any]
VerifyIdToken = Callable[[str, str, str], dict[str, Any]]
"""``(id_token, client_id, nonce) -> claims``, raising ``ValueError`` when the token is not valid."""


# ---------------------------------------------------------------- HTTP


def post_form(url: str, fields: dict[str, str], timeout: float = 30) -> tuple[int, Any]:
    request = urllib.request.Request(
        url, data=urllib.parse.urlencode(fields).encode(), headers={"Content-Type": "application/x-www-form-urlencoded"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, _parse(response.read())
    except urllib.error.HTTPError as e:
        return e.code, _parse(e.read())


def get_json(url: str, timeout: float = 30) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read())


def _parse(body: bytes) -> Any:
    text = body.decode("utf-8", errors="replace")
    try:
        return json.loads(text) if text else {}
    except ValueError:
        return text


_discovery: dict[str, Any] | None = None


def discovery(get: GetJson = get_json) -> dict[str, Any]:
    """OpenAI's OpenID configuration (JWKS and revocation addresses), fetched once per process."""
    global _discovery
    if _discovery is None:
        _discovery = get(DISCOVERY_URL)
    return _discovery


_jwks_clients: dict[str, Any] = {}


def verify_id_token(id_token: str, client_id: str, nonce: str) -> dict[str, Any]:
    """Checks the ID token's signature against OpenAI's published keys, and its issuer, audience, expiry and nonce."""
    import jwt

    uri = discovery()["jwks_uri"]
    client = _jwks_clients.get(uri) or _jwks_clients.setdefault(uri, jwt.PyJWKClient(uri))
    try:
        key = client.get_signing_key_from_jwt(id_token)
        claims = jwt.decode(id_token, key.key, algorithms=["RS256"], audience=client_id, issuer=ISSUER)
    except jwt.PyJWTError as e:
        raise ValueError(f"the ID token is not valid: {e}") from e
    if claims.get("nonce") != nonce:
        raise ValueError("the ID token's nonce does not match this sign-in")
    return claims


# ---------------------------------------------------------------- the account


def host_id(home: Path) -> str:
    """This computer's ``ext_agent_host_id``: made once and kept in ``<home>/host_id``. The CLI and the app share
    it, since they run on the same host. An identifier, not a secret."""
    path = home / "host_id"
    try:
        value = path.read_text(encoding="utf-8").strip()
    except FileNotFoundError:
        value = ""
    if not value:
        value = f"urn:uuid:{uuid.uuid4()}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value + "\n", encoding="utf-8")
    return value


@dataclass(frozen=True)
class Account:
    """A signed-in ChatGPT account: what ``auth.json`` keeps for one connection.

    ``client_id`` is the one OpenAI issued to this registration (``oaiapp_...``); ``subject`` is the ID token's
    ``sub``. Together they tell registrations apart, even two with the same email. Tokens are empty after signing
    out or after a refresh failed for good; the rest stays for the next sign-in.
    """

    client_id: str
    subject: str
    email: str | None = None
    id_token: str = ""
    access_token: str = ""
    refresh_token: str = ""
    expires_at: float = 0.0
    """Unix seconds."""
    earliest_refresh_at: float | None = None
    scopes: tuple[str, ...] = ()
    saved_at: float = field(default_factory=time.time)

    @property
    def signed_in(self) -> bool:
        return bool(self.access_token and self.refresh_token)

    @property
    def plan_usage(self) -> bool:
        """Whether the user allowed alpine-code to use their ChatGPT plan."""
        return PLAN_SCOPE in self.scopes

    def needs_refresh(self, now: float | None = None) -> bool:
        now = time.time() if now is None else now
        if now < self.expires_at - REFRESH_MARGIN:
            return False
        # OpenAI says when refreshing becomes allowed; before that, keep the token unless it has run out.
        return not (self.earliest_refresh_at and now < self.earliest_refresh_at and now < self.expires_at)

    def with_tokens(self, response: dict[str, Any], now: float | None = None) -> Account:
        """This account with the tokens of a token-endpoint response (a sign-in or a refresh)."""
        now = time.time() if now is None else now
        scope = response.get("scope")
        return replace(
            self,
            id_token=response.get("id_token") or self.id_token,
            access_token=response["access_token"],
            refresh_token=response.get("refresh_token") or self.refresh_token,
            expires_at=now + float(response.get("expires_in", 3600)),
            earliest_refresh_at=float(response["earliest_refresh_at"]) if response.get("earliest_refresh_at") else None,
            scopes=tuple(sorted(scope.split())) if isinstance(scope, str) else self.scopes,
            saved_at=now,
        )

    def signed_out(self) -> Account:
        """Without its tokens: the registration and the ``id_token`` (a hint for the next sign-in) stay."""
        return replace(self, access_token="", refresh_token="", expires_at=0.0, earliest_refresh_at=None)

    def to_record(self) -> dict[str, Any]:
        record = asdict(self)
        record["scopes"] = list(self.scopes)
        return record

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> Account:
        known = {f for f in cls.__dataclass_fields__}
        values = {k: v for k, v in record.items() if k in known}
        values["scopes"] = tuple(values.get("scopes") or ())
        return cls(**values)


# ---------------------------------------------------------------- signing in


class SignInError(Exception):
    """A sign-in ended without an account. ``kind`` says how, so an app can word it."""

    class Kind(StrEnum):
        DECLINED = "declined"
        """The user said no in the browser."""
        CANCELLED = "cancelled"
        TIMED_OUT = "timed_out"
        FAILED = "failed"
        """Anything else; the message says what."""

    def __init__(self, kind: SignInError.Kind, message: str) -> None:
        super().__init__(message)
        self.kind = kind


_PAGE = (
    "<!doctype html><meta charset=utf-8><title>alpine-code</title>"
    "<body style='font-family:system-ui;padding:3rem;text-align:center'><h2>{title}</h2><p>{text}</p></body>"
)


class SignIn:
    """One browser sign-in. ``start`` opens the listener and makes ``url``; the caller opens ``url`` in a browser,
    then awaits ``wait``. ``cancel`` gives up.

    ``previous`` signs in again to an account that already has a registration: its issued ``client_id`` is reused
    and the browser skips choosing the account. ``consent`` asks the user to allow plan usage again, after they
    declined it once.
    """

    def __init__(self, previous: Account | None, post: PostForm, verify: VerifyIdToken, timeout: float) -> None:
        # Use ``await SignIn.start(...)``: the listener needs the running loop.
        self._previous = previous
        self._post = post
        self._verify = verify
        self._timeout = timeout
        self._state = _random()
        self._nonce = _random()
        self._verifier = _random(48)
        self._done: asyncio.Future[dict[str, str]] = asyncio.get_running_loop().create_future()
        self._server: asyncio.Server | None = None
        self.redirect_uri = ""
        self.url = ""

    @classmethod
    async def start(
        cls,
        host: str,
        *,
        previous: Account | None = None,
        consent: bool = False,
        port: int = PORT,
        timeout: float = SIGN_IN_TIMEOUT,
        post: PostForm = post_form,
        verify: VerifyIdToken | None = None,
    ) -> SignIn:
        self = cls(previous, post, verify or verify_id_token, timeout)
        try:
            self._server = await asyncio.start_server(self._handle, "127.0.0.1", port)
        except OSError:  # taken (another sign-in, or Codex): only the port may change
            self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        bound = self._server.sockets[0].getsockname()[1]
        self.redirect_uri = f"http://127.0.0.1:{bound}{CALLBACK_PATH}"
        self.url = self._authorize_url(host, consent)
        return self

    def _authorize_url(self, host: str, consent: bool) -> str:
        challenge = _b64url(hashlib.sha256(self._verifier.encode()).digest())
        params = {"client_id": NEW_CLIENT, "agent_name_hint": APP_NAME}
        if self._previous is not None:
            params = {"client_id": self._previous.client_id}
            if self._previous.id_token:
                params["id_token_hint"] = self._previous.id_token
            if self._previous.email:
                params["login_hint"] = self._previous.email
        params |= {
            "ext_agent_host_id": host,
            "response_type": "code",
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(SCOPES),
            "resource": RESOURCE,
            "state": self._state,
            "nonce": self._nonce,
            "code_challenge_method": "S256",
            "code_challenge": challenge,
        }
        if consent:
            params["prompt"] = "consent"
        return f"{AUTHORIZE_URL}?{urllib.parse.urlencode(params, quote_via=urllib.parse.quote)}"

    async def wait(self) -> Account:
        """The signed-in account, once the browser comes back and the code is exchanged and checked.

        Raises:
            SignInError: Declined, cancelled, timed out, or failed.
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
            if target is None or target.path != CALLBACK_PATH or query.get("state") != self._state:
                # Not this sign-in's callback (a stray request, or an old attempt): keep waiting.
                self._respond(writer, 404, "Not found", "This is not the sign-in alpine-code is waiting for.")
            elif "error" in query:
                self._respond(writer, 200, "Not signed in", "You can close this tab and go back to alpine-code.")
            else:
                self._respond(writer, 200, "Signed in", "You can close this tab and go back to alpine-code.")
            await writer.drain()
            if target is not None and target.path == CALLBACK_PATH and query.get("state") == self._state:
                if not self._done.done():
                    self._done.set_result(query)
        finally:
            writer.close()

    @staticmethod
    def _respond(writer: asyncio.StreamWriter, status: int, title: str, text: str) -> None:
        body = _PAGE.format(title=title, text=text).encode()
        head = f"HTTP/1.1 {status} {title}\r\nContent-Type: text/html; charset=utf-8\r\n"
        writer.write(f"{head}Content-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)

    def _finish(self, query: dict[str, str]) -> Account:
        fail = SignInError.Kind.FAILED
        if query.get("error") == "access_denied":
            raise SignInError(SignInError.Kind.DECLINED, "Signing in was declined in the browser.")
        if "error" in query:
            raise SignInError(fail, f"OpenAI answered {query['error']}: {query.get('error_description', '')}".strip())
        client_id = query.get("client_id")
        if self._previous is None:
            if not client_id or client_id == NEW_CLIENT:
                raise SignInError(fail, "OpenAI did not register alpine-code for this account. Try again.")
        else:
            if client_id and client_id != self._previous.client_id:
                raise SignInError(fail, "OpenAI answered for a different registration. Try again.")
            client_id = self._previous.client_id
        status, body = self._post(
            TOKEN_URL,
            {
                "grant_type": "authorization_code",
                "client_id": client_id,
                "code": query.get("code", ""),
                "code_verifier": self._verifier,
                "redirect_uri": self.redirect_uri,
                "resource": RESOURCE,
            },
        )
        if status != 200 or not isinstance(body, dict) or "access_token" not in body:
            raise SignInError(fail, f"Exchanging the sign-in code failed ({status}): {_error_text(body)}")
        try:
            claims = self._verify(body.get("id_token", ""), client_id, self._nonce)
        except ValueError as e:
            raise SignInError(fail, str(e)) from e
        subject = str(claims.get("sub", ""))
        if self._previous is not None and subject != self._previous.subject:
            raise SignInError(fail, "That is a different ChatGPT account than this connection's.")
        account = Account(client_id=client_id, subject=subject, email=claims.get("email"))
        return account.with_tokens(body)


# ---------------------------------------------------------------- refreshing and signing out


class RefreshError(Exception):
    """A refresh failed. ``for_good`` means the tokens are dead and the user has to sign in again."""

    def __init__(self, message: str, *, for_good: bool) -> None:
        super().__init__(message)
        self.for_good = for_good


#: Refresh-token errors after which only a new sign-in helps.
_DEAD_REFRESH = {
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
}


def refresh(account: Account, post: PostForm = post_form) -> Account:
    """The account with fresh tokens. The refresh token rotates: save the result before anything else uses it.

    Raises:
        RefreshError: The refresh failed; ``for_good`` if the tokens can no longer be refreshed.
    """
    try:
        status, body = post(
            TOKEN_URL,
            {
                "grant_type": "refresh_token",
                "client_id": account.client_id,
                "refresh_token": account.refresh_token,
                "resource": RESOURCE,
            },
        )
    except OSError as e:
        raise RefreshError(f"Could not reach OpenAI to renew the sign-in: {e}", for_good=False) from e
    if status == 200 and isinstance(body, dict) and "access_token" in body:
        return account.with_tokens(body)
    code = _error_code(body)
    message = f"Renewing the ChatGPT sign-in failed ({status}): {_error_text(body)}"
    raise RefreshError(message, for_good=code in _DEAD_REFRESH or code == "invalid_client")


def revoke(account: Account, post: PostForm = post_form, get: GetJson = get_json) -> bool:
    """Ends the account's renewable session at OpenAI. ``True`` once OpenAI confirmed it (an empty 200)."""
    if not account.refresh_token:
        return True
    try:
        endpoint = discovery(get)["revocation_endpoint"]
        for delay in (0.0, 1.0, 3.0):
            time.sleep(delay)
            status, _ = post(
                endpoint,
                {"token": account.refresh_token, "token_type_hint": "refresh_token", "client_id": account.client_id},
            )
            if status == 200:
                return True
            if status < 500:
                return False
    except (OSError, KeyError, ValueError):
        return False
    return False


# ---------------------------------------------------------------- helpers


def _random(size: int = 24) -> str:
    return _b64url(secrets.token_bytes(size))


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _error_code(body: Any) -> str | None:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            return error.get("code") or error.get("type")
        if isinstance(error, str):
            return error
    return None


def _error_text(body: Any) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error.get("code") or error)
        return str(body.get("error_description") or error or body.get("detail") or body)
    return str(body)[:300]
