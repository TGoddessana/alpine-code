"""The plan: matching steps across updates, dropped steps, checks and who judges them, and the plan tools in a
session (approvals, bash counting as a check, evidence, saving and resuming)."""

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import (
    ApprovalRequest,
    Decision,
    InfoChanged,
    Mode,
    Session,
    Settings,
    ToolCallItem,
    file_storage,
)
from alpine_core import session as session_module
from alpine_core.plan import (
    Check,
    Plan,
    PlanError,
    Step,
    apply_update,
    match_steps,
    parse_checks,
    parse_steps,
)

# ------------------------------------------------------------------------------------------------ pure parts


def steps(*pairs):
    return tuple(Step(text, status) for text, status in pairs)


def test_at_most_one_step_is_now():
    assert parse_steps([{"text": "a", "status": "now"}, {"text": "b", "status": "todo"}])[0] == Step("a", "now")
    with pytest.raises(PlanError, match="at most one step is 'now'"):
        parse_steps([{"text": "a", "status": "now"}, {"text": "b", "status": "now"}])


def test_steps_need_text_and_a_known_status():
    with pytest.raises(PlanError, match="no text"):
        parse_steps([{"text": "  ", "status": "todo"}])
    with pytest.raises(PlanError, match="status 'doing'"):
        parse_steps([{"text": "a", "status": "doing"}])


def test_checks_say_who_judges_and_harness_checks_need_a_command():
    [harness, agent] = parse_checks(
        [
            {"label": "tests", "judge": "harness", "command": "uv run pytest"},
            {"label": "screen", "judge": "agent", "how": "three screenshots"},
        ]
    )
    assert harness == Check("tests", "harness", "uv run pytest") and harness.result == "not_run"
    assert agent.how == "three screenshots" and agent.command is None
    with pytest.raises(PlanError, match="needs the command"):
        parse_checks([{"label": "tests", "judge": "harness"}])
    with pytest.raises(PlanError, match="only harness checks run a command"):
        parse_checks([{"label": "tests", "judge": "agent", "command": "pytest"}])
    with pytest.raises(PlanError, match="two checks"):
        parse_checks([{"label": "t", "judge": "user"}, {"label": "t", "judge": "user"}])


def test_steps_match_by_text_first_then_by_position():
    before = steps(("find the cause", "done"), ("write a test", "now"), ("fix it", "todo"))
    # Reordered, and the last one reworded: text wins, then the position left over.
    after = steps(("write a test", "now"), ("find the cause", "done"), ("fix the index", "todo"))
    assert match_steps(before, after) == [1, 0, 2]
    # A new step where nothing is left over is new.
    assert match_steps(before, (*before, Step("review", "todo"))) == [0, 1, 2, None]


def test_the_first_plan_says_how_many_steps_and_checks():
    plan, change = apply_update(None, steps(("a", "now"), ("b", "todo")), (Check("t", "user"),))
    assert plan.steps == steps(("a", "now"), ("b", "todo")) and plan.checks == (Check("t", "user"),)
    assert change.created and (change.steps, change.checks) == (2, 1)
    assert change.added == () and change.dropped == ()


def test_an_update_reports_only_what_changed():
    plan, _ = apply_update(None, steps(("find the cause", "now"), ("write a test", "todo"), ("fix it", "todo")), None)
    plan, change = apply_update(
        plan, steps(("find the cause", "done"), ("write a test", "now"), ("fix it", "todo")), None
    )
    assert not change.created
    assert (change.finished, change.started, change.dropped, change.added) == (
        ("find the cause",),
        ("write a test",),
        (),
        (),
    )
    assert not change.checks_changed


def test_a_step_left_out_is_dropped_and_stays_dropped_until_it_returns():
    plan, _ = apply_update(None, steps(("a", "done"), ("b", "now"), ("c", "todo")), None)
    plan, change = apply_update(plan, steps(("a", "done"), ("c", "now")), None)
    # "c" matched by text, so "b" (whose position "c" now takes) is the one dropped.
    assert change.dropped == ("b",) and plan.dropped == ("b",)
    assert change.started == ("c",)
    plan, change = apply_update(plan, steps(("a", "done"), ("c", "done")), None)
    assert plan.dropped == ("b",) and change.dropped == ()
    plan, _ = apply_update(plan, steps(("a", "done"), ("c", "done"), ("b", "now")), None)
    assert plan.dropped == ()


def test_a_reworded_step_in_the_same_place_is_renamed_not_dropped():
    plan, _ = apply_update(None, steps(("a", "done"), ("rebuild the index", "now")), None)
    plan, change = apply_update(plan, steps(("a", "done"), ("rebuild the index when broken", "now")), None)
    assert change.renamed == (("rebuild the index", "rebuild the index when broken"),)
    assert change.dropped == () and plan.dropped == ()


def test_checks_left_out_stay_and_an_unchanged_check_keeps_its_result():
    plan, _ = apply_update(None, steps(("a", "now")), (Check("tests", "harness", "pytest"), Check("look", "user")))
    plan = Plan(
        plan.steps,
        plan.dropped,
        (Check("tests", "harness", "pytest", result="passed", evidence=("c1",)), plan.checks[1]),
    )
    same, change = apply_update(plan, steps(("a", "done")), None)
    assert same.checks == plan.checks and not change.checks_changed
    kept, change = apply_update(plan, steps(("a", "done")), (Check("tests", "harness", "pytest"),))
    assert kept.checks == (Check("tests", "harness", "pytest", result="passed", evidence=("c1",)),)
    assert change.checks_changed
    # Another command is another check: its result starts over.
    other, _ = apply_update(plan, steps(("a", "done")), (Check("tests", "harness", "pytest -x"),))
    assert other.checks[0].result == "not_run"


def test_the_plan_round_trips_as_data():
    plan = Plan(
        steps(("a", "done"), ("b", "now")),
        ("c",),
        (Check("tests", "harness", "pytest", result="failed", evidence=("x",)), Check("look", "agent", how="eye")),
    )
    assert Plan.from_dict(plan.to_dict()) == plan


# ------------------------------------------------------------------------------------------------ in a session


class Approver:
    def __init__(self, *decisions: Decision) -> None:
        self.decisions = list(decisions)
        self.requests: list[ApprovalRequest] = []

    def approve(self, request: ApprovalRequest) -> Decision:
        self.requests.append(request)
        return self.decisions.pop(0) if self.decisions else Decision("allow")


def make(tmp_path, monkeypatch, replies, *decisions, mode=Mode.DEFAULT, storage=None):
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    log = []
    approver = Approver(*decisions)
    session = Session(
        Settings(model="fake", mode=mode),
        on_item_event=lambda sid, seq, event: log.append(event),
        approver=approver,
        cwd=tmp_path,
        storage=storage,
    )
    return session, approver, log


def calls(session):
    return {item.id: item for item in session.snapshot().items if isinstance(item, ToolCallItem)}


PLAN = {
    "steps": [{"text": "find the cause", "status": "now"}, {"text": "fix it", "status": "todo"}],
    "checks": [
        {"label": "tests", "judge": "harness", "command": "exit 0"},
        {"label": "screen", "judge": "agent", "how": "screenshots"},
        {"label": "by hand", "judge": "user"},
    ],
}


def test_update_plan_sets_the_info_and_its_call_says_what_changed(tmp_path, monkeypatch):
    first = tool_call("update_plan", **PLAN)
    second = tool_call(
        "update_plan", steps=[{"text": "find the cause", "status": "done"}, {"text": "fix it", "status": "now"}]
    )
    session, approver, log = make(tmp_path, monkeypatch, [first, second, "done"])
    assert session.send("fix the bug") == "done"
    assert approver.requests == []  # the plan is the model's own notes: it never asks
    plan = session.info.plan
    assert plan is not None and [(s.text, s.status) for s in plan.steps] == [
        ("find the cause", "done"),
        ("fix it", "now"),
    ]
    assert [c.label for c in plan.checks] == ["tests", "screen", "by hand"]  # left out, the checks stay
    items = calls(session)
    assert items[first.id].detail["created"] and items[first.id].detail["steps"] == 2
    assert items[first.id].detail["checks"] == 3
    assert items[second.id].detail["finished"] == ["find the cause"]
    assert items[second.id].detail["started"] == ["fix it"]
    assert any(isinstance(e, InfoChanged) and e.info.plan == plan for e in log)


def test_two_steps_now_is_an_input_error_and_changes_nothing(tmp_path, monkeypatch):
    bad = tool_call("update_plan", steps=[{"text": "a", "status": "now"}, {"text": "b", "status": "now"}])
    session, _, _ = make(tmp_path, monkeypatch, [bad, "ok"])
    session.send("go")
    item = calls(session)[bad.id]
    assert item.status == "input_error" and "at most one step is 'now'" in item.result
    assert item.detail is None and session.info.plan is None


def test_a_harness_check_asks_like_bash_and_runs_its_command(tmp_path, monkeypatch):
    run = tool_call("check", label="tests")
    session, approver, _ = make(tmp_path, monkeypatch, [tool_call("update_plan", **PLAN), run, "done"])
    session.send("go")
    [request] = approver.requests
    assert request.tool == "check" and request.preview == "exit 0" and request.preview_kind == "command"
    assert request.remember == "bash commands starting with `exit`"
    item = calls(session)[run.id]
    assert item.status == "done" and item.detail == {
        "kind": "check",
        "label": "tests",
        "judge": "harness",
        "passed": True,
        "evidence": [run.id],
    }
    tests = session.info.plan.checks[0]
    assert tests.result == "passed" and tests.evidence == (run.id,)


def test_a_failing_harness_check_fails_and_the_model_gets_the_output(tmp_path, monkeypatch):
    plan = {"steps": PLAN["steps"], "checks": [{"label": "tests", "judge": "harness", "command": "echo boom; exit 3"}]}
    run = tool_call("check", label="tests")
    session, _, _ = make(tmp_path, monkeypatch, [tool_call("update_plan", **plan), run, "done"], mode=Mode.YOLO)
    session.send("go")
    item = calls(session)[run.id]
    assert item.status == "done" and item.detail["passed"] is False
    assert item.result.startswith("boom") and "exit code 3" in item.result
    assert session.info.plan.checks[0].result == "failed"


def test_bash_with_exactly_the_check_command_counts_but_a_longer_one_does_not(tmp_path, monkeypatch):
    plan = {"steps": PLAN["steps"], "checks": [{"label": "tests", "judge": "harness", "command": "exit 0"}]}
    longer = tool_call("bash", command="exit 0 && echo one-file")
    same = tool_call("bash", command="exit 0")
    replies = [tool_call("update_plan", **plan), longer, "half", same, "done"]
    session, _, _ = make(tmp_path, monkeypatch, replies, mode=Mode.YOLO)
    session.send("go")
    assert session.info.plan.checks[0].result == "not_run"
    session.send("again")
    check = session.info.plan.checks[0]
    assert check.result == "passed" and check.evidence == (same.id,)
    assert calls(session)[same.id].detail is None  # a bash call stays a bash call in the chat


def test_an_agent_check_needs_evidence_from_this_session(tmp_path, monkeypatch):
    (tmp_path / "shot.txt").write_text("badge clear of the price\n")
    look = tool_call("read", path="shot.txt")
    no_verdict = tool_call("check", label="screen", evidence=[look.id])
    no_evidence = tool_call("check", label="screen", passed=True)
    made_up = tool_call("check", label="screen", passed=True, evidence=["call_nope"])
    judged = tool_call("check", label="screen", passed=True, evidence=[look.id], note="clear on all three")
    replies = [tool_call("update_plan", **PLAN), look, no_verdict, no_evidence, made_up, judged, "done"]
    session, approver, _ = make(tmp_path, monkeypatch, replies)
    session.send("go")
    items = calls(session)
    assert approver.requests == []  # recording a judgement runs nothing
    assert items[no_verdict.id].status == "input_error" and "passed" in items[no_verdict.id].result
    assert items[no_evidence.id].status == "input_error" and "evidence" in items[no_evidence.id].result
    assert items[made_up.id].status == "input_error" and "call_nope" in items[made_up.id].result
    assert items[judged.id].detail == {
        "kind": "check",
        "label": "screen",
        "judge": "agent",
        "passed": True,
        "evidence": [look.id],
    }
    screen = session.info.plan.checks[1]
    assert (screen.result, screen.evidence, screen.note) == ("passed", (look.id,), "clear on all three")


def test_a_user_check_and_an_unknown_label_cannot_be_recorded(tmp_path, monkeypatch):
    user = tool_call("check", label="by hand", passed=True, evidence=["x"])
    unknown = tool_call("check", label="lint")
    harness_claim = tool_call("check", label="tests", passed=True)
    replies = [tool_call("update_plan", **PLAN), user, unknown, harness_claim, "done"]
    session, _, _ = make(tmp_path, monkeypatch, replies)
    session.send("go")
    items = calls(session)
    assert items[user.id].status == "input_error" and "checked by the user" in items[user.id].result
    assert items[unknown.id].status == "input_error" and "'tests'" in items[unknown.id].result
    assert items[harness_claim.id].status == "input_error" and "label alone" in items[harness_claim.id].result
    assert [c.result for c in session.info.plan.checks] == ["not_run", "not_run", "not_run"]


def test_a_declined_check_does_not_run(tmp_path, monkeypatch):
    run = tool_call("check", label="tests")
    session, _, _ = make(tmp_path, monkeypatch, [tool_call("update_plan", **PLAN), run, "ok"], Decision("deny"))
    session.send("go")
    assert calls(session)[run.id].status == "denied"
    assert session.info.plan.checks[0].result == "not_run"


def test_the_plan_is_saved_and_comes_back_when_resumed(tmp_path, monkeypatch, home):
    storage = file_storage(home)
    drop = tool_call("update_plan", steps=[{"text": "fix it", "status": "now"}])
    session, _, _ = make(tmp_path, monkeypatch, [tool_call("update_plan", **PLAN), drop, "done"], storage=storage)
    session.send("go")
    saved = session.info.plan
    assert saved.dropped == ("find the cause",)
    resumed = Session.resume(storage, session.id, Settings(model="fake"), approver=Approver(), cwd=tmp_path)
    assert resumed.info.plan == saved
    assert calls(resumed)[drop.id].detail["dropped"] == ["find the cause"]


def test_clearing_the_conversation_clears_the_plan(tmp_path, monkeypatch):
    session, _, _ = make(tmp_path, monkeypatch, [tool_call("update_plan", **PLAN), "done"])
    session.send("go")
    assert session.info.plan is not None
    session.clear()
    assert session.info.plan is None
