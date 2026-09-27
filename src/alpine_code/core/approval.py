"""How the core asks a frontend whether a tool call may run."""

from __future__ import annotations

import difflib
from dataclasses import dataclass, replace
from typing import Any, Literal, Protocol

from .tools import Workspace, preview_edit

#: Most diff lines put in a preview.
MAX_PREVIEW_LINES = 200


@dataclass(frozen=True)
class ApprovalRequest:
    tool: str
    args: dict[str, Any]
    title: str
    """One line saying what the call does, e.g. ``Edit src/app.py``."""
    preview: str | None = None
    """What will change: a unified diff for write/edit, the command for bash."""
    preview_kind: Literal["diff", "command", "text"] = "text"
    reason: str | None = None
    """Why this call needs approval beyond the permission mode, e.g. ``outside the working directory``."""
    remember: str | None = None
    """What "don't ask again" would allow, e.g. ``bash commands starting with `git status```. ``None`` when
    nothing can safely be remembered; a frontend then offers only yes and no."""


@dataclass(frozen=True)
class Decision:
    """The user's answer.

    - ``allow``: run this call
    - ``allow_always``: run it, and do not ask again for what ``ApprovalRequest.remember`` describes
    - ``deny`` with ``feedback``: skip the call and tell the model what to do instead; the run continues
    - ``deny`` without ``feedback``: skip the call and stop the run, waiting for the user's next message
    """

    kind: Literal["allow", "allow_always", "deny"]
    feedback: str | None = None


class Approver(Protocol):
    """Implemented by a frontend. Called on the thread running ``Session.send``, one call at a time."""

    def approve(self, request: ApprovalRequest) -> Decision: ...


def describe(
    name: str, args: dict[str, Any], workspace: Workspace, *, reason: str | None = None, remember: str | None = None
) -> ApprovalRequest:
    """Builds the request shown to the user for one tool call."""
    request = _describe(name, args, workspace)
    return replace(request, reason=reason, remember=remember)


def _describe(name: str, args: dict[str, Any], workspace: Workspace) -> ApprovalRequest:
    path = str(args.get("path", ""))
    if name == "bash":
        return ApprovalRequest(name, args, "Run command", str(args.get("command", "")), "command")
    if name == "edit":
        change = preview_edit(workspace, args)
        diff = _diff(path, *change) if change else None
        return ApprovalRequest(name, args, f"Edit {path}", diff, "diff")
    if name == "write":
        file = workspace.resolve(path)
        before = file.read_text(encoding="utf-8", errors="replace") if file.is_file() else ""
        verb = "Overwrite" if file.is_file() else "Create"
        return ApprovalRequest(name, args, f"{verb} {path}", _diff(path, before, str(args.get("content", ""))), "diff")
    if name in ("read", "glob", "grep"):
        target = args.get("pattern") or path or "."
        return ApprovalRequest(name, args, f"{name.capitalize()} {target}", None, "text")
    return ApprovalRequest(name, args, f"Use {name}", repr(args), "text")


def _diff(path: str, before: str, after: str) -> str:
    lines = list(
        difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True), f"a/{path}", f"b/{path}", n=3
        )
    )
    if len(lines) > MAX_PREVIEW_LINES:
        lines = lines[:MAX_PREVIEW_LINES] + [f"... {len(lines) - MAX_PREVIEW_LINES} more diff lines\n"]
    return "".join(line if line.endswith("\n") else line + "\n" for line in lines)
