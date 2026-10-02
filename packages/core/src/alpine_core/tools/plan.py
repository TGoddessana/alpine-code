"""The plan tools: ``update_plan`` writes the model's plan, ``check`` runs or records one of its checks.

Both run on the event loop (``async``) and one at a time (``parallel=False``), so a change is announced from the
loop's thread and ``PlanTracker.running_call`` is the call's own id.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

from alpineagents import ToolError, ToolInputError, tool

from ..plan import PlanChange, PlanError, PlanTracker, parse_checks, parse_steps
from ._common import Workspace, os_error
from .bash import MAX_TIMEOUT, run_command


class StepArg(TypedDict):
    text: str
    status: Literal["todo", "now", "done"]


class CheckArg(TypedDict):
    label: str
    judge: Literal["harness", "agent", "user"]
    command: NotRequired[str]
    how: NotRequired[str]


class PlanTools:
    def __init__(self, workspace: Workspace, plan: PlanTracker) -> None:
        self.workspace = workspace
        self.plan = plan

    @tool(name="update_plan", parallel=False, read_only=True, open_world=False)
    async def update_plan(self, steps: list[StepArg], checks: list[CheckArg] | None = None) -> str:
        """Set the plan the user follows in the side panel: the steps of the work and the checks that will show it
        is done. Send the whole list of steps every time, in order, with each step's status: todo, now (at most one
        step at a time) or done. A step left out of the list is shown to the user as dropped from the plan.

        Write step texts in a few plain words the user understands. Send checks only when they change; left
        out, they stay as they are. A check has a short label (check() takes it) and says who judges it:
        - harness: give the command (tests, type check, build); it passes when the command exits 0
        - agent: you judge it from what you saw (screenshots, output compared by eye); say how in "how"
        - user: the user checks it by hand in the review; say how in "how"

        Args:
            steps: The whole plan, in order: {text, status}
            checks: The checks, when they change: {label, judge, command (harness only), how}
        """
        try:
            parsed = parse_steps(steps)
            parsed_checks = parse_checks(checks) if checks is not None else None
        except PlanError as e:
            raise ToolInputError(str(e)) from e
        return _describe(self.plan.update(parsed, parsed_checks))

    @tool(name="check", parallel=False, exception_handler=os_error, open_world=True)
    async def check(
        self,
        label: str,
        passed: bool | None = None,
        evidence: list[str] | None = None,
        note: str | None = None,
    ) -> str:
        """Run or record one of the plan's checks, by its label.

        - harness check: call check(label) alone. Its command runs as written and passes when it exits 0. Running
          exactly the same command with bash counts too. To run something else, change the check with update_plan
          first.
        - agent check: call check(label, passed, evidence, note). evidence is required: the ids of this session's
          tool calls you judged from (screenshots, outputs). note says what you saw.
        - user check: the user checks it in the review; it cannot be recorded here.

        Args:
            label: The check's label, as in the plan
            passed: Agent checks only: whether it passed
            evidence: Agent checks only: ids of the tool calls you judged from
            note: Agent checks only: what you saw, in a sentence
        """
        try:
            found = self.plan.check(label)
        except PlanError as e:
            raise ToolInputError(str(e)) from e
        if found.judge == "user":
            raise ToolInputError(f"{label!r} is checked by the user in the review; it cannot be recorded with check")
        if found.judge == "harness":
            if passed is not None or evidence or note:
                raise ToolInputError(
                    f"{label!r} is judged by the harness from its command; call check with the label alone"
                )
            return await self._run(label, found.command or "")
        if passed is None:
            raise ToolInputError(f"{label!r} is judged by you: say whether it passed (passed=true or false)")
        if not evidence:
            raise ToolInputError(f"{label!r} needs evidence: the ids of the tool calls of this session you judged from")
        unknown = self.plan.unknown_calls(evidence)
        if unknown:
            raise ToolInputError(
                "evidence must name finished tool calls of this session; not found: " + ", ".join(unknown)
            )
        recorded = self.plan.record(label, passed, evidence, " ".join(note.split()) if note else None)
        verdict = "passed" if passed else "did not pass"
        return f"Recorded: {label!r} {verdict}, as your judgement with {len(recorded.evidence)} calls as evidence."

    async def _run(self, label: str, command: str) -> str:
        call = [self.plan.running_call] if self.plan.running_call else []
        try:
            text, code = await run_command(self.workspace.root, command, MAX_TIMEOUT)
        except ToolError:
            self.plan.record(label, False, call)
            raise
        self.plan.record(label, code == 0, call)
        return f"{text}\n[check passed]" if code == 0 else f"{text}\n[exit code {code}: check failed]"


def _describe(change: PlanChange) -> str:
    """What the model is told after an update: short, and what the user sees about dropped steps."""
    text = f"Plan updated: {change.steps} steps, {change.checks} checks."
    if change.dropped:
        text += " Dropped from the plan, which the user sees: " + ", ".join(repr(t) for t in change.dropped) + "."
    return text
