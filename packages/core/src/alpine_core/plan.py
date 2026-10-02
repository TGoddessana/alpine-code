"""The session's plan: the steps the model works through and the checks that show the work is done.

The model writes only its intent, through the ``update_plan`` tool: the whole list of steps each time, and the checks
when they change. Everything that can be observed is the harness's: which earlier step a new one continues (the same
text, otherwise the step in the same position), the steps that left the plan (``dropped``), and each check's result
with the calls it rests on. See ``docs/session-tools.md``.

A check is judged by one of three: the harness (its ``command`` exited 0, run by the ``check`` tool or by an identical
``bash`` command), the agent (its claim through the ``check`` tool, citing tool calls of the session as evidence), or
the user (in the review, not through a tool).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Literal, get_args

StepStatus = Literal["todo", "now", "done"]
Judge = Literal["harness", "agent", "user"]
CheckResult = Literal["not_run", "passed", "failed", "changed"]
"""``not_run`` until a result is recorded. ``changed``: it passed, then files changed. Nothing sets it yet: it needs
snapshots of the folder, which come later."""

#: The tools whose calls change the plan; their tool call items carry a ``detail`` saying what changed.
PLAN_TOOLS = ("update_plan", "check")


class PlanError(ValueError):
    """The model's arguments cannot be used; the message says how to fix them."""


@dataclass(frozen=True)
class Step:
    text: str
    status: StepStatus = "todo"


@dataclass(frozen=True)
class Check:
    label: str
    judge: Judge
    command: str | None = None
    """For ``harness``: the command whose exit code decides."""
    how: str | None = None
    """For ``agent`` and ``user``: how it will be checked, in the model's words."""
    result: CheckResult = "not_run"
    evidence: tuple[str, ...] = ()
    """Tool call ids: for ``harness`` the call that ran the command, for ``agent`` the calls it cited."""
    note: str | None = None
    """For ``agent``: what it saw, in its words."""

    def same_check(self, other: Check) -> bool:
        """Whether ``other`` checks the same thing the same way, so a result for one holds for the other."""
        return (self.label, self.judge, self.command, self.how) == (other.label, other.judge, other.command, other.how)


@dataclass(frozen=True)
class Plan:
    steps: tuple[Step, ...] = ()
    dropped: tuple[str, ...] = ()
    """Steps that left the plan without being matched to a new one, by text, oldest first."""
    checks: tuple[Check, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "steps": [{"text": s.text, "status": s.status} for s in self.steps],
            "dropped": list(self.dropped),
            "checks": [
                {
                    "label": c.label,
                    "judge": c.judge,
                    "command": c.command,
                    "how": c.how,
                    "result": c.result,
                    "evidence": list(c.evidence),
                    "note": c.note,
                }
                for c in self.checks
            ],
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Plan:
        return cls(
            steps=tuple(Step(s["text"], s.get("status", "todo")) for s in data.get("steps", ())),
            dropped=tuple(data.get("dropped", ())),
            checks=tuple(
                Check(
                    c["label"],
                    c["judge"],
                    c.get("command"),
                    c.get("how"),
                    c.get("result", "not_run"),
                    tuple(c.get("evidence", ())),
                    c.get("note"),
                )
                for c in data.get("checks", ())
            ),
        )


@dataclass(frozen=True)
class PlanChange:
    """What one ``update_plan`` call changed, for the chat's result line (steps by their text)."""

    created: bool
    """The first plan of the session: the line says how many steps and checks it set."""
    steps: int
    checks: int
    finished: tuple[str, ...] = ()
    started: tuple[str, ...] = ()
    reopened: tuple[str, ...] = ()
    """Back to ``todo`` from ``now`` or ``done``."""
    added: tuple[str, ...] = ()
    renamed: tuple[tuple[str, str], ...] = ()
    """``(before, after)``: matched by position, with new text."""
    dropped: tuple[str, ...] = ()
    checks_changed: bool = False

    def to_detail(self) -> dict[str, Any]:
        return {
            "kind": "plan",
            "created": self.created,
            "steps": self.steps,
            "checks": self.checks,
            "finished": list(self.finished),
            "started": list(self.started),
            "reopened": list(self.reopened),
            "added": list(self.added),
            "renamed": [{"before": before, "after": after} for before, after in self.renamed],
            "dropped": list(self.dropped),
            "checks_changed": self.checks_changed,
        }


# ------------------------------------------------------------------------------------------------ the model's input


def parse_steps(raw: Iterable[Mapping[str, Any]]) -> tuple[Step, ...]:
    """Steps from the tool's arguments. At most one may be ``now``.

    Raises:
        PlanError: A step has no text or a status that does not exist, or more than one is ``now``.
    """
    statuses = get_args(StepStatus)
    steps = []
    for i, item in enumerate(raw, 1):
        text = " ".join(str(item.get("text", "")).split())
        status = item.get("status", "todo")
        if not text:
            raise PlanError(f"step {i} has no text")
        if status not in statuses:
            raise PlanError(f"step {i} has status {status!r}; use one of {', '.join(statuses)}")
        steps.append(Step(text, status))
    now = [s.text for s in steps if s.status == "now"]
    if len(now) > 1:
        raise PlanError(
            f"{len(now)} steps are 'now' ({', '.join(repr(t) for t in now)}); at most one step is 'now' at a time."
            " Mark the others 'todo' or 'done' and send the whole list again"
        )
    return tuple(steps)


def parse_checks(raw: Iterable[Mapping[str, Any]]) -> tuple[Check, ...]:
    """Checks from the tool's arguments, all ``not_run``.

    Raises:
        PlanError: A label is missing or repeated, a judge does not exist, a harness check has no command, or
            another check has one.
    """
    judges = get_args(Judge)
    checks: list[Check] = []
    for i, item in enumerate(raw, 1):
        label = " ".join(str(item.get("label", "")).split())
        judge = item.get("judge")
        command = (item.get("command") or "").strip() or None
        how = " ".join(str(item.get("how") or "").split()) or None
        if not label:
            raise PlanError(f"check {i} has no label")
        if any(c.label == label for c in checks):
            raise PlanError(f"two checks are labelled {label!r}; labels name checks, so each must be different")
        if judge not in judges:
            raise PlanError(f"check {label!r} has judge {judge!r}; use one of {', '.join(judges)}")
        if judge == "harness" and command is None:
            raise PlanError(f"check {label!r} is judged by the harness, so it needs the command to run")
        if judge != "harness" and command is not None:
            raise PlanError(
                f"check {label!r} has a command but is judged by the {judge}; only harness checks run a command"
                " (its exit code decides). Make it a harness check, or say how in 'how'"
            )
        checks.append(Check(label, judge, command, how))
    return tuple(checks)


# ------------------------------------------------------------------------------------------------ matching


def match_steps(before: Sequence[Step], after: Sequence[Step]) -> list[int | None]:
    """For each new step, the index of the earlier step it continues, or ``None`` for a new one: the same text
    first, then the earlier step in the same position if nothing else took it."""
    taken: set[int] = set()
    matched: list[int | None] = [None] * len(after)
    for i, step in enumerate(after):
        for j, old in enumerate(before):
            if j not in taken and old.text == step.text:
                matched[i] = j
                taken.add(j)
                break
    for i in range(min(len(before), len(after))):
        if matched[i] is None and i not in taken:
            matched[i] = i
            taken.add(i)
    return matched


def apply_update(
    plan: Plan | None, steps: tuple[Step, ...], checks: tuple[Check, ...] | None
) -> tuple[Plan, PlanChange]:
    """The plan after an ``update_plan`` call, and what changed. ``checks`` ``None`` keeps the checks; a check that
    is the same as before keeps its result."""
    before = plan or Plan()
    matched = match_steps(before.steps, steps)
    finished, started, reopened, added, renamed = [], [], [], [], []
    for step, j in zip(steps, matched, strict=True):
        old = before.steps[j] if j is not None else None
        if old is None:
            added.append(step.text)
        elif old.text != step.text:
            renamed.append((old.text, step.text))
        previous = old.status if old is not None else "todo"
        if step.status != previous:
            if step.status == "done":
                finished.append(step.text)
            elif step.status == "now":
                started.append(step.text)
            elif old is not None:
                reopened.append(step.text)
    taken = {j for j in matched if j is not None}
    gone = [old.text for j, old in enumerate(before.steps) if j not in taken]
    texts = {step.text for step in steps}
    dropped = tuple(dict.fromkeys([*(t for t in before.dropped if t not in texts), *gone]))

    if checks is None:
        new_checks = before.checks
    else:
        kept = {c.label: c for c in before.checks}
        new_checks = tuple(
            replace(c, result=old.result, evidence=old.evidence, note=old.note)
            if (old := kept.get(c.label)) is not None and old.same_check(c)
            else c
            for c in checks
        )
    checks_changed = checks is not None and (
        len(new_checks) != len(before.checks)
        or any(not a.same_check(b) for a, b in zip(new_checks, before.checks, strict=True))
    )

    created = plan is None or (not plan.steps and not plan.checks and not plan.dropped)
    change = PlanChange(
        created=created,
        steps=len(steps),
        checks=len(new_checks),
        finished=tuple(finished),
        started=tuple(started),
        reopened=tuple(reopened),
        added=() if created else tuple(added),
        renamed=tuple(renamed),
        dropped=tuple(gone),
        checks_changed=checks_changed and not created,
    )
    return Plan(steps, dropped, new_checks), change


# ------------------------------------------------------------------------------------------------ the session's plan


@dataclass
class PlanTracker:
    """The plan of one session, as the plan tools and the session see it. Runs on the event loop's thread.

    Args:
        on_change: Called after every change, so the session saves and announces its info.
        known_calls: The ids of the session's finished tool calls, which agent checks may cite.
    """

    on_change: Callable[[], None] = lambda: None
    known_calls: Callable[[], set[str]] = set
    plan: Plan | None = None
    running_call: str | None = None
    """The call started last. ``bash``, ``update_plan`` and ``check`` run one at a time, after the turn's parallel
    calls finish, so while one of them runs this is its own id."""
    _details: dict[str, dict[str, Any]] = field(default_factory=dict)

    # ------------------------------------------------------------ the session

    def call_started(self, call_id: str) -> None:
        self.running_call = call_id

    def take_detail(self, call_id: str) -> dict[str, Any] | None:
        """What the plan tool call ``call_id`` did, for its tool call item; ``None`` if it changed nothing."""
        return self._details.pop(call_id, None)

    def restore(self, plan: Plan | None) -> None:
        self.plan = plan
        self._details.clear()

    def reset(self) -> None:
        self.restore(None)

    # ------------------------------------------------------------ the tools

    def update(self, steps: tuple[Step, ...], checks: tuple[Check, ...] | None) -> PlanChange:
        self.plan, change = apply_update(self.plan, steps, checks)
        self._remember(change.to_detail())
        self.on_change()
        return change

    def check(self, label: str) -> Check:
        """The check labelled ``label``.

        Raises:
            PlanError: There is no such check.
        """
        checks = self.plan.checks if self.plan is not None else ()
        found = next((c for c in checks if c.label == label), None)
        if found is not None:
            return found
        if not checks:
            raise PlanError("the plan has no checks yet; declare them with update_plan first")
        raise PlanError(f"no check is labelled {label!r}; the checks are " + ", ".join(repr(c.label) for c in checks))

    def harness_command(self, label: str) -> str | None:
        """The command of the harness check ``label``, or ``None`` (for the permissions, which ask about it as about
        a ``bash`` call)."""
        try:
            check = self.check(label)
        except PlanError:
            return None
        return check.command if check.judge == "harness" else None

    def record(self, label: str, passed: bool, evidence: Sequence[str], note: str | None = None) -> Check:
        """Sets a check's result, from the call that is running now (the ``check`` tool)."""
        check = self._set(label, passed, tuple(evidence), note)
        if self.running_call is not None:
            detail = {"kind": "check", "label": label, "judge": check.judge, "passed": passed}
            self._remember(detail | {"evidence": list(check.evidence)})
        return check

    def unknown_calls(self, ids: Sequence[str]) -> list[str]:
        known = self.known_calls()
        return [i for i in ids if i not in known]

    def observe_command(self, command: str, exit_code: int | None) -> None:
        """A ``bash`` call ran ``command`` (``exit_code`` ``None``: it timed out). It decides every harness check whose
        command is exactly the same; one that only starts the same way (a single test file of the suite) does not."""
        if self.plan is None or self.running_call is None:
            return
        command = command.strip()
        labels = [c.label for c in self.plan.checks if c.judge == "harness" and c.command == command]
        for label in labels:
            self._set(label, exit_code == 0, (self.running_call,), None)

    # ------------------------------------------------------------ internals

    def _set(self, label: str, passed: bool, evidence: tuple[str, ...], note: str | None) -> Check:
        assert self.plan is not None
        updated = replace(self.check(label), result="passed" if passed else "failed", evidence=evidence, note=note)
        self.plan = replace(self.plan, checks=tuple(updated if c.label == label else c for c in self.plan.checks))
        self.on_change()
        return updated

    def _remember(self, detail: dict[str, Any]) -> None:
        if self.running_call is not None:
            self._details[self.running_call] = detail


__all__ = [
    "PLAN_TOOLS",
    "Check",
    "CheckResult",
    "Judge",
    "Plan",
    "PlanChange",
    "PlanError",
    "PlanTracker",
    "Step",
    "StepStatus",
    "apply_update",
    "match_steps",
    "parse_checks",
    "parse_steps",
]
