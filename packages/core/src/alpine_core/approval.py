"""How the core asks a frontend whether a tool call may run.

``DecideByApprover`` is the permission the Agent runs: it lets through what the ``PermissionPolicy`` allows and asks the
frontend's ``Approver`` about the rest.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from alpineagents import State, Tool, ToolCall
from alpineagents.permissions import Allowed, DecidePermission, Denied

from .permissions import PermissionPolicy, Verdict
from .tools import Workspace, preview_edit

#: Most diff lines put in a preview.
MAX_PREVIEW_LINES = 200

DECLINED = "The user declined this tool call."

PreviewKind = Literal["diff", "command", "text"]


@dataclass(frozen=True)
class ApprovalRequest:
    tool: str
    args: dict[str, Any]
    title: str
    """One line saying what the call does, e.g. ``Edit src/app.py``."""
    preview: str | None = None
    """What will change: a unified diff for write/edit, the command for bash."""
    preview_kind: PreviewKind = "text"
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


class DecideByApprover(DecidePermission):
    """Allows what the policy allows; asks the approver about everything else."""

    def __init__(self, policy: PermissionPolicy, approver: Approver) -> None:
        self.policy = policy
        self.approver = approver

    def check(self, state: State, call: ToolCall, tool: Tool) -> Allowed | Denied:
        args = dict(call.args)
        verdict = self.policy.evaluate(call.name, args, tool)
        if verdict.allowed:
            return Allowed()
        decision = self.approver.approve(describe(call.name, args, self.policy.workspace, verdict))
        if decision.kind == "allow_always" and verdict.grant is not None:
            self.policy.remember(verdict.grant)
        if decision.kind != "deny":
            return Allowed()
        if decision.feedback:
            return Denied(f"{DECLINED} They said: {decision.feedback}")
        return Denied(f"{DECLINED} Wait for their next message.", stop=True)


def describe(name: str, args: dict[str, Any], workspace: Workspace, verdict: Verdict) -> ApprovalRequest:
    """Builds the request shown to the user for one tool call."""
    title, preview, kind = _preview(name, args, workspace)
    return ApprovalRequest(name, args, title, preview, kind, reason=verdict.reason, remember=verdict.remember)


def _preview(name: str, args: dict[str, Any], workspace: Workspace) -> tuple[str, str | None, PreviewKind]:
    """The title, the preview and what kind of preview it is."""
    path = str(args.get("path", ""))
    match name:
        case "bash":
            return "Run command", str(args.get("command", "")), "command"
        case "edit":
            change = preview_edit(workspace, args)
            return f"Edit {path}", _diff(path, *change) if change else None, "diff"
        case "write":
            file = workspace.resolve(path)
            before = file.read_text(encoding="utf-8", errors="replace") if file.is_file() else ""
            verb = "Overwrite" if file.is_file() else "Create"
            return f"{verb} {path}", _diff(path, before, str(args.get("content", ""))), "diff"
        case "read" | "glob" | "grep":
            return f"{name.capitalize()} {args.get('pattern') or path or '.'}", None, "text"
    return f"Use {name}", repr(args), "text"


def _diff(path: str, before: str, after: str) -> str:
    lines = list(
        difflib.unified_diff(
            before.splitlines(keepends=True), after.splitlines(keepends=True), f"a/{path}", f"b/{path}", n=3
        )
    )
    if len(lines) > MAX_PREVIEW_LINES:
        lines = lines[:MAX_PREVIEW_LINES] + [f"... {len(lines) - MAX_PREVIEW_LINES} more diff lines\n"]
    return "".join(line if line.endswith("\n") else line + "\n" for line in lines)
