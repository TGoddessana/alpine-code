"""What Pro adds to a project (sections 4.11 and 4.12 of docs/alpine-cloud-api.md): the 실시간 웹앱's database while the
AI works (a dev branch), the values its build needs, custom domains, and the badge.

Keys and URLs of the app's database are never logged or returned from here: ``ensure_dev_branch`` writes them to the
project's ``.env.development.local`` and ``build_env`` hands them to the build command's environment.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from . import links, project
from .apps import App
from .auth import AlpineTokens
from .client import CloudClient, CloudError

__all__ = [
    "DevBranchFailed",
    "add_domain",
    "build_env",
    "check_domain",
    "delete_dev_branch",
    "domains",
    "ensure_dev_branch",
    "needs_dev_branch",
    "remove_domain",
    "set_badge",
    "uses_dev_branch",
]

#: The file the template's dev server reads and its ``.gitignore`` hides.
ENV_FILE = ".env.development.local"
ENV_KEYS = ("VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY")
POLL_SECONDS = 1.0
#: A branch that is not ready after this long is given up on; the AI works without a database then.
READY_TIMEOUT = 180.0


class DevBranchFailed(Exception):
    """The dev branch could not be made ready."""


def uses_dev_branch(folder: Path) -> bool:
    """Whether ``folder`` is a 실시간 웹앱 (``kind = "web-pro"``) project."""
    description = project.read_description(folder)
    return description is not None and description.kind == "web-pro"


def needs_dev_branch(folder: Path) -> bool:
    """Whether a session in ``folder`` should have a dev branch and does not yet: a web-pro project linked to an app,
    without both values in its ``.env.development.local``. Local only, no network."""
    if not uses_dev_branch(folder) or links.get(folder) is None:
        return False
    return not all(key in _read_env(folder / ENV_FILE) for key in ENV_KEYS)


def ensure_dev_branch(folder: Path, *, client: CloudClient | None = None) -> bool:
    """Makes the app's dev branch, waits until it is ready and writes its address and public key into the project's
    ``.env.development.local``. ``False`` when there is nothing to do (not web-pro, no app).

    Raises:
        DevBranchFailed: The branch did not become ready.
        CloudError: From the API (``payment_required`` when the plan ended...).
    """
    link = links.get(folder)
    if link is None or not uses_dev_branch(folder):
        return False
    client = client or CloudClient(AlpineTokens())
    path = f"/v1/apps/{link.app_id}/dev-branch"
    try:
        branch = client.get(path)["branch"]
    except CloudError as e:
        if e.status != 404:
            raise
        branch = client.post(path)["branch"]
    deadline = time.monotonic() + READY_TIMEOUT
    while branch.get("status") != "ready":
        if branch.get("status") == "failed" or time.monotonic() > deadline:
            raise DevBranchFailed("The database for working on this app did not get ready.")
        time.sleep(POLL_SECONDS)
        branch = client.get(path)["branch"]
    _write_env(folder / ENV_FILE, {ENV_KEYS[0]: branch["url"], ENV_KEYS[1]: branch["anon_key"]})
    return True


def delete_dev_branch(folder: Path, *, client: CloudClient | None = None) -> None:
    """Removes the dev branch after a publish and the two values from ``.env.development.local``. A branch the API
    does not have any more is fine."""
    link = links.get(folder)
    if link is None or not uses_dev_branch(folder):
        return
    try:
        (client or CloudClient(AlpineTokens())).json("DELETE", f"/v1/apps/{link.app_id}/dev-branch")
    except CloudError as e:
        if e.status != 404:
            raise
    _write_env(folder / ENV_FILE, {}, drop=ENV_KEYS)


def build_env(folder: Path, *, client: CloudClient | None = None) -> dict[str, str]:
    """The values a web-pro build needs (``GET /v1/apps/{id}/build-env``). They go into the build command's environment
    and nowhere else. Empty for other kinds of project."""
    link = links.get(folder)
    if link is None or not uses_dev_branch(folder):
        return {}
    body = (client or CloudClient(AlpineTokens())).get(f"/v1/apps/{link.app_id}/build-env")
    env = body.get("env") if isinstance(body, dict) else None
    return {str(k): str(v) for k, v in env.items()} if isinstance(env, dict) else {}


# ---------------------------------------------------------------- domains and the badge


def domains(folder: Path, *, client: CloudClient | None = None) -> list[dict[str, Any]]:
    link = _linked(folder)
    return (client or CloudClient(AlpineTokens())).get(f"/v1/apps/{link.app_id}/domains").get("domains") or []


def add_domain(folder: Path, domain: str, mail: bool, *, client: CloudClient | None = None) -> dict[str, Any]:
    link = _linked(folder)
    body = (client or CloudClient(AlpineTokens())).post(
        f"/v1/apps/{link.app_id}/domains", {"domain": domain, "mail": mail}
    )
    return body["domain"]


def check_domain(folder: Path, domain_id: str, *, client: CloudClient | None = None) -> dict[str, Any]:
    link = _linked(folder)
    return (client or CloudClient(AlpineTokens())).get(f"/v1/apps/{link.app_id}/domains/{domain_id}")["domain"]


def remove_domain(folder: Path, domain_id: str, *, client: CloudClient | None = None) -> None:
    link = _linked(folder)
    (client or CloudClient(AlpineTokens())).json("DELETE", f"/v1/apps/{link.app_id}/domains/{domain_id}")


def set_badge(folder: Path, badge: bool, *, client: CloudClient | None = None) -> App:
    """Shows or hides the "made with Alpine" badge (hiding is Pro: ``payment_required`` on Free)."""
    link = _linked(folder)
    body = (client or CloudClient(AlpineTokens())).json("PATCH", f"/v1/apps/{link.app_id}", {"badge": badge})
    return App.from_api(body["app"])


def _linked(folder: Path) -> links.Link:
    from .publish import NotLinked  # publish imports this module

    link = links.get(folder)
    if link is None:
        raise NotLinked
    return link


# ---------------------------------------------------------------- .env.development.local


def _read_env(path: Path) -> dict[str, str]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return {}
    values = {}
    for line in lines:
        key, sep, value = line.partition("=")
        if sep and key.strip() and not key.lstrip().startswith("#"):
            values[key.strip()] = value.strip()
    return values


def _write_env(path: Path, values: dict[str, str], *, drop: tuple[str, ...] = ()) -> None:
    """Sets ``values`` and removes ``drop`` in an env file, keeping every other line. The file is deleted when nothing
    is left. Written privately and atomically."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        lines = []
    kept = [line for line in lines if line.partition("=")[0].strip() not in (*values, *drop)]
    kept += [f"{key}={value}" for key, value in values.items()]
    if not any(line.strip() for line in kept):
        path.unlink(missing_ok=True)
        return
    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(kept) + "\n")
    os.replace(tmp, path)
