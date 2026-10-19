"""Where the Alpine API is: the one setting every cloud feature reads (principle 4 in docs/alpine-cloud.md).

``ALPINE_CLOUD_URL`` in the environment wins, then ``cloud_url`` in ``config.toml``, then production. Development
(``pnpm dev``, the tests) sets the variable. The user-app domain is never kept here: it comes from ``GET /v1/meta``
and from each app's ``address``.
"""

from __future__ import annotations

import os
from importlib.metadata import PackageNotFoundError, version

import tomllib

from ..home import home_dir

DEFAULT_API_URL = "https://api.alpinecode.app"
URL_ENV = "ALPINE_CLOUD_URL"
LOCALE_ENV = "ALPINE_LOCALE"


def api_url() -> str:
    """The API's address without a trailing slash."""
    found = os.environ.get(URL_ENV) or _config_value("cloud_url") or DEFAULT_API_URL
    return found.rstrip("/")


def gateway_url() -> str:
    """The model gateway's address, the base of the ``alpine`` connection. Computed, so it follows ``api_url``."""
    return f"{api_url()}/v1/gateway"


def client_header() -> str:
    """The ``Alpine-Client`` header: which app version is asking, so the API can retire an old one (``426``)."""
    try:
        return f"alpine-code/{version('alpine-code-core')}"
    except PackageNotFoundError:
        return "alpine-code/0"


def locale() -> str:
    """The ``Accept-Language`` value: ``ALPINE_LOCALE``, else English."""
    return os.environ.get(LOCALE_ENV) or "en"


def _config_value(key: str) -> str | None:
    try:
        data = tomllib.loads((home_dir() / "config.toml").read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None  # config.py reports a broken file; here the default address is enough
    value = data.get(key)
    return value if isinstance(value, str) and value.strip() else None
