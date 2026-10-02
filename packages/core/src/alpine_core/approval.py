"""The permissions the Agent runs, and how they ask a frontend whether a tool call may run.

``build_permissions`` builds the list alpineagents asks about every call: deny permissions first (none yet; rules
the user writes will go there), then ``AllowByPolicy`` for what the mode and the conversation's "don't ask again"
answers allow, then ``DecideByApprover``, which asks the frontend's ``Approver`` about the rest.
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from alpineagents import State, Tool, ToolCall
from alpineagents.permissions import Allowed, AllowPermission, DecidePermission, Denied, Permission

from .permissions import PermissionPolicy, Remembered, Verdict
from .tools import Workspace, preview_edit

#: Most diff lines put in a preview.
MAX_PREVIEW_LINES = 200

#: The ``state.root.data`` key holding the conversation's "don't ask again" answers (``Remembered.to_data``).
REMEMBERED = "alpine_code.approvals"

DECLINED = "The user declined this tool call."
SKIPPED = (
    "Do not run it, or anything that does the same, again. Carry on without it: answer with what you already know,"
    " or find out another way."
)

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
    call_id: str = ""
    """The model's id for the call, which is also the id of the ``tool_call`` item."""
    request_id: str = ""
    """The id of the ``approval`` item the core started for this request; a server answers with it. Empty when the
    approver is called without a ``Session``."""


@dataclass(frozen=True)
class Decision:
    """The user's answer.

    - ``allow``: run this call
    - ``allow_always``: run it, and do not ask again for what ``ApprovalRequest.remember`` describes
    - ``deny`` with ``feedback``: skip the call and tell the model what to do instead; the run continues
    - ``deny`` without ``feedback``: skip the call; the run continues without it
    - ``deny`` with ``stop``: skip the call and stop the run, waiting for the user's next message (a terminal's Esc)
    """

    kind: Literal["allow", "allow_always", "deny"]
    feedback: str | None = None
    stop: bool = False


class BlockingApprover(Protocol):
    """Asks the user and blocks until they answer. Called on a worker thread, one call at a time, so it may run its
    own prompt (a terminal) but must not touch the event loop running the session."""

    def approve(self, request: ApprovalRequest) -> Decision: ...


class AsyncApprover(Protocol):
    """Asks the user without blocking. Awaited on the event loop running the session, one call at a time; a
    cancelled run cancels the wait."""

    async def aapprove(self, request: ApprovalRequest) -> Decision: ...


#: Implemented by a frontend: ``approve`` or ``aapprove``. With both, ``aapprove`` is used.
Approver = BlockingApprover | AsyncApprover


def build_permissions(policy: PermissionPolicy, approver: Approver) -> list[Permission]:
    """The permissions for ``Agent(permissions=...)``, in the order alpineagents asks them."""
    return [AllowByPolicy(policy), DecideByApprover(policy, approver)]


class AllowByPolicy(AllowPermission):
    """Allows what the mode and the conversation's "don't ask again" answers allow. Passes on everything else,
    including files outside the working directory and secret files unless an answer covers them."""

    def __init__(self, policy: PermissionPolicy) -> None:
        self.policy = policy

    def check(self, state: State, call: ToolCall, tool: Tool) -> Allowed | None:
        allowed = self.policy.evaluate(call.name, dict(call.args), tool, remembered(state)).allowed
        return Allowed() if allowed else None

    async def acheck(self, state: State, call: ToolCall, tool: Tool) -> Allowed | None:
        return self.check(state, call, tool)  # quick: no worker thread


class DecideByApprover(DecidePermission):
    """Asks the approver about a call, saying why it needs approval and what "don't ask again" would allow; an
    ``allow_always`` answer is added to ``state.root.data[REMEMBERED]``, so it is saved with the State. A call the
    policy allows (``AllowByPolicy`` usually let it through already) runs without asking."""

    def __init__(self, policy: PermissionPolicy, approver: Approver) -> None:
        if not callable(getattr(approver, "aapprove", None)) and not callable(getattr(approver, "approve", None)):
            raise TypeError(f"approver {approver!r} has neither approve nor aapprove")
        self.policy = policy
        self.approver = approver

    def check(self, state: State, call: ToolCall, tool: Tool) -> Allowed | Denied:
        verdict, request = self._ask(state, call, tool)
        if request is None:
            return Allowed()
        return self._decide(state, verdict, self.approver.approve(request))  # type: ignore[union-attr]

    async def acheck(self, state: State, call: ToolCall, tool: Tool) -> Allowed | Denied:
        aapprove = getattr(self.approver, "aapprove", None)
        if not callable(aapprove):
            return await super().acheck(state, call, tool)  # check on a worker thread
        verdict, request = self._ask(state, call, tool)
        if request is None:
            return Allowed()
        return self._decide(state, verdict, await aapprove(request))

    def _ask(self, state: State, call: ToolCall, tool: Tool) -> tuple[Verdict, ApprovalRequest | None]:
        """The policy's verdict, and what to ask the user (``None`` when the call may run without asking)."""
        args = dict(call.args)
        verdict = self.policy.evaluate(call.name, args, tool, remembered(state))
        if verdict.allowed:
            return verdict, None
        command = self.policy.command_of(call.name, args) if call.name == "check" else None
        return verdict, describe(call.name, args, self.policy.workspace, verdict, call.id, command=command)

    def _decide(self, state: State, verdict: Verdict, decision: Decision) -> Allowed | Denied:
        if decision.kind == "allow_always" and verdict.grant is not None:
            root = state.root
            with root.lock:
                grants = remembered(root)
                grants.add(verdict.grant)
                root.data[REMEMBERED] = grants.to_data()
        if decision.kind != "deny":
            return Allowed()
        if decision.stop:
            return Denied(f"{DECLINED} Wait for their next message.", stop=True)
        if decision.feedback:
            return Denied(f"{DECLINED} They said: {decision.feedback}")
        return Denied(f"{DECLINED} {SKIPPED}")


def remembered(state: State) -> Remembered:
    """What the user allowed with "don't ask again" in ``state``'s conversation."""
    return Remembered.from_data(state.root.data.get(REMEMBERED))


def describe(
    name: str,
    args: dict[str, Any],
    workspace: Workspace,
    verdict: Verdict,
    call_id: str = "",
    *,
    command: str | None = None,
) -> ApprovalRequest:
    """Builds the request shown to the user for one tool call. ``command`` is what a ``check`` call runs."""
    if name == "check" and command is not None:
        title, preview, kind = f"Run check {args.get('label', '')}", command, "command"
    else:
        title, preview, kind = _preview(name, args, workspace)
    return ApprovalRequest(
        name, args, title, preview, kind, reason=verdict.reason, remember=verdict.remember, call_id=call_id
    )


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
