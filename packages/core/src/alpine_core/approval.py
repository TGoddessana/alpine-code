"""The permissions the Agent runs, and how they ask a frontend whether a tool call may run.

``build_permissions`` builds the list alpineagents asks about every call: deny permissions first (memory checks
that refuse a command until something else ran), then ``AllowByPolicy`` for what the mode and the conversation's
"don't ask again" answers allow, then ``DecideByApprover``, which asks the frontend's ``Approver`` about the rest,
or in ``auto`` mode a ``Reviewer`` first (``docs/auto-mode.md``).
"""

from __future__ import annotations

import asyncio
import difflib
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any, Literal, Protocol

from alpineagents import State, Tool, ToolCall
from alpineagents.permissions import Allowed, AllowPermission, DecidePermission, Denied, DenyPermission, Permission

from .permissions import Mode, PermissionPolicy, Remembered, Verdict
from .tools import Workspace, preview_edit

if TYPE_CHECKING:
    from .review import Review, Reviewer, TrustedSource

log = logging.getLogger(__name__)

#: Most diff lines put in a preview.
MAX_PREVIEW_LINES = 200

#: The ``state.root.extra_data`` key holding the conversation's "don't ask again" answers (``Remembered.to_data``).
REMEMBERED = "alpine_code.approvals"

DECLINED = "The user declined this tool call."
SKIPPED = (
    "Do not run it, or anything that does the same, again. Carry on without it: answer with what you already know,"
    " or find out another way."
)

#: The ``state.root.extra_data`` key holding auto mode's count of reviewer blocks in a row.
AUTO_REVIEW = "alpine_code.auto_review"

#: Blocks in a row after which the user is asked instead of the reviewer.
BLOCKS_BEFORE_ASKING = 3

#: Seconds the reviewer has to answer before the user is asked instead.
REVIEW_TIMEOUT = 90.0

BLOCKED_PREFIX = "Auto mode's reviewer blocked this call: "
BLOCKED = (
    BLOCKED_PREFIX + "{reason}. Do not try to get the same effect another way. Carry on with"
    " what you can do without it; if it is needed, tell the user what you wanted to do and why, and let them decide."
)

PreviewKind = Literal["diff", "command", "text"]

ReviewAsk = Literal["blocked_in_a_row", "failed"]


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
    review: ReviewAsk | None = None
    """In auto mode, why the user is asked instead of the reviewer: it blocked calls ``BLOCKS_BEFORE_ASKING`` times
    in a row, or it ``failed`` to answer (``review_error`` says how)."""
    review_error: str | None = None


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


def build_permissions(
    policy: PermissionPolicy,
    approver: Approver,
    refusal: Callable[[ToolCall], str | None] | None = None,
    reviewer: Callable[[], Reviewer | None] | None = None,
    trusted: Sequence[TrustedSource] = (),
) -> list[Permission]:
    """The permissions for ``Agent(permissions=...)``, in the order alpineagents asks them. With ``refusal``, a call
    it gives a reason for is refused first (memory checks). ``reviewer`` gives the reviewer auto mode asks (read on
    every call, so it can change with the session's model), with what the user said in ``trusted``."""
    first: list[Permission] = [RefuseByChecks(refusal)] if refusal is not None else []
    return [*first, AllowByPolicy(policy), DecideByApprover(policy, approver, reviewer, trusted)]


class RefuseByChecks(DenyPermission):
    """Refuses a call when a memory check says it must not run yet (``git commit`` before ``pnpm lint``): the model is
    told what to do first, and the run goes on. Deny permissions come first, so the user is not asked about a call
    that would be refused anyway."""

    def __init__(self, refusal: Callable[[ToolCall], str | None]) -> None:
        self.refusal = refusal

    def check(self, state: State, call: ToolCall, tool: Tool) -> Denied | None:
        reason = self.refusal(call)
        return Denied(reason) if reason else None

    async def acheck(self, state: State, call: ToolCall, tool: Tool) -> Denied | None:
        return self.check(state, call, tool)  # quick, and reads the session on its own thread


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
    ``allow_always`` answer is added to ``state.root.extra_data[REMEMBERED]``, so it is saved with the State. A call
    the policy allows (``AllowByPolicy`` usually let it through already) runs without asking.

    In ``auto`` mode the reviewer answers first, except for memory guards. A block is told to the model and the run
    goes on. After ``BLOCKS_BEFORE_ASKING`` blocks in a row, or when the reviewer fails, the approver is asked
    instead; any answer from the user starts the count again. The count is kept in ``state.root.extra_data``."""

    def __init__(
        self,
        policy: PermissionPolicy,
        approver: Approver,
        reviewer: Callable[[], Reviewer | None] | None = None,
        trusted: Sequence[TrustedSource] = (),
    ) -> None:
        if not callable(getattr(approver, "aapprove", None)) and not callable(getattr(approver, "approve", None)):
            raise TypeError(f"approver {approver!r} has neither approve nor aapprove")
        self.policy = policy
        self.approver = approver
        self.reviewer = reviewer
        self.trusted = tuple(trusted)

    def check(self, state: State, call: ToolCall, tool: Tool) -> Allowed | Denied:
        verdict, request = self._ask(state, call, tool)
        if request is None:
            return Allowed()
        reviewer = self._reviewer(verdict)
        if reviewer is not None:
            request, review = self._before_review(state, request)
            if review:
                outcome = asyncio.run(self._review(reviewer, state, request))
                done, request = self._after_review(state, request, outcome)
                if done is not None:
                    return done
        decision = self.approver.approve(request)  # type: ignore[union-attr]
        return self._answered(state, verdict, decision, reviewer is not None)

    async def acheck(self, state: State, call: ToolCall, tool: Tool) -> Allowed | Denied:
        aapprove = getattr(self.approver, "aapprove", None)
        if not callable(aapprove):
            return await super().acheck(state, call, tool)  # check on a worker thread
        verdict, request = self._ask(state, call, tool)
        if request is None:
            return Allowed()
        reviewer = self._reviewer(verdict)
        if reviewer is not None:
            request, review = self._before_review(state, request)
            if review:
                outcome = await self._review(reviewer, state, request)
                done, request = self._after_review(state, request, outcome)
                if done is not None:
                    return done
        return self._answered(state, verdict, await aapprove(request), reviewer is not None)

    def _ask(self, state: State, call: ToolCall, tool: Tool) -> tuple[Verdict, ApprovalRequest | None]:
        """The policy's verdict, and what to ask the user (``None`` when the call may run without asking)."""
        args = dict(call.args)
        verdict = self.policy.evaluate(call.name, args, tool, remembered(state))
        if verdict.allowed:
            return verdict, None
        return verdict, describe(call.name, args, self.policy.workspace, verdict, call.id)

    def _reviewer(self, verdict: Verdict) -> Reviewer | None:
        """The reviewer to ask about this call, or ``None`` when the user is asked."""
        if self.policy.mode is not Mode.AUTO or verdict.guard or self.reviewer is None:
            return None
        return self.reviewer()

    @staticmethod
    def _before_review(state: State, request: ApprovalRequest) -> tuple[ApprovalRequest, bool]:
        """Whether the reviewer is asked; after too many blocks in a row the request says why the user is."""
        if blocks_in_a_row(state) >= BLOCKS_BEFORE_ASKING:
            return replace(request, review="blocked_in_a_row"), False
        return request, True

    async def _review(self, reviewer: Reviewer, state: State, request: ApprovalRequest) -> Review | str:
        """The reviewer's answer, or what went wrong."""
        from .review import ReviewRequest

        notes = [note for source in self.trusted for note in source.notes(self.policy.workspace.root)]
        try:
            async with asyncio.timeout(REVIEW_TIMEOUT):
                return await reviewer.review(ReviewRequest(request, tuple(state.messages), tuple(notes)))
        except TimeoutError:
            return f"no answer in {REVIEW_TIMEOUT:.0f} seconds"
        except Exception as e:  # any failure of the reviewer: the user decides instead
            log.warning("auto mode reviewer failed", exc_info=True)
            return _failure(e)

    @staticmethod
    def _after_review(
        state: State, request: ApprovalRequest, outcome: Review | str
    ) -> tuple[Allowed | Denied | None, ApprovalRequest]:
        """The verdict when the reviewer decided, else the request to ask the user with."""
        if isinstance(outcome, str):
            return None, replace(request, review="failed", review_error=outcome)
        if outcome.allow:
            _set_blocks(state, 0)
            return Allowed(), request
        _set_blocks(state, blocks_in_a_row(state) + 1)
        reason = (outcome.reason or "it looks unsafe").rstrip(". ")
        return Denied(BLOCKED.format(reason=reason)), request

    def _answered(self, state: State, verdict: Verdict, decision: Decision, reviewing: bool) -> Allowed | Denied:
        if reviewing:
            _set_blocks(state, 0)
        return self._decide(state, verdict, decision)

    def _decide(self, state: State, verdict: Verdict, decision: Decision) -> Allowed | Denied:
        if decision.kind == "allow_always" and verdict.grant is not None:
            with state.root.edit_extra_data() as data:
                grants = Remembered.from_data(data.get(REMEMBERED))
                grants.add(verdict.grant)
                data[REMEMBERED] = grants.to_data()
        if decision.kind != "deny":
            return Allowed()
        if decision.stop:
            return Denied(f"{DECLINED} Wait for their next message.", stop=True)
        if decision.feedback:
            return Denied(f"{DECLINED} They said: {decision.feedback}")
        return Denied(f"{DECLINED} {SKIPPED}")


def blocked_reason(result: str) -> str | None:
    """The reviewer's reason in a denied call's result, or ``None`` when the reviewer did not block it."""
    if not result.startswith(BLOCKED_PREFIX):
        return None
    return result[len(BLOCKED_PREFIX) :].split(". Do not try", 1)[0]


def blocks_in_a_row(state: State) -> int:
    """How many calls auto mode's reviewer blocked in a row in ``state``'s conversation."""
    data = state.root.extra_data.get(AUTO_REVIEW) or {}
    return int(data.get("blocks_in_a_row", 0))


def _set_blocks(state: State, count: int) -> None:
    if blocks_in_a_row(state) == count:
        return
    with state.root.edit_extra_data() as data:
        data[AUTO_REVIEW] = {"blocks_in_a_row": count}


def _failure(error: Exception) -> str:
    """One line about a reviewer's failure, for the user."""
    text = " ".join(str(error).split())
    name = type(error).__name__
    if not text:
        return name
    return text if len(text) <= 200 else text[:199] + "…"


def remembered(state: State) -> Remembered:
    """What the user allowed with "don't ask again" in ``state``'s conversation."""
    return Remembered.from_data(state.root.extra_data.get(REMEMBERED))


def describe(
    name: str, args: dict[str, Any], workspace: Workspace, verdict: Verdict, call_id: str = ""
) -> ApprovalRequest:
    """Builds the request shown to the user for one tool call."""
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
