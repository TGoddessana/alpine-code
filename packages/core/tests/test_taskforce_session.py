"""A TF in a session: proposed by the model, started by the user, agents under the session's permissions, the result
back to the model, and the run kept for continuing after a restart."""

import asyncio
import textwrap
import threading

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import Decision, Mode, Session, Settings, file_storage
from alpine_core import session as session_module
from alpine_core.items import ApprovalItem, NoticeItem, TaskForceItem
from alpine_core.taskforce import available
from alpine_core.taskforce import team as team_module

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


def make(tmp_path, monkeypatch, lead, approver=None, storage=None, members=None, mode=Mode.DEFAULT):
    model = FakeModel(lead)  # one model however often the agent is rebuilt
    monkeypatch.setattr(session_module, "make_model", lambda settings: model)
    monkeypatch.setattr(team_module, "make_model", members or member_model())
    return Session(
        Settings(model="fake", mode=mode),
        approver=approver or Approver(),
        cwd=tmp_path,
        storage=storage,
        taskforce=True,
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


def test_agents_asking_the_same_thing_share_one_card(tmp_path, monkeypatch):
    async def go():
        gate = asyncio.Event()
        approver = Approver(gate=gate)
        lead = [propose(script='await parallel([agent("a"), agent("b")])\n'), "제안했어요", "끝"]
        writes = member_model(first=tool_call("write", path="notes.md", content="x"))
        session = make(tmp_path, monkeypatch, lead, approver=approver, members=writes)
        await session.asend("go")
        [card] = taskforce_items(session)
        session.taskforce.start(card.id)

        def asking():
            cards = [i for i in session.snapshot().active if isinstance(i, ApprovalItem)]
            return cards and len(cards[0].asked_by) == 2

        await until(asking)
        [approval] = [i for i in session.snapshot().active if isinstance(i, ApprovalItem)]
        assert approval.asked_by == ["a", "b"] and len(approver.requests) == 1
        assert session.info.status == "idle"  # the session's own turn is not waiting
        gate.set()
        await until(lambda: taskforce_items(session, active=False))
        assert [m["state"] for m in taskforce_items(session, active=False)[0].members] == ["done", "done"]

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
