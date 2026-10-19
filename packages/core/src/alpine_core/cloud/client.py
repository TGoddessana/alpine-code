"""JSON over HTTP to the Alpine API, with the headers it expects and one refresh on a ``401``.

Calls block (``urllib``); async callers run them with ``asyncio.to_thread``. Errors carry the API's ``{error: {code,
message, detail}}`` (section 2.3 of the contract); the app words them by ``code``.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Protocol

from . import settings


class CloudError(Exception):
    """The API answered with an error, or could not be reached (``status`` 0, ``code`` ``unreachable``)."""

    def __init__(self, status: int, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.detail = detail or {}

    def __str__(self) -> str:
        return f"{self.message} ({self.code})"


class Unreachable(CloudError):
    """No answer from the API: offline, a wrong address, a timeout."""

    def __init__(self, message: str) -> None:
        super().__init__(0, "unreachable", message)


class TokenSource(Protocol):
    """What ``CloudClient`` needs to sign a request. ``auth.AlpineTokens`` is the one that matters."""

    def access_token(self) -> str: ...

    def refresh_after_rejection(self, rejected: str) -> str: ...


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None  # a redirect is an answer here (the sign-in's authorize step is opened by a browser, not by us)


_opener = urllib.request.build_opener(_NoRedirect)


def send(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30,
) -> tuple[int, dict[str, str], bytes]:
    """One request. Returns ``(status, headers, body)`` for any HTTP status.

    Raises:
        Unreachable: The connection failed or timed out.
    """
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with _opener.open(request, timeout=timeout) as response:
            return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()
    except urllib.error.HTTPError as e:
        with e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise Unreachable(f"Could not reach {urllib.parse.urlsplit(url).netloc}: {e}") from e


class CloudClient:
    """Calls to the API. ``tokens`` signs them; without it only open endpoints (``/v1/meta``, sign-in) work."""

    def __init__(self, tokens: TokenSource | None = None, *, base_url: str | None = None, locale: str | None = None):
        self.tokens = tokens
        self._base_url = base_url
        self._locale = locale

    @property
    def base_url(self) -> str:
        return (self._base_url or settings.api_url()).rstrip("/")

    def json(
        self,
        method: str,
        path: str,
        body: Any = None,
        *,
        query: dict[str, Any] | None = None,
        auth: bool = True,
        timeout: float = 30,
    ) -> Any:
        """The JSON answer (``None`` for an empty one).

        Raises:
            CloudError: The API answered with an error.
            Unreachable: No answer.
            auth.SignedOut: ``auth`` and nobody is signed in.
        """
        data = None if body is None else json.dumps(body).encode()
        return self._call(method, path, data, "application/json", query, auth, timeout)

    def upload(self, path: str, data: bytes, *, auth: bool = True, timeout: float = 300) -> Any:
        """``PUT`` raw bytes (a deploy's files)."""
        return self._call("PUT", path, data, "application/octet-stream", None, auth, timeout)

    def get(self, path: str, **kwargs: Any) -> Any:
        return self.json("GET", path, **kwargs)

    def post(self, path: str, body: Any = None, **kwargs: Any) -> Any:
        return self.json("POST", path, {} if body is None else body, **kwargs)

    def _call(
        self,
        method: str,
        path: str,
        data: bytes | None,
        content_type: str,
        query: dict[str, Any] | None,
        auth: bool,
        timeout: float,
    ) -> Any:
        url = self.base_url + path
        if query:
            url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
        token = self.tokens.access_token() if auth and self.tokens is not None else None
        if auth and self.tokens is None:
            raise CloudError(401, "unauthorized", "Not signed in.")
        status, headers, raw = self._send(method, url, data, content_type, token, timeout)
        if status == 401 and token is not None and self.tokens is not None:
            token = self.tokens.refresh_after_rejection(token)  # once; a second 401 is the answer
            status, headers, raw = self._send(method, url, data, content_type, token, timeout)
        return _result(status, raw)

    def _send(
        self, method: str, url: str, data: bytes | None, content_type: str, token: str | None, timeout: float
    ) -> tuple[int, dict[str, str], bytes]:
        headers = {
            "Accept": "application/json",
            "Alpine-Client": settings.client_header(),
            "Accept-Language": self._locale or settings.locale(),
        }
        if data is not None:
            headers["Content-Type"] = content_type
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return send(method, url, body=data, headers=headers, timeout=timeout)


def _result(status: int, raw: bytes) -> Any:
    try:
        body = json.loads(raw) if raw else None
    except ValueError:
        body = None
    if 200 <= status < 300:
        return body
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        detail = error.get("detail")
        raise CloudError(
            status,
            str(error.get("code") or "upstream"),
            str(error.get("message") or f"The API answered {status}."),
            detail if isinstance(detail, dict) else None,
        )
    raise CloudError(status, "upstream", f"The API answered {status}.")
