"""Local checks run before a publish: the secret scan of the built frontend and the open-API probe of the dev server.

The server runs its own secret scan on upload and that one is authoritative; these checks give the same answer
earlier so the agent can fix it before anything leaves the computer.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from . import open_api
from .patterns import BY_CODE, is_text_asset, scan_text

__all__ = ["CheckId", "Finding", "LocalReport", "open_routes", "run_local_checks", "scan_assets", "scan_text"]

CheckId = Literal["secret", "open-api"]


@dataclass(frozen=True)
class Finding:
    check: CheckId
    code: str  # "secret.stripe_live", "open_api.readable", ...
    severity: Literal["block", "warn", "info"]
    file: str | None  # relative to the project
    line: int | None
    params: Mapping[str, str]  # never a secret's full value; secrets as "sk_live_…4f2a"
    fix: str  # English instruction for the agent


@dataclass(frozen=True)
class LocalReport:
    findings: tuple[Finding, ...]
    ran: frozenset[CheckId]
    skipped: Mapping[CheckId, str]  # why, in English: "no dev server running", "no route list"


def scan_assets(folder: Path, *, root: Path | None = None) -> list[Finding]:
    """The secret scan of a built frontend folder (text files only); file names are relative to root or the folder."""
    base = root or folder
    findings: list[Finding] = []
    for path in sorted(folder.rglob("*")):
        if path.is_symlink() or not path.is_file() or not is_text_asset(path):
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        name = path.relative_to(base).as_posix() if path.is_relative_to(base) else path.name
        for code, redacted, offset in scan_text(text):
            rule = BY_CODE[code]
            line = text.count("\n", 0, offset) + 1
            findings.append(
                Finding(
                    check="secret",
                    code=code,
                    severity=rule.severity,
                    file=name,
                    line=line,
                    params={"kind": rule.kind, "redacted": redacted},
                    fix=f"A {rule.kind} ({redacted}) is in the frontend bundle ({name}, line {line}). {rule.advice}",
                )
            )
    return findings


def open_routes(dev_url: str, *, timeout: float = 10) -> tuple[list[Finding], str | None]:
    """The APIs that answer without signing in, from the running dev server. Returns (findings, skipped reason)."""
    readable, writable, skipped = open_api.probe(dev_url, timeout=timeout)
    findings = [
        Finding(
            check="open-api",
            code="open_api.readable",
            severity="warn",
            file=None,
            line=None,
            params=hit,
            fix=(
                f"{hit['method']} {hit['path']} answers with data to anyone who is not signed in. If that data is "
                "private, require a signed-in user in this route (and only return that user's own rows)."
            ),
        )
        for hit in readable
    ] + [
        Finding(
            check="open-api",
            code="open_api.writable",
            severity="warn",
            file=None,
            line=None,
            params=hit,
            fix=(
                f"{hit['method']} {hit['path']} accepts a request from anyone who is not signed in (it did not answer "
                "401, 403 or 404 to an empty request). If it changes data, require a signed-in user first."
            ),
        )
        for hit in writable
    ]
    return findings, skipped


def run_local_checks(project: Path, *, assets: Path, dev_url: str | None) -> LocalReport:
    """Both checks; blocking calls, so B runs it on a thread. Never raises for a finding; raises only OSError."""
    findings: list[Finding] = []
    ran: set[CheckId] = set()
    skipped: dict[CheckId, str] = {}
    if assets.is_dir():
        findings += scan_assets(assets, root=project)
        ran.add("secret")
    else:
        skipped["secret"] = "no build output"
    if dev_url is None:
        skipped["open-api"] = "no dev server running"
    else:
        found, reason = open_routes(dev_url)
        if reason is None:
            findings += found
            ran.add("open-api")
        else:
            skipped["open-api"] = reason
    return LocalReport(tuple(findings), frozenset(ran), skipped)
