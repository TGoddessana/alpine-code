"""The open-api check: which of the app's APIs answer without signing in, asked of the running dev server."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Mapping

ROUTE_LIST = "/api/dev/routes"
_MAX_ROUTES = 200
_MAX_BODY = 1_000_000
_PROBED_AWAY = (401, 403, 404)  # the answers of a route that is locked
_WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


# No cookie jar, no redirects: a route that sends you to sign in is locked.
_opener = urllib.request.build_opener(_NoRedirect)


def _send(method: str, url: str, timeout: float) -> tuple[int, bytes]:
    """Status and body of one request without content or cookies. Connection problems propagate as URLError."""
    request = urllib.request.Request(url, method=method, headers={"Accept": "application/json"})
    if method != "GET":
        request.add_header("Content-Length", "0")
    try:
        with _opener.open(request, timeout=timeout) as response:
            return response.status, response.read(_MAX_BODY)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.read(_MAX_BODY)


def _has_path_params(path: str) -> bool:
    return any(c in path for c in ":{*")


def _non_empty_json(body: bytes) -> bool:
    try:
        value = json.loads(body)
    except ValueError:
        return False
    return value not in (None, "", [], {})


def _routes(listing: bytes) -> list[tuple[str, str]] | None:
    try:
        entries = json.loads(listing)["routes"]
        routes = [(str(e["method"]).upper(), str(e["path"])) for e in entries]
    except (ValueError, KeyError, TypeError):
        return None
    seen: dict[tuple[str, str], None] = {}
    for method, path in routes:
        if path.startswith("/") and not path.startswith("/api/dev/"):
            seen[(method, path)] = None
    return list(seen)[:_MAX_ROUTES]


def probe(dev_url: str, *, timeout: float = 10) -> tuple[list[Mapping[str, str]], list[Mapping[str, str]], str | None]:
    """(readable, writable, skipped reason); each hit is {method, path}."""
    base = dev_url.rstrip("/")
    try:
        status, body = _send("GET", base + ROUTE_LIST, timeout)
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
        return [], [], "no dev server running"
    routes = _routes(body) if status == 200 else None
    if routes is None:
        return [], [], "no route list"
    readable: list[Mapping[str, str]] = []
    writable: list[Mapping[str, str]] = []
    for method, path in routes:
        if _has_path_params(path):
            continue
        if method != "GET" and method not in _WRITE_METHODS:
            continue
        try:
            status, body = _send(method, base + path, timeout)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            continue  # one route that does not answer says nothing about it
        if method == "GET":
            if 200 <= status < 300 and _non_empty_json(body):
                readable.append({"method": method, "path": path})
        elif status not in _PROBED_AWAY:
            writable.append({"method": method, "path": path})
    return readable, writable, None
