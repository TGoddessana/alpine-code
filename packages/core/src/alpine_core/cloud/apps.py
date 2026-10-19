"""Alpine apps through the API: what a project publishes to (``POST /v1/apps`` and friends)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .client import CloudClient, CloudError


@dataclass(frozen=True)
class App:
    id: str
    name: str
    kind: str
    address: str
    url: str
    status: str
    badge: bool = True

    @classmethod
    def from_api(cls, app: dict[str, Any]) -> App:
        return cls(
            id=app["id"],
            name=app.get("name", ""),
            kind=app.get("kind", ""),
            address=app.get("address", ""),
            url=app.get("url", ""),
            status=app.get("status", "empty"),
            badge=bool(app.get("badge", True)),
        )


def app_name(folder_name: str) -> str:
    """The app name from a project folder's: the API wants 3 to 40 characters of letters, digits and ``-``."""
    return folder_name if len(folder_name) >= 3 else f"{folder_name}-app"


def create_app(client: CloudClient, name: str, kind: str) -> App:
    """``POST /v1/apps``. A taken name is tried once more with the API's suggestion, so creating never fails on it.

    Raises:
        CloudError: Anything else (``limit_reached``, ``payment_required``, ``unreachable``...).
    """
    try:
        body = client.post("/v1/apps", {"name": name, "kind": kind})
    except CloudError as e:
        suggestion = e.detail.get("suggestion") if e.code == "name_taken" else None
        if not isinstance(suggestion, str):
            raise
        body = client.post("/v1/apps", {"name": suggestion, "kind": kind})
    return App.from_api(body["app"])
