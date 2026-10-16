"""Signing in to GitHub, for the app's clone dialog: the repositories the user can get, and a token git can use.

GitHub's device flow (docs.github.com, "Authorizing OAuth apps"): the app shows a short code, the user enters it on
github.com/login/device, and the app polls until GitHub hands over a token. Only the OAuth app's client id is needed,
no secret, so the flow is safe in an app anyone can download. The token has the ``repo`` scope: reading private
repositories over git needs it, and GitHub has no read-only scope for OAuth apps.

The sign-in is kept in ``auth.json`` under ``@github`` (not a model connection's name). An app that opted into expiring
tokens gets an 8-hour token and a refresh token; ``access_token`` refreshes it when due.

HTTP goes through ``request`` (``urllib``, run on a thread by async callers), which tests replace.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from enum import StrEnum
from typing import Any

from .secrets import OAuthTokens

#: The OAuth app "AlpineCode" registered on GitHub, with the device flow on. ``ALPINE_GITHUB_CLIENT_ID`` overrides it
#: (another app, tests). Empty: GitHub sign-in is not offered.
CLIENT_ID = ""
SCOPE = "repo"
DEVICE_CODE_URL = "https://github.com/login/device/code"
TOKEN_URL = "https://github.com/login/oauth/access_token"
API = "https://api.github.com"
DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"
#: The key in ``auth.json``.
STORE_NAME = "@github"
#: Refresh an expiring token this long before it runs out.
REFRESH_MARGIN = 300.0
#: GitHub lists 100 repositories a page; past this many pages the user searches by address instead.
MAX_PAGES = 10

Request = Callable[[str, str, dict[str, str] | None, str | None], tuple[int, Any]]
"""``(method, url, form fields or None, token or None) -> (status, parsed JSON body)``."""


def client_id() -> str:
    return os.environ.get("ALPINE_GITHUB_CLIENT_ID") or CLIENT_ID


def access_settings_url() -> str:
    """Where the user sees AlpineCode's access on GitHub: revoke it, or ask an organization to allow it."""
    return f"https://github.com/settings/connections/applications/{client_id()}"


# ---------------------------------------------------------------- HTTP


def request(method: str, url: str, fields: dict[str, str] | None = None, token: str | None = None) -> tuple[int, Any]:
    headers = {"Accept": "application/json", "User-Agent": "AlpineCode"}
    data = None
    if fields is not None:
        data = urllib.parse.urlencode(fields).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
        headers["X-GitHub-Api-Version"] = "2022-11-28"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, _parse(response.read())
    except urllib.error.HTTPError as e:
        return e.code, _parse(e.read())


def _parse(body: bytes) -> Any:
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return body.decode("utf-8", errors="replace")


# ---------------------------------------------------------------- signing in


class SignInErrorKind(StrEnum):
    DECLINED = "declined"
    TIMED_OUT = "timed_out"
    FAILED = "failed"


class SignInError(Exception):
    """The sign-in ended without a token. ``declined``: the user said no on GitHub. ``timed_out``: the code was not
    entered in time (15 minutes). ``failed``: anything else; the message says what."""

    def __init__(self, kind: SignInErrorKind, message: str) -> None:
        super().__init__(message)
        self.kind = kind


class GitHubUnavailable(Exception):
    """GitHub could not be reached, or did not answer as expected."""


class SignedOut(Exception):
    """No usable sign-in: never signed in, signed out, or GitHub no longer accepts the token."""


@dataclass(frozen=True)
class Account:
    login: str
    token: str
    refresh_token: str | None = None
    expires_at: float | None = None
    """Seconds since the epoch; ``None`` for a token that does not expire."""

    def to_record(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_record(cls, record: dict[str, Any]) -> Account | None:
        if not isinstance(record.get("login"), str) or not isinstance(record.get("token"), str):
            return None
        return cls(record["login"], record["token"], record.get("refresh_token"), record.get("expires_at"))


@dataclass(frozen=True)
class DeviceCode:
    user_code: str
    """What the user types on GitHub, like ``WDJB-MJHT``."""
    verification_uri: str
    device_code: str
    interval: float
    expires_at: float


Sleep = Callable[[float], Awaitable[None]]


class SignIn:
    """One device-flow sign-in: ``start`` gets the code to show, ``wait`` returns the account once the user
    entered it, ``cancel`` stops waiting (``wait`` then raises ``CancelledError``)."""

    def __init__(self, code: DeviceCode, call: Request, sleep: Sleep, clock: Callable[[], float]) -> None:
        self.code = code
        self._call = call
        self._sleep = sleep
        self._clock = clock
        self._cancelled = asyncio.Event()

    @classmethod
    async def start(
        cls,
        call: Request = request,
        sleep: Sleep = asyncio.sleep,
        clock: Callable[[], float] = time.time,
    ) -> SignIn:
        """Asks GitHub for a code.

        Raises:
            SignInError: GitHub refused (``failed``: no client id, or the device flow is off for the app).
            GitHubUnavailable: GitHub could not be reached.
        """
        if not client_id():
            raise SignInError(SignInErrorKind.FAILED, "No GitHub client id is set")
        status, body = await _off_thread(call, "POST", DEVICE_CODE_URL, {"client_id": client_id(), "scope": SCOPE})
        if status != 200 or not isinstance(body, dict) or "device_code" not in body:
            raise SignInError(SignInErrorKind.FAILED, _error(body, status))
        code = DeviceCode(
            user_code=body["user_code"],
            verification_uri=body.get("verification_uri", "https://github.com/login/device"),
            device_code=body["device_code"],
            interval=float(body.get("interval", 5)),
            expires_at=clock() + float(body.get("expires_in", 900)),
        )
        return cls(code, call, sleep, clock)

    def cancel(self) -> None:
        self._cancelled.set()

    async def wait(self) -> Account:
        """Polls GitHub no faster than it asks until the user entered the code, then reads who signed in.

        Raises:
            SignInError: declined, timed out, or failed.
            asyncio.CancelledError: ``cancel`` was called.
        """
        interval = self.code.interval
        fields = {"client_id": client_id(), "device_code": self.code.device_code, "grant_type": DEVICE_GRANT}
        while True:
            await self._pause(interval)
            if self._clock() >= self.code.expires_at:
                raise SignInError(SignInErrorKind.TIMED_OUT, "The code was not entered in time")
            try:
                status, body = await _off_thread(self._call, "POST", TOKEN_URL, fields)
            except OSError:
                continue  # a dropped connection; the code is still good until it expires
            error = body.get("error") if isinstance(body, dict) else None
            if error == "authorization_pending":
                continue
            if error == "slow_down":
                interval = float(body.get("interval", interval + 5))
                continue
            if error == "expired_token":
                raise SignInError(SignInErrorKind.TIMED_OUT, "The code was not entered in time")
            if error == "access_denied":
                raise SignInError(SignInErrorKind.DECLINED, "Declined on GitHub")
            if status != 200 or not isinstance(body, dict) or "access_token" not in body:
                raise SignInError(SignInErrorKind.FAILED, _error(body, status))
            return await self._account(body)

    async def _account(self, body: dict[str, Any]) -> Account:
        token = body["access_token"]
        status, user = await _off_thread(self._call, "GET", f"{API}/user", None, token)
        if status != 200 or not isinstance(user, dict) or not isinstance(user.get("login"), str):
            raise SignInError(SignInErrorKind.FAILED, _error(user, status))
        expires = body.get("expires_in")
        return Account(
            login=user["login"],
            token=token,
            refresh_token=body.get("refresh_token"),
            expires_at=self._clock() + float(expires) if expires else None,
        )

    async def _pause(self, seconds: float) -> None:
        """Sleeps, or raises ``CancelledError`` as soon as the sign-in is cancelled."""
        sleeping = asyncio.ensure_future(self._sleep(seconds))
        cancelled = asyncio.ensure_future(self._cancelled.wait())
        try:
            await asyncio.wait({sleeping, cancelled}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            sleeping.cancel()
            cancelled.cancel()
        if self._cancelled.is_set():
            raise asyncio.CancelledError()


async def _off_thread(call: Request, method: str, url: str, fields=None, token=None) -> tuple[int, Any]:
    return await asyncio.to_thread(call, method, url, fields, token)


def _error(body: Any, status: int) -> str:
    if isinstance(body, dict):
        return str(body.get("error_description") or body.get("message") or body.get("error") or f"HTTP {status}")
    return f"HTTP {status}"


# ---------------------------------------------------------------- the saved sign-in


def saved_account(store: OAuthTokens) -> Account | None:
    record = store.get_oauth(STORE_NAME)
    return Account.from_record(record) if record else None


def save_account(store: OAuthTokens, account: Account) -> None:
    with store.locked():
        store.set_oauth(STORE_NAME, account.to_record())


def forget_account(store: OAuthTokens) -> bool:
    """Forgets the sign-in here. GitHub keeps the grant until the user revokes it (``access_settings_url``): taking it
    back from the app's side needs the client secret, which a downloadable app cannot hold."""
    with store.locked():
        if store.get_oauth(STORE_NAME) is None:
            return False
        delete = getattr(store, "delete", None)
        if delete is not None:
            delete(STORE_NAME)
        else:
            store.set_oauth(STORE_NAME, {})
        return True


def access_token(store: OAuthTokens, call: Request = request, clock: Callable[[], float] = time.time) -> Account:
    """The saved account with a usable token, refreshed first when it is about to run out.

    Raises:
        SignedOut: There is no sign-in, or its refresh token was refused.
        GitHubUnavailable: The refresh could not reach GitHub.
    """
    with store.locked():
        account = saved_account(store)
        if account is None:
            raise SignedOut("Not signed in to GitHub")
        if account.expires_at is None or account.expires_at - clock() > REFRESH_MARGIN:
            return account
        if not account.refresh_token:
            raise SignedOut("The GitHub sign-in ran out")
        fields = {"client_id": client_id(), "grant_type": "refresh_token", "refresh_token": account.refresh_token}
        try:
            status, body = call("POST", TOKEN_URL, fields, None)
        except OSError as e:
            raise GitHubUnavailable(str(e)) from e
        if status != 200 or not isinstance(body, dict) or "access_token" not in body:
            raise SignedOut(_error(body, status))
        expires = body.get("expires_in")
        renewed = Account(
            login=account.login,
            token=body["access_token"],
            refresh_token=body.get("refresh_token", account.refresh_token),
            expires_at=clock() + float(expires) if expires else None,
        )
        store.set_oauth(STORE_NAME, renewed.to_record())
        return renewed


# ---------------------------------------------------------------- repositories


@dataclass(frozen=True)
class Repository:
    full_name: str
    """``owner/name``."""
    clone_url: str
    private: bool
    pushed_at: str | None
    """ISO 8601, the last push."""
    description: str | None


def repositories(token: str, call: Request = request) -> list[Repository]:
    """Every repository the token can see (the user's own, collaborations, and organizations that allow the app),
    the most recently pushed first.

    Raises:
        SignedOut: GitHub no longer accepts the token.
        GitHubUnavailable: GitHub could not be reached or failed.
    """
    found: list[Repository] = []
    for page in range(1, MAX_PAGES + 1):
        query = urllib.parse.urlencode(
            {
                "per_page": 100,
                "page": page,
                "sort": "pushed",
                "affiliation": "owner,collaborator,organization_member",
            }
        )
        try:
            status, body = call("GET", f"{API}/user/repos?{query}", None, token)
        except OSError as e:
            raise GitHubUnavailable(str(e)) from e
        if status == 401:
            raise SignedOut(_error(body, status))
        if status != 200 or not isinstance(body, list):
            raise GitHubUnavailable(_error(body, status))
        found.extend(
            Repository(
                full_name=item["full_name"],
                clone_url=item["clone_url"],
                private=bool(item.get("private")),
                pushed_at=item.get("pushed_at"),
                description=item.get("description"),
            )
            for item in body
            if isinstance(item, dict) and "full_name" in item and "clone_url" in item
        )
        if len(body) < 100:
            break
    return found
