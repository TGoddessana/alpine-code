"""Session with items and storage: item events, seq, approvals as items, cancel, persist and resume."""

import asyncio
from pathlib import Path

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import (
    ApprovalItem,
    ApprovalRequest,
    Decision,
    ItemCompleted,
    ItemEvent,
    Mode,
    RunStopped,
    Session,
    Settings,
    ToolCallItem,
    UserMessage,
    delete_session,
    file_storage,
    item_to_dict,
    list_sessions,
)
from alpine_core import session as session_module
from alpine_core.items import AgentMessage, InfoChanged


class SyncApprover:
    def __init__(self, *decisions: Decision) -> None:
        self.decisions = list(decisions)
        self.requests: list[ApprovalRequest] = []

    def approve(self, request: ApprovalRequest) -> Decision:
        self.requests.append(request)
        return self.decisions.pop(0)


class AsyncApprover:
    """Waits until the test answers, like the server does."""

    def __init__(self) -> None:
        self.requests: list[ApprovalRequest] = []
        self.asked = asyncio.Event()
        self.answer: asyncio.Future[Decision] | None = None

    async def aapprove(self, request: ApprovalRequest) -> Decision:
        self.requests.append(request)
        self.answer = asyncio.get_running_loop().create_future()
        self.asked.set()
        return await self.answer


def make(tmp_path: Path, monkeypatch, replies, approver=None, *, storage=None, mode=Mode.DEFAULT):
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    log: list[tuple[str, int, ItemEvent]] = []
    session = Session(
        Settings(model="fake", mode=mode),
        on_item_event=lambda sid, seq, event: log.append((sid, seq, event)),
        approver=approver or SyncApprover(),
        cwd=tmp_path,
        storage=storage,
    )
    return session, log


def kinds(session):
    return [item.kind for item in session.snapshot().items]


def test_a_text_reply_makes_user_and_agent_items_with_growing_seq(tmp_path, monkeypatch):
    session, log = make(tmp_path, monkeypatch, ["Hello there"])
    assert session.send("hi") == "Hello there"
    snap = session.snapshot()
    [user, agent] = snap.items
    assert user == UserMessage(user.id, "hi") and agent == AgentMessage(agent.id, "Hello there")
    assert snap.active == () and snap.info.status == "idle" and snap.info.title == "hi"
    seqs = [seq for _, seq, _ in log]
    assert seqs == list(range(1, len(seqs) + 1)) and snap.seq == seqs[-1]
    assert {sid for sid, _, _ in log} == {session.id}
    statuses = [e.info.status for _, _, e in log if isinstance(e, InfoChanged)]
    assert statuses == ["running", "idle"]


def test_a_tool_call_with_an_approval_item(tmp_path, monkeypatch):
    (tmp_path / "f.py").write_text("x = 1\n")
    replies = [tool_call("edit", path="f.py", old_string="x = 1", new_string="x = 2"), "Done"]
    approver = SyncApprover(Decision("allow_always"))
    session, log = make(tmp_path, monkeypatch, replies, approver)
    session.send("bump")
    assert kinds(session) == ["user_message", "approval", "tool_call", "agent_message"]
    approval = next(i for i in session.snapshot().items if isinstance(i, ApprovalItem))
    call = next(i for i in session.snapshot().items if isinstance(i, ToolCallItem))
    assert approval.decision == "allow_always" and approval.call_id == call.id and call.status == "done"
    assert approver.requests[0].request_id == approval.id and approver.requests[0].call_id == call.id
    statuses = [e.info.status for _, _, e in log if isinstance(e, InfoChanged)]
    assert statuses == ["running", "waiting", "running", "idle"]


def test_deny_without_feedback_is_a_permission_stop(tmp_path, monkeypatch):
    replies = [tool_call("bash", command="echo 1"), "never"]
    session, _ = make(tmp_path, monkeypatch, replies, SyncApprover(Decision("deny")))
    assert session.send("go") is None
    *_, stopped = session.snapshot().items
    assert isinstance(stopped, RunStopped) and stopped.reason == "permission"
    approval = next(i for i in session.snapshot().items if isinstance(i, ApprovalItem))
    call = next(i for i in session.snapshot().items if isinstance(i, ToolCallItem))
    assert approval.decision == "deny" and call.status == "denied" and session.info.status == "idle"


def test_deny_with_feedback_keeps_running(tmp_path, monkeypatch):
    replies = [tool_call("bash", command="echo 1"), "OK"]
    session, _ = make(tmp_path, monkeypatch, replies, SyncApprover(Decision("deny", "no")))
    assert session.send("go") == "OK"
    approval = next(i for i in session.snapshot().items if isinstance(i, ApprovalItem))
    assert approval.feedback == "no" and kinds(session)[-1] == "agent_message"


def test_async_approver_waits_as_an_active_item_and_cancel_stops_the_run(tmp_path, monkeypatch):
    asyncio.run(_wait_then_cancel(tmp_path, monkeypatch))


async def _wait_then_cancel(tmp_path, monkeypatch):
    approver = AsyncApprover()
    session, _ = make(tmp_path, monkeypatch, [tool_call("bash", command="echo 1"), "done"], approver)
    task = asyncio.create_task(session.asend("go"))
    await approver.asked.wait()
    snap = session.snapshot()
    [active] = snap.active
    assert isinstance(active, ApprovalItem) and active.id == approver.requests[0].request_id
    assert snap.info.status == "waiting"
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    snap = session.snapshot()
    assert snap.active == () and snap.info.status == "idle"
    approval = next(i for i in snap.items if isinstance(i, ApprovalItem))
    assert approval.decision == "deny"
    assert isinstance(snap.items[-1], RunStopped) and snap.items[-1].reason == "interrupted"


def test_async_approver_answer_continues(tmp_path, monkeypatch):
    asyncio.run(_wait_then_answer(tmp_path, monkeypatch))


async def _wait_then_answer(tmp_path, monkeypatch):
    approver = AsyncApprover()
    session, _ = make(tmp_path, monkeypatch, [tool_call("bash", command="echo 1"), "done"], approver)
    task = asyncio.create_task(session.asend("go"))
    await approver.asked.wait()
    approver.answer.set_result(Decision("allow"))
    assert await task == "done"
    assert session.info.status == "idle"


def test_persist_then_resume_continues_seq(tmp_path, monkeypatch):
    storage = file_storage()
    session, log = make(tmp_path, monkeypatch, ["one", "two"], storage=storage)
    session.send("first")
    seq = session.seq
    [info] = list_sessions(storage)
    assert info.id == session.id and info.title == "first" and info.status == "idle" and info.usage.requests == 1
    _, records = storage.log.read(session.id)
    assert [d["kind"] for _, d in records] == ["user_message", "agent_message"]
    assert [d for _, d in records] == [item_to_dict(i) for i in session.snapshot().items]

    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(["three"]))
    resumed = Session.resume(storage, session.id, Settings(model="other"), approver=SyncApprover())
    assert resumed.id == session.id and resumed.info.model == "fake"
    assert resumed.snapshot().items == session.snapshot().items
    assert resumed.seq >= records[-1][0] and resumed.seq <= seq
    assert resumed.send("second") == "three"
    assert resumed.snapshot().seq > seq
    assert kinds(resumed) == ["user_message", "agent_message", "user_message", "agent_message"]
    _, records = storage.log.read(session.id)
    assert [s for s, _ in records] == sorted({s for s, _ in records}) and len(records) == 4


def test_seq_never_goes_back_across_a_restart(tmp_path, monkeypatch):
    storage = file_storage()
    session, log = make(tmp_path, monkeypatch, ["one"], storage=storage)
    session.send("first")
    emitted = max(seq for _, seq, _ in log)  # includes info_changed events, which are not stored
    _, records = storage.log.read(session.id)
    assert emitted > records[-1][0]
    resumed = Session.resume(storage, session.id, Settings(model="fake"), approver=SyncApprover())
    assert resumed.seq >= emitted


def test_crash_mid_run_resumes_with_run_stopped_interrupted(tmp_path, monkeypatch):
    storage = file_storage()
    session, _ = make(tmp_path, monkeypatch, ["ok"], storage=storage)
    session.send("hi")
    info, _ = storage.log.read(session.id)
    from dataclasses import replace

    storage.log.update(replace(info, status="running"))  # the process died before the run ended
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel([]))
    resumed = Session.resume(storage, session.id, Settings(model="fake"), approver=SyncApprover())
    *_, last = resumed.snapshot().items
    assert isinstance(last, RunStopped) and last.reason == "interrupted"
    assert resumed.info.status == "idle" and storage.log.read(session.id)[0].status == "idle"
    assert isinstance(ItemCompleted(last), ItemCompleted)
    _, records = storage.log.read(session.id)
    assert records[-1][1]["kind"] == "run_stopped"


def test_resume_a_session_without_messages_and_unknown_ids(tmp_path, monkeypatch):
    storage = file_storage()
    session, _ = make(tmp_path, monkeypatch, ["hi"], storage=storage)
    assert session.info.title == "New session" and not session.has_conversation
    resumed = Session.resume(storage, session.id, Settings(model="fake"), approver=SyncApprover())
    assert resumed.snapshot().items == () and not resumed.has_conversation
    with pytest.raises(LookupError):
        Session.resume(storage, "nope", Settings(model="fake"), approver=SyncApprover())


def test_set_mode_updates_info_and_delete_removes_everything(tmp_path, monkeypatch):
    storage = file_storage()
    session, log = make(tmp_path, monkeypatch, ["hi"], storage=storage)
    session.send("hello")
    session.mode = Mode.YOLO
    assert session.info.mode == Mode.YOLO.value and storage.log.read(session.id)[0].mode == Mode.YOLO.value
    assert isinstance(log[-1][2], InfoChanged) and log[-1][2].info.mode == Mode.YOLO.value
    session.delete()
    assert list_sessions(storage) == [] and storage.states.read(session.id) is None
    delete_session(storage, session.id)  # again: nothing happens
