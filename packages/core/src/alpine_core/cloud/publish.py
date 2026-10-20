"""Publishing a project to its Alpine app (올리기): ``prepare`` (build, local checks, upload, server check), ``run``
(publish and watch) and restoring (section 4.3 and 4.4 of docs/alpine-cloud-api.md).

Every function here blocks (the build, git and the API calls), so the server runs them on a thread. They report where
they are through a ``Progress`` callback; the server turns that into ``publish/changed``.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import auth, links, pro, project
from .apps import App, app_name, create_app
from .auth import AlpineTokens, SignedOut
from .build import BuildCancelled, BuildFailed, Built, build
from .client import CloudClient, CloudError, Unreachable
from .links import Published

__all__ = [
    "Cancelled",
    "NotLinked",
    "Plan",
    "PublishError",
    "Progress",
    "Status",
    "prepare",
    "restore",
    "restore_points",
    "run",
    "status",
]

#: ``(phase, progress 0..1, message, checks)``: what ``publish/changed`` carries.
Progress = Callable[[str, float, str | None, list[dict[str, Any]] | None], None]

POLL_SECONDS = 0.5
#: A deploy or a restore that takes longer than this is reported as failed rather than waited for for ever.
WATCH_TIMEOUT = 600
_KEEP_SOURCES = 20


class Cancelled(Exception):
    """``prepare`` was cancelled by the person."""


class NotLinked(Exception):
    """The project has no Alpine app yet."""


class PublishError(Exception):
    """The API accepted a publish or a restore and then it failed. ``step`` is the phase it stopped in."""

    def __init__(self, message: str, step: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.step = step


@dataclass(frozen=True)
class Status:
    publishable: bool
    reason: str | None = None
    app: App | None = None
    last_published_at: str | None = None
    changes: int = 0


@dataclass(frozen=True)
class Plan:
    deploy_id: str
    """Empty when nothing was uploaded because the local checks already block."""
    checks: list[dict[str, Any]]
    blocked: bool
    shape: dict[str, Any]
    app: App


@dataclass
class _Prepared:
    source: Published | None
    started: float = field(default_factory=time.monotonic)


_prepared: dict[str, _Prepared] = {}
_prepared_lock = threading.Lock()


# ---------------------------------------------------------------- status


def status(folder: Path, *, client: CloudClient | None = None) -> Status:
    """Whether the project can be published and what it is published as. Does not build and does not raise for an API
    that is down: the app is then unknown (``None``)."""
    reason = project.not_publishable(folder)
    if reason is not None:
        return Status(False, reason)
    description = project.read_description(folder)
    assert description is not None
    if not auth.signed_in():
        return Status(False, "signed_out")
    if project.node_missing(description):
        return Status(False, "no_node")
    link = links.get(folder)
    app = _known_app(folder, link, client or CloudClient(AlpineTokens())) if link is not None else None
    if app is not None and app.status == "taken_down":
        return Status(False, "taken_down", app, link.published.at if link is not None and link.published else None)
    published = link.published if link is not None else None
    changes = len(project.changed_paths(folder, published)) if published is not None else 0
    return Status(True, None, app, published.at if published is not None else None, changes)


def _known_app(folder: Path, link: links.Link, client: CloudClient) -> App | None:
    try:
        return App.from_api(client.get(f"/v1/apps/{link.app_id}", timeout=10)["app"])
    except CloudError as e:
        if e.status == 404:  # deleted elsewhere: the next publish makes a new one
            links.unlink(folder)
        return None
    except SignedOut:
        return None


# ---------------------------------------------------------------- prepare


def prepare(
    folder: Path,
    *,
    progress: Progress,
    dev_url: str | None = None,
    locale: str | None = None,
    cancel: threading.Event | None = None,
    client: CloudClient | None = None,
) -> Plan:
    """Builds, runs the local checks, uploads what the API does not have and asks it to check the deploy.

    A secret found by the local scan stops here: nothing is uploaded and the plan comes back blocked without a deploy.

    Raises:
        BuildFailed: With the last lines of the build's output.
        Cancelled: ``cancel`` was set.
        CloudError, SignedOut: From the API.
    """
    description = project.read_description(folder)
    if description is None or project.not_publishable(folder) is not None:
        raise BuildFailed("This project is not set up to be published (.alpine-code/cloud.toml).")
    client = client or CloudClient(AlpineTokens(), locale=locale)
    app = _ensure_app(folder, description.kind, client)
    source = project.source(folder)

    progress("build", 0, None, None)
    last_line = 0.0

    def output(line: str) -> None:
        nonlocal last_line
        if line.strip() and time.monotonic() - last_line > 0.3:
            last_line = time.monotonic()
            progress("build", 0, line[:200], None)

    try:
        # A 실시간 웹앱 builds with its live database's address and public key (never written to a file).
        built = build(folder, description, on_output=output, cancel=cancel, env=pro.build_env(folder, client=client))
    except BuildCancelled:
        raise Cancelled from None
    _check_cancel(cancel)
    progress("build", 1, None, None)

    progress("checks", 0, None, None)
    local = _local_checks(folder, built, dev_url)
    progress("checks", 1, None, local)
    if any(c["state"] == "blocked" for c in local):
        return Plan("", local, True, _empty_shape(), app)
    _check_cancel(cancel)

    deploy = client.post(f"/v1/apps/{app.id}/deploys", _manifest(description, built, source, local), timeout=60)
    deploy_id = deploy["deploy"]["id"]
    _upload(client, app.id, deploy_id, built, deploy.get("missing") or [], progress, cancel)
    checked = client.post(f"/v1/apps/{app.id}/deploys/{deploy_id}/check", timeout=120)
    checks = merge_checks(local, checked.get("checks") or [])
    progress("checks", 1, None, checks)
    with _prepared_lock:
        _prepared[deploy_id] = _Prepared(source)
        for stale in sorted(_prepared, key=lambda d: _prepared[d].started)[:-_KEEP_SOURCES]:
            del _prepared[stale]
    return Plan(
        deploy_id,
        checks,
        bool(checked.get("blocked")) or any(c["state"] == "blocked" for c in checks),
        _shape(checked.get("shape")),
        app,
    )


def _ensure_app(folder: Path, kind: str, client: CloudClient) -> App:
    """The project's app: its link, or a new app made now (a project made while signed out has none yet)."""
    link = links.get(folder)
    if link is not None:
        try:
            return App.from_api(client.get(f"/v1/apps/{link.app_id}")["app"])
        except CloudError as e:
            if e.status != 404:
                raise
            links.unlink(folder)
    app = create_app(client, app_name(folder.name), kind)
    links.link(folder, app.id)
    return app


def _check_cancel(cancel: threading.Event | None) -> None:
    if cancel is not None and cancel.is_set():
        raise Cancelled


def _local_checks(folder: Path, built: Built, dev_url: str | None) -> list[dict[str, Any]]:
    """Lane C's checks as the wire's ``Check`` shapes. ``secret`` is there only to be replaced by the server's."""
    try:
        from .checks import run_local_checks
    except ImportError:  # the checks module is not installed: nothing local is claimed, the server's scan still runs
        return []
    if built.assets_dir is None:
        return []
    report = run_local_checks(folder, assets=built.assets_dir, dev_url=dev_url)
    checks = []
    for check_id in ("secret", "open-api"):
        findings = [_finding(f) for f in report.findings if f.check == check_id]
        if check_id in report.ran:
            state = _state(findings)
        else:
            state = "skipped"
        checks.append({"id": check_id, "state": state, "findings": findings})
    return checks


def _finding(finding: Any) -> dict[str, Any]:
    return {
        "check": finding.check,
        "code": finding.code,
        "severity": finding.severity,
        "file": finding.file,
        "line": finding.line,
        "params": dict(finding.params),
        "fix": finding.fix,
    }


def _state(findings: list[dict[str, Any]]) -> str:
    if any(f["severity"] == "block" for f in findings):
        return "blocked"
    return "attention" if any(f["severity"] == "warn" for f in findings) else "ok"


def merge_checks(local: list[dict[str, Any]], server: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The sheet: the server's checks (``secret`` replaces the local one; its word is final) and the local ones the
    server does not run (``open-api``), in a stable order."""
    merged = {c["id"]: c for c in local}
    for check in server:
        merged[check["id"]] = {
            "id": check["id"],
            "state": check.get("state", "ok"),
            "findings": [_server_finding(f) for f in check.get("findings") or []],
        }
    order = {"secret": 0, "open-api": 1}
    return sorted(merged.values(), key=lambda c: order.get(c["id"], 2))


def _server_finding(finding: dict[str, Any]) -> dict[str, Any]:
    return {**finding, "params": finding.get("params") or {}, "fix": finding.get("fix") or ""}


def _empty_shape() -> dict[str, Any]:
    return {"pending": [], "added": {"tables": [], "columns": []}, "confirms": []}


def _shape(shape: Any) -> dict[str, Any]:
    shape = shape if isinstance(shape, dict) else {}
    added = shape.get("added") if isinstance(shape.get("added"), dict) else {}
    return {
        "pending": list(shape.get("pending") or []),
        "added": {"tables": list(added.get("tables") or []), "columns": list(added.get("columns") or [])},
        "confirms": list(shape.get("confirms") or []),
    }


def _manifest(
    description: project.CloudDescription, built: Built, source: Published | None, local: list[dict[str, Any]]
) -> dict[str, Any]:
    cloud: dict[str, Any] = {"version": description.version, "kind": description.kind, "adapter": description.adapter}
    if description.database_kind:
        cloud["database"] = {
            k: v for k, v in {"kind": description.database_kind, "migrations": description.migrations}.items() if v
        }
    manifest: dict[str, Any] = {
        "cloud": cloud,
        "worker": built.worker(),
        "assets": [
            {"path": a.path, "hash": a.hash, "size": a.size, "content_type": a.content_type} for a in built.assets
        ],
        "migrations": [{"name": m.name, "hash": m.hash, "size": m.size} for m in built.migrations],
        "client": {"checks": {c["id"]: c["state"] for c in local if c["state"] != "skipped"}},
    }
    if source is not None:
        manifest["source"] = {"commit": source.commit, "tree": source.tree}
    return manifest


def _upload(
    client: CloudClient,
    app_id: str,
    deploy_id: str,
    built: Built,
    missing: list[str],
    progress: Progress,
    cancel: threading.Event | None,
) -> None:
    files = built.files_by_hash()
    wanted = [h for h in dict.fromkeys(missing) if h in files]
    progress("upload", 0, None, None)
    for index, digest in enumerate(wanted):
        _check_cancel(cancel)
        client.upload(f"/v1/apps/{app_id}/deploys/{deploy_id}/files/{digest}", files[digest].read_bytes())
        progress("upload", (index + 1) / len(wanted), None, None)
    progress("upload", 1, None, None)


# ---------------------------------------------------------------- run


def run(
    folder: Path,
    deploy_id: str,
    confirm: list[str],
    *,
    progress: Progress,
    client: CloudClient | None = None,
) -> tuple[App, str]:
    """Publishes a prepared deploy and watches it until it is live. Returns the app and when it went live.

    Raises:
        CloudError: ``blocked`` (422), ``needs_confirm`` (409, ``detail.confirms``), ``conflict`` and the rest.
        PublishError: The deploy failed; the old version keeps serving or the database was restored (4.3 step 4).
        NotLinked: The project has no app.
    """
    link = links.get(folder)
    if link is None:
        raise NotLinked
    client = client or CloudClient(AlpineTokens())
    if not deploy_id:  # the plan was blocked by the local checks: nothing was uploaded, so there is nothing to publish
        app = _known_app(folder, link, client)
        if app is not None and app.status == "taken_down":
            raise CloudError(403, "taken_down", "This app was taken down.")
        raise CloudError(422, "blocked", "The checks found something that blocks publishing.")
    client.post(f"/v1/apps/{link.app_id}/deploys/{deploy_id}/publish", {"confirm": confirm})
    deploy = _watch_deploy(client, link.app_id, deploy_id, progress)
    app = App.from_api(client.get(f"/v1/apps/{link.app_id}")["app"])
    at = str(deploy.get("published_at") or deploy.get("finished_at") or _now())
    with _prepared_lock:
        prepared = _prepared.pop(deploy_id, None)
    source = prepared.source if prepared is not None else project.source(folder)
    if source is not None:
        links.record_published(folder, Published(source.commit, source.tree, at))
    _end_dev_branch(folder, client)
    return app, at


def _end_dev_branch(folder: Path, client: CloudClient) -> None:
    """The AI's working database goes after a publish (section 4.11). The publish itself is done, so a failure here is
    not one; the next session start finds the branch gone or still there and sorts it out."""
    try:
        pro.delete_dev_branch(folder, client=client)
    except (CloudError, SignedOut):
        pass


def _watch_deploy(client: CloudClient, app_id: str, deploy_id: str, progress: Progress) -> dict[str, Any]:
    seen: dict[str, str] = {}
    deadline = time.monotonic() + WATCH_TIMEOUT
    misses = 0
    while True:
        try:
            deploy = client.get(f"/v1/apps/{app_id}/deploys/{deploy_id}")["deploy"]
            misses = 0
        except Unreachable:
            misses += 1  # a blip does not undo a publish that is running on the server
            if misses > 20:
                raise
            time.sleep(POLL_SECONDS)
            continue
        steps = deploy.get("steps") or []
        for step in steps:
            name, state = step.get("step"), step.get("state")
            if isinstance(name, str) and state != seen.get(name):
                seen[name] = state
                if state in ("running", "done"):
                    progress(name, 1.0 if state == "done" else 0.0, None, None)
        state = deploy.get("status")
        if state == "live":
            return deploy
        if state in ("failed", "replaced"):
            failed = next((s.get("step") for s in steps if s.get("state") == "failed"), None)
            raise PublishError(str(deploy.get("error") or f"The publish ended {state}."), failed)
        if time.monotonic() > deadline:
            raise PublishError(
                "The publish took too long.", next((s.get("step") for s in steps if s.get("state") == "running"), None)
            )
        time.sleep(POLL_SECONDS)


# ---------------------------------------------------------------- restore


def restore_points(folder: Path, *, client: CloudClient | None = None) -> dict[str, Any]:
    """``{"points": [{id, at, reason}], "window_days"}`` of the project's app. Raises ``NotLinked``."""
    link = links.get(folder)
    if link is None:
        raise NotLinked
    body = (client or CloudClient(AlpineTokens())).get(f"/v1/apps/{link.app_id}/restore-points")
    return {
        "points": [
            {"id": p["id"], "at": p.get("at", ""), "reason": p.get("reason", "manual")}
            for p in body.get("points") or []
        ],
        "window_days": int(body.get("window_days") or 0),
    }


def create_restore_point(folder: Path, *, client: CloudClient | None = None) -> dict[str, Any]:
    """A ``manual`` restore point, for before something risky."""
    link = links.get(folder)
    if link is None:
        raise NotLinked
    body = (client or CloudClient(AlpineTokens())).post(f"/v1/apps/{link.app_id}/restore-points")
    return body["point"]


def restore(folder: Path, point: str, *, client: CloudClient | None = None) -> None:
    """Puts the app's data and code back to ``point`` (the API takes a ``before_restore`` point first) and returns
    when it is done.

    Raises:
        PublishError: The restore failed.
    """
    link = links.get(folder)
    if link is None:
        raise NotLinked
    client = client or CloudClient(AlpineTokens())
    # What is live after the restore is the code that was live at the point (the API's ``source``).
    listed = client.get(f"/v1/apps/{link.app_id}/restore-points")
    source = next((p.get("source") for p in listed.get("points") or [] if p.get("id") == point), None)
    started = client.post(f"/v1/apps/{link.app_id}/restore", {"point": point})
    restore_id = started["restore"]["id"]
    deadline = time.monotonic() + WATCH_TIMEOUT
    while True:
        done = client.get(f"/v1/apps/{link.app_id}/restores/{restore_id}")["restore"]
        if done.get("status") == "done":
            commit, tree = (source.get("commit"), source.get("tree")) if isinstance(source, dict) else (None, None)
            if isinstance(commit, str) and isinstance(tree, str):
                links.record_published(folder, Published(commit, tree, _now()))
            else:  # nothing was live, or the deploy sent no source: no source to compare with
                links.clear_published(folder)
            return
        if done.get("status") == "failed":
            raise PublishError(str(done.get("error") or "The restore failed."))
        if time.monotonic() > deadline:
            raise PublishError("The restore took too long.")
        time.sleep(POLL_SECONDS)


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
