"""A TF in a session: proposed by the model, started by the user, agents under the session's permissions, the result
back to the model, and the run kept for continuing after a restart."""

import asyncio
import textwrap
import threading

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import Decision, Mode, Session, Settings, file_storage
from alpine_core import session as session_module
from alpine_core.items import ApprovalItem, InfoChanged, NoticeItem, TaskForceItem
from alpine_core.taskforce import available
from alpine_core.taskforce import team as team_module
from alpine_core.work_changes import checkpoint_changes

pytestmark = pytest.mark.skipif(not available(), reason="TF runs on macOS only")

SCRIPT = textwrap.dedent(
    """
    phase("작성")
    drafts = await parallel([agent(f"write {t}", label=t) for t in ["저장소", "복제"]])
    phase("검토")
    reviews = await parallel([agent(f"review {d}") for d in drafts])
    result = reviews
    """
)

STEPS = [{"title": "작성", "count": 2, "model": "fake"}, {"title": "검토", "count": 2, "model": "fake"}]


def member_model(answer=lambda prompt: f"ok({prompt})", first=None):
    """Every agent's model: optionally a first reply (a tool call), then an answer to its prompt."""

    def make(settings):
        replies = [first] if first is not None else []
        replies.append(lambda request: answer(request.messages[0].text))
        return FakeModel(replies)

    return make


class Approver:
    def __init__(self, decision="allow", gate: asyncio.Event | None = None):
        self.decision = decision
        self.gate = gate
        self.requests = []

    async def aapprove(self, request):
        self.requests.append(request)
        if self.gate is not None:
            await self.gate.wait()
        return Decision(self.decision)


def members_of(session):
    return [m for card in taskforce_items(session) for m in card.members]


def taskforce_items(session, active=True):
    items = session.snapshot().active if active else session.snapshot().items
    return [i for i in items if isinstance(i, TaskForceItem)]


async def until(check, timeout=10.0):
    async with asyncio.timeout(timeout):
        while not check():
            await asyncio.sleep(0.01)


def make(tmp_path, monkeypatch, lead, approver=None, storage=None, members=None, mode=Mode.DEFAULT, events=None):
    model = FakeModel(lead)  # one model however often the agent is rebuilt
    monkeypatch.setattr(session_module, "make_model", lambda settings: model)
    monkeypatch.setattr(team_module, "make_model", members or member_model())
    return Session(
        Settings(model="fake", mode=mode),
        approver=approver or Approver(),
        cwd=tmp_path,
        storage=storage,
        taskforce=True,
        on_item_event=None if events is None else lambda sid, seq, event: events.append(event),
    )


def propose(**overrides):
    return tool_call(
        "task_force", **{"title": "지도 그리기", "steps": STEPS, "minutes": 5, "script": SCRIPT, **overrides}
    )


def test_the_model_proposes_the_user_starts_and_the_result_comes_back(tmp_path, monkeypatch):
    async def go():
        heard = []
        lead = [propose(), "제안했어요", lambda request: heard.append(request.messages[-1].text) or "103장 그렸어요"]
        session = make(tmp_path, monkeypatch, lead)
        await session.asend("지도 그려 줘")
        [card] = taskforce_items(session)
        assert card.status == "proposed" and card.title == "지도 그리기" and card.minutes == 5
        assert session.info.status == "idle"  # the model ended its turn; nothing runs before 시작

        session.taskforce.start(card.id)
        assert {t.name for t in session._build_agent(session._settings).tools} <= {
            "read",
            "glob",
            "grep",
            "task_force_status",
        }  # while it runs, the model reads and answers only
        await until(lambda: taskforce_items(session, active=False))
        await until(lambda: not session._turns)
        [done] = taskforce_items(session, active=False)
        assert done.status == "done"
        assert [(m["step"], m["task"], m["state"]) for m in done.members] == [
            ("작성", "저장소", "done"),
            ("작성", "복제", "done"),
            ("검토", "review ok(write 저장소)", "done"),
            ("검토", "review ok(write 복제)", "done"),
        ]
        assert done.members[2]["source"] is None  # the answer is shorter than a quote
        assert "review ok(write 저장소)" in heard[0] and "ended: done" in heard[0]
        notices = [i for i in session.snapshot().items if isinstance(i, NoticeItem)]
        assert notices and notices[-1].source == "taskforce"
        assert session.snapshot().items[-1].text == "103장 그렸어요"
        assert "task_force" in {t.name for t in session._build_agent(session._settings).tools}  # back to normal

    asyncio.run(go())


def test_an_invalid_script_goes_back_to_the_model(tmp_path, monkeypatch):
    async def go():
        seen = []
        lead = [propose(script="import os\n"), lambda request: seen.append(request.messages[-1]) or "고칠게요"]
        session = make(tmp_path, monkeypatch, lead)
        await session.asend("지도 그려 줘")
        assert not taskforce_items(session)
        [block] = seen[0].content
        assert block.is_error and "`import os`" in block.content

    asyncio.run(go())


def test_혼자_하기_tells_the_model_to_go_on_alone(tmp_path, monkeypatch):
    async def go():
        heard = []
        lead = [propose(), "제안했어요", lambda request: heard.append(request.messages[-1].text) or "혼자 할게요"]
        session = make(tmp_path, monkeypatch, lead)
        await session.asend("지도 그려 줘")
        [card] = taskforce_items(session)
        session.taskforce.decline(card.id)
        await until(lambda: not session._turns)
        assert taskforce_items(session, active=False)[0].status == "declined"
        assert "혼자 하기" in heard[0]

    asyncio.run(go())


def writers(heard=None):
    """Every agent writes a file named after its prompt, then answers with what it heard last."""

    def make(settings):
        def answer(request):
            if heard is not None:
                heard[request.messages[0].text] = request.messages[-1]
            return "ok"

        def write(request):
            name = request.messages[0].text
            return tool_call("write", path=f"{name}.md", content=name)

        return FakeModel([write, answer])

    return make


def approvals(session):
    return [i for i in session.snapshot().active if isinstance(i, ApprovalItem)]


def start_writers(tmp_path, monkeypatch, names, approver, heard=None, events=None):
    script = f"await parallel([{', '.join(f'agent({n!r})' for n in names)}])\n"
    lead = [propose(script=script), "제안했어요", "끝"]
    session = make(tmp_path, monkeypatch, lead, approver=approver, members=writers(heard), events=events)

    async def go():
        await session.asend("go")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: approvals(session) and len(approvals(session)[0].asked_by) == len(names))
        return session

    return go()


def test_agents_asking_the_same_thing_share_one_card_showing_each_call(tmp_path, monkeypatch):
    async def go():
        gate = asyncio.Event()
        approver = Approver(gate=gate)
        session = await start_writers(tmp_path, monkeypatch, ["a", "b"], approver)
        [approval] = approvals(session)
        assert [(ask.task, ask.title, ask.args["path"]) for ask in approval.asked_by] == [
            ("a", "Create a.md", "a.md"),
            ("b", "Create b.md", "b.md"),
        ]
        assert "+b" in approval.asked_by[1].preview and approval.asked_by[1].preview_kind == "diff"
        assert len(approver.requests) == 1
        assert session.info.status == "idle"  # the session's own turn is not waiting
        gate.set()
        await until(lambda: taskforce_items(session, active=False))
        assert [m["state"] for m in taskforce_items(session, active=False)[0].members] == ["done", "done"]

    asyncio.run(go())


def test_one_agents_call_is_declined_alone_and_the_card_stays_for_the_others(tmp_path, monkeypatch):
    async def go():
        gate = asyncio.Event()
        heard = {}
        session = await start_writers(tmp_path, monkeypatch, ["a", "b", "c"], Approver(gate=gate), heard)
        [approval] = approvals(session)
        b = approval.asked_by[1].agent
        assert session.taskforce.decline_one(approval.id, b)
        await until(lambda: [ask.task for ask in approvals(session)[0].asked_by] == ["a", "c"])
        await until(lambda: "b" in heard)  # it goes on without the call
        assert "The user declined this tool call." in heard["b"].content[0].content
        assert not session.taskforce.decline_one(approval.id, b)  # once
        gate.set()
        await until(lambda: taskforce_items(session, active=False))
        assert [m["state"] for m in taskforce_items(session, active=False)[0].members] == ["done"] * 3
        assert (tmp_path / "a.md").exists() and not (tmp_path / "b.md").exists() and (tmp_path / "c.md").exists()
        [answered] = [i for i in session.snapshot().items if isinstance(i, ApprovalItem)]
        assert answered.decision == "allow" and [ask.task for ask in answered.asked_by] == ["a", "c"]

    asyncio.run(go())


def test_declining_the_last_line_takes_the_card_down(tmp_path, monkeypatch):
    async def go():
        session = await start_writers(tmp_path, monkeypatch, ["a", "b"], Approver(gate=asyncio.Event()))
        [approval] = approvals(session)
        for ask in approval.asked_by:
            assert session.taskforce.decline_one(approval.id, ask.agent)
        await until(lambda: taskforce_items(session, active=False))
        assert not approvals(session)
        [answered] = [i for i in session.snapshot().items if isinstance(i, ApprovalItem)]
        assert answered.decision == "deny" and not list(tmp_path.glob("*.md"))
        await until(lambda: not session._turns)

    asyncio.run(go())


def test_a_tf_run_is_a_checkpoint_of_the_changes_tab(tmp_path, monkeypatch):
    async def go():
        gate = asyncio.Event()
        session = await start_writers(tmp_path, monkeypatch, ["a", "b"], Approver(gate=gate))
        assert session.info.work_history["requests"][-1]["status"] == "running"
        [approval] = approvals(session)
        session.taskforce.decline_one(approval.id, approval.asked_by[0].agent)  # b alone writes
        await until(lambda: approvals(session) and len(approvals(session)[0].asked_by) == 1)
        gate.set()
        await until(lambda: taskforce_items(session, active=False))
        await until(lambda: not session._turns)
        info = session.info
        [checkpoint] = [r for r in info.work_history["requests"] if r["label"] == "TF · 지도 그리기"]
        assert checkpoint["status"] == "done"
        assert [f["path"] for f in checkpoint_changes(info.work_history, info.work_baseline, checkpoint["id"])] == [
            "b.md"
        ]
        assert [f["path"] for f in checkpoint_changes(info.work_history, info.work_baseline)] == ["b.md"]

    asyncio.run(go())


def test_the_session_usage_is_announced_as_the_agents_use_tokens(tmp_path, monkeypatch):
    async def go():
        events = []
        gate = asyncio.Event()
        session = await start_writers(tmp_path, monkeypatch, ["a", "b"], Approver(gate=gate), events=events)
        lead_only = session._state.usage.requests
        announced = [e.info.usage.requests for e in events if isinstance(e, InfoChanged)]
        assert announced[-1] == lead_only + 2  # each agent's first request, before the card is answered
        gate.set()
        await until(lambda: taskforce_items(session, active=False))
        assert max(e.info.usage.requests for e in events if isinstance(e, InfoChanged)) >= lead_only + 4

    asyncio.run(go())


def test_a_run_cut_short_by_a_restart_continues_with_its_finished_agents(tmp_path, monkeypatch):
    storage = file_storage(tmp_path / "home")
    project = tmp_path / "project"
    project.mkdir()
    started = []
    release = threading.Event()

    def members(settings):
        def answer(request):
            prompt = request.messages[0].text
            started.append(prompt)
            if prompt.startswith("review"):
                release.wait(10)  # still working when the app closes
            return f"ok({prompt})"

        return FakeModel([answer])

    async def first():
        session = make(project, monkeypatch, [propose(), "제안했어요"], storage=storage, members=members)
        await session.asend("지도 그려 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: any(m["step"] == "검토" and m["state"] == "working" for m in members_of(session)))
        await session.aclose()  # the app quits
        release.set()
        return session.id, card.id

    session_id, run_id = asyncio.run(first())
    assert started[:2] == ["write 저장소", "write 복제"]

    async def second():
        monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(["다 됐어요"]))
        monkeypatch.setattr(team_module, "make_model", member_model())
        session = Session.resume(storage, session_id, Settings(model="fake"), approver=Approver(), taskforce=True)
        [card] = taskforce_items(session)
        assert card.id == run_id and card.status == "interrupted"
        started.clear()
        session.taskforce.resume(run_id)
        await until(lambda: taskforce_items(session, active=False))
        [done] = taskforce_items(session, active=False)
        assert done.status == "done"
        assert [m["cached"] for m in done.members] == [True, True, False, False]
        await until(lambda: not session._turns)

    asyncio.run(second())


def test_agents_of_a_script_without_phase_fill_the_plan_in_order(tmp_path, monkeypatch):
    async def go():
        script = 'a = await agent("one")\nb = await agent("two")\nc = await agent(f"sum {a} {b}")\n'
        session = make(
            tmp_path,
            monkeypatch,
            [
                propose(
                    script=script,
                    steps=[
                        {"title": "읽기", "count": 2, "model": "fake"},
                        {"title": "모으기", "count": 1, "model": "fake"},
                    ],
                ),
                "제안했어요",
                "끝",
            ],
        )
        await session.asend("go")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: taskforce_items(session, active=False))
        [done] = taskforce_items(session, active=False)
        assert [m["step"] for m in done.members] == ["읽기", "읽기", "모으기"]
        await until(lambda: not session._turns)

    asyncio.run(go())


def test_why_an_agent_failed_reaches_the_screen_and_the_model(tmp_path, monkeypatch):
    # In the PostgreSQL run a reviewer failed and nothing anywhere said why.
    def answer(prompt):
        if prompt.startswith("review"):
            raise RuntimeError("overloaded")
        return f"ok({prompt})"

    async def go():
        heard = []
        lead = [propose(), "제안했어요", lambda request: heard.append(request.messages[-1].text) or "끝"]
        session = make(tmp_path, monkeypatch, lead, members=member_model(answer))
        await session.asend("지도 그려 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: taskforce_items(session, active=False))
        await until(lambda: not session._turns)
        [done] = taskforce_items(session, active=False)
        assert [m["state"] for m in done.members] == ["done", "done", "failed", "failed"]
        assert "overloaded" in done.members[2]["error"]
        assert "a3 review ok(write 저장소): failed (" in heard[0] and "overloaded" in heard[0]

    asyncio.run(go())


def test_a_long_result_is_cut_but_kept_and_can_be_read_on(tmp_path, monkeypatch):
    # The PostgreSQL run's result was 40,682 characters; its end was lost without a word (TF item 3).
    script = 'phase("작성")\nwords = await agent("write")\nresult = "가" * 50000 + "끝"\n'
    storage = file_storage(tmp_path / "home")
    project = tmp_path / "project"
    project.mkdir()

    async def go():
        heard = []
        lead = [
            propose(script=script, steps=[{"title": "작성", "count": 1, "model": "fake"}]),
            "제안했어요",
            lambda request: heard.append(request.messages[-1].text) or "다 됐어요",
        ]
        session = make(project, monkeypatch, lead, storage=storage)
        await session.asend("해 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: taskforce_items(session, active=False))
        await until(lambda: not session._turns)
        assert "the first 40,000 of 50,003 characters" in heard[0]
        assert f'task_force_status(run="{card.id}", start=40000)' in heard[0]
        assert "끝" not in heard[0]
        rest = session.taskforce.status_text(card.id, 40000)
        assert "from character 40,000 to 50,003 of 50,003" in rest and rest.endswith('끝"')
        return session.id, card.id

    session_id, run_id = asyncio.run(go())
    again = Session.resume(storage, session_id, Settings(model="fake"), approver=Approver(), taskforce=True)
    assert again.taskforce.status_text(run_id, 50000).endswith('끝"')  # the record keeps the whole result
    assert again.taskforce.usage.requests == 1  # and what its agents used, for the session's usage


ONE = [{"title": "작성", "count": 1, "model": "fake"}]


def run_one(tmp_path, monkeypatch, script, members):
    """Runs a one-agent TF to its end: the finished card and what the lead heard."""

    async def go():
        heard = []
        lead = [
            propose(script=script, steps=ONE),
            "제안했어요",
            lambda request: heard.append(request.messages[-1].text) or "끝",
        ]
        session = make(tmp_path, monkeypatch, lead, members=members)
        await session.asend("해 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: taskforce_items(session, active=False))
        await until(lambda: not session._turns)
        [done] = taskforce_items(session, active=False)
        return session, done, heard[0]

    return asyncio.run(go())


def test_an_answer_not_in_the_json_shape_is_asked_again_in_the_same_conversation(tmp_path, monkeypatch):
    asked = []

    def members(settings):
        def again(request):
            asked.append([m.text for m in request.messages])
            return '{"topics": ["저장소"]}'

        return FakeModel(["주제는 저장소예요.", again])

    script = 'phase("작성")\nresult = await agent("topics?", returns={"topics": ["..."]})\n'
    session, done, heard = run_one(tmp_path, monkeypatch, script, members)
    assert done.members[0]["state"] == "done"
    assert '"저장소"' in heard
    [conversation] = asked
    assert conversation[1] == "주제는 저장소예요." and "only a JSON value" in conversation[2]  # the work stays


def test_an_agent_that_never_answers_in_json_fails_after_a_few_asks(tmp_path, monkeypatch):
    calls = []

    def members(settings):
        return FakeModel([lambda request: calls.append(1) or "아니요"] * (team_module.JSON_RETRIES + 1))

    script = 'phase("작성")\nresult = await agent("topics?", returns={"topics": ["..."]})\n'
    session, done, heard = run_one(tmp_path, monkeypatch, script, members)
    assert len(calls) == team_module.JSON_RETRIES + 1
    assert done.members[0]["state"] == "failed" and "not the JSON" in done.members[0]["error"]


def test_a_provider_error_starts_the_same_agent_over_once(tmp_path, monkeypatch):
    from alpineagents import ProviderError

    prompts = []

    def members(settings):
        def overloaded(request):
            raise ProviderError("overloaded_error")

        def answer(request):
            prompts.append([m.text for m in request.messages])
            return "다 썼어요"

        return FakeModel([overloaded, answer])

    session, done, heard = run_one(tmp_path, monkeypatch, 'phase("작성")\nresult = await agent("write")\n', members)
    [member] = done.members  # the same agent: the card's count does not grow
    assert member["state"] == "done" and "overloaded_error" in member["retried"]
    assert prompts == [["write"]]  # started over from its prompt
    record = session.taskforce.record(done.id, member["id"])
    assert any(getattr(i, "source", None) == "taskforce_retry" and "overloaded_error" in i.text for i in record)


def test_a_second_provider_error_fails_the_agent(tmp_path, monkeypatch):
    from alpineagents import ProviderError

    def members(settings):
        def overloaded(request):
            raise ProviderError("overloaded_error")

        return FakeModel([overloaded, overloaded])

    session, done, heard = run_one(tmp_path, monkeypatch, 'phase("작성")\nresult = await agent("write")\n', members)
    [member] = done.members
    assert member["state"] == "failed" and member["retried"] and "overloaded_error" in member["error"]
    assert "started over after" in heard


def running(command):
    from alpine_core.processes import process_manager

    return [p for p in process_manager().list() if p.command == command and p.status == "running"]


def stoppable(asked):
    """Every agent's model: a long command first, then an answer it should never be asked for once stopped."""

    def make(settings):
        return FakeModel(
            [tool_call("bash", command="sleep 30", title="wait"), lambda request: asked.append(1) or "끝났어요"]
        )

    return make


def test_stopping_an_agent_kills_its_command_and_asks_the_model_nothing_more(tmp_path, monkeypatch):
    # TF item 8: before, a stopped agent waited for its ten-minute test and paid one more request.
    async def go():
        asked = []
        lead = [propose(script='phase("작성")\nresult = await agent("wait")\n', steps=ONE), "제안했어요", "끝"]
        session = make(tmp_path, monkeypatch, lead, members=stoppable(asked), mode=Mode.YOLO)
        await session.asend("해 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: running("sleep 30"))
        [member] = members_of(session)
        started = asyncio.get_running_loop().time()
        assert session.taskforce.stop_member(card.id, member["id"])
        await until(lambda: taskforce_items(session, active=False))
        assert asyncio.get_running_loop().time() - started < 10
        [done] = taskforce_items(session, active=False)
        assert done.members[0]["state"] == "stopped"
        assert asked == []  # no request after the stop
        assert not running("sleep 30")
        await until(lambda: not session._turns)

    asyncio.run(go())


def test_stopping_the_whole_tf_kills_every_agents_command(tmp_path, monkeypatch):
    async def go():
        asked = []
        script = 'phase("작성")\nresult = await parallel([agent("wait 1"), agent("wait 2")])\n'
        steps = [{"title": "작성", "count": 2, "model": "fake"}]
        lead = [propose(script=script, steps=steps), "제안했어요", "끝"]
        session = make(tmp_path, monkeypatch, lead, members=stoppable(asked), mode=Mode.YOLO)
        await session.asend("해 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: len(running("sleep 30")) == 2)
        session.taskforce.stop(card.id)
        await until(lambda: taskforce_items(session, active=False))
        [done] = taskforce_items(session, active=False)
        assert done.status == "stopped" and [m["state"] for m in done.members] == ["stopped", "stopped"]
        assert asked == [] and not running("sleep 30")
        await until(lambda: not session._turns)

    asyncio.run(go())


def test_stopping_an_agent_that_waits_for_approval_takes_its_card_down(tmp_path, monkeypatch):
    async def go():
        asked = []
        gate = asyncio.Event()  # the user never answers
        approver = Approver(gate=gate)
        lead = [propose(script='phase("작성")\nresult = await agent("wait")\n', steps=ONE), "제안했어요", "끝"]
        session = make(tmp_path, monkeypatch, lead, approver=approver, members=stoppable(asked))
        await session.asend("해 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)
        await until(lambda: any(m["state"] == "asking" for m in members_of(session)))
        [member] = members_of(session)
        session.taskforce.stop_member(card.id, member["id"])
        await until(lambda: taskforce_items(session, active=False))
        [done] = taskforce_items(session, active=False)
        assert done.members[0]["state"] == "stopped" and asked == []
        [approval] = [i for i in session.snapshot().items if isinstance(i, ApprovalItem)]
        assert approval.decision == "deny"
        await until(lambda: not session._turns)

    asyncio.run(go())


def test_an_agent_stopped_while_others_wait_leaves_the_card_to_them(tmp_path, monkeypatch):
    async def go():
        asked = []
        gate = asyncio.Event()
        approver = Approver(decision="deny", gate=gate)
        script = 'phase("작성")\nresult = await parallel([agent("wait 1"), agent("wait 2")])\n'
        steps = [{"title": "작성", "count": 2, "model": "fake"}]
        lead = [propose(script=script, steps=steps), "제안했어요", "끝"]
        session = make(tmp_path, monkeypatch, lead, approver=approver, members=stoppable(asked))
        await session.asend("해 줘")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)

        def approval():
            found = [i for i in session.snapshot().active if isinstance(i, ApprovalItem)]
            return found[0] if found else None

        await until(lambda: approval() is not None and len(approval().asked_by) == 2)
        session.taskforce.stop_member(card.id, "a1")
        await until(lambda: [ask.task for ask in approval().asked_by] == ["wait 2"])
        gate.set()
        await until(lambda: taskforce_items(session, active=False))
        [done] = taskforce_items(session, active=False)
        assert [m["state"] for m in done.members] == ["stopped", "done"]
        await until(lambda: not session._turns)

    asyncio.run(go())
