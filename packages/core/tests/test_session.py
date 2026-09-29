from pathlib import Path

import pytest
from alpineagents import Image, ProviderError
from alpineagents.testing import FakeModel, tool_call

from alpine_core import (
    ApprovalRequest,
    AssistantDone,
    Decision,
    Failed,
    Interrupted,
    Mode,
    RunFinished,
    Session,
    Settings,
    ToolFinished,
)
from alpine_core import session as session_module


class Approver:
    def __init__(self, *decisions: Decision) -> None:
        self.decisions = list(decisions)
        self.requests: list[ApprovalRequest] = []

    def approve(self, request: ApprovalRequest) -> Decision:
        self.requests.append(request)
        return self.decisions.pop(0)


def make_session(tmp_path: Path, monkeypatch, replies, *decisions, mode=Mode.DEFAULT):
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    events = []
    approver = Approver(*decisions)
    session = Session(Settings(model="fake", mode=mode), on_event=events.append, approver=approver, cwd=tmp_path)
    return session, events, approver


def finished(events):
    return [(e.name, e.kind) for e in events if isinstance(e, ToolFinished)]


def test_read_runs_without_asking(tmp_path, monkeypatch):
    (tmp_path / "a.txt").write_text("hello\n")
    session, events, approver = make_session(tmp_path, monkeypatch, [tool_call("read", path="a.txt"), "It says hello"])
    assert session.send("what is in a.txt?") == "It says hello"
    assert approver.requests == []
    assert finished(events) == [("read", "done")]
    assert isinstance(events[-1], RunFinished) and events[-1].stopped_by == "is_answered"
    assert any(isinstance(e, AssistantDone) and e.text == "It says hello" for e in events)


def test_tool_errors_reach_the_model_and_the_run_continues(tmp_path, monkeypatch):
    seen = []

    def second(request):
        seen.append(request.messages[-1])
        return "That file does not exist"

    session, events, _ = make_session(tmp_path, monkeypatch, [tool_call("read", path="nope.txt"), second])
    assert session.send("read nope.txt") == "That file does not exist"
    [done] = [e for e in events if isinstance(e, ToolFinished)]
    assert done.kind == "error" and done.is_error and done.result == "nope.txt does not exist"
    [block] = seen[0].content
    assert block.is_error and block.content == "nope.txt does not exist"


def test_read_sends_images_to_the_model(tmp_path, monkeypatch):
    (tmp_path / "dot.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 100)
    seen = []

    def second(request):
        seen.append(request.messages[-1])
        return "A dot"

    session, events, approver = make_session(tmp_path, monkeypatch, [tool_call("read", path="dot.png"), second])
    assert session.send("what is dot.png?") == "A dot"
    assert approver.requests == []
    [done] = [e for e in events if isinstance(e, ToolFinished)]
    assert (done.kind, done.images, done.result) == ("done", 1, "(image/png, 108B)")
    [block] = seen[0].content
    [image] = block.content
    assert isinstance(image, Image) and image.media_type == "image/png"


def test_edit_asks_and_shows_a_diff(tmp_path, monkeypatch):
    (tmp_path / "f.py").write_text("x = 1\n")
    replies = [tool_call("edit", path="f.py", old_string="x = 1", new_string="x = 2"), "Done"]
    session, events, approver = make_session(tmp_path, monkeypatch, replies, Decision("allow"))
    session.send("bump x")
    assert (tmp_path / "f.py").read_text() == "x = 2\n"
    request = approver.requests[0]
    assert request.title == "Edit f.py" and "-x = 1" in request.preview and "+x = 2" in request.preview


def test_deny_with_feedback_continues(tmp_path, monkeypatch):
    (tmp_path / "f.py").write_text("x = 1\n")
    seen = []

    def second(request):
        seen.append(request.messages[-1])
        return "OK, I will leave it"

    replies = [tool_call("edit", path="f.py", old_string="x = 1", new_string="x = 2"), second]
    session, events, _ = make_session(tmp_path, monkeypatch, replies, Decision("deny", "keep x as is"))
    assert session.send("bump x") == "OK, I will leave it"
    assert (tmp_path / "f.py").read_text() == "x = 1\n"
    assert finished(events) == [("edit", "denied")]
    assert "keep x as is" in str(seen[0])


def test_deny_without_feedback_stops_and_conversation_continues(tmp_path, monkeypatch):
    replies = [tool_call("bash", command="rm -rf /tmp/nothing"), "Sure, what next?"]
    session, events, _ = make_session(tmp_path, monkeypatch, replies, Decision("deny"))
    assert session.send("clean up") is None
    assert isinstance(events[-1], Interrupted)
    assert session.send("never mind, say hi") == "Sure, what next?"


def test_allow_always_stops_asking(tmp_path, monkeypatch):
    replies = [tool_call("bash", command="echo 1"), tool_call("bash", command="echo 2"), "Done"]
    session, _, approver = make_session(tmp_path, monkeypatch, replies, Decision("allow_always"))
    session.send("run things")
    assert len(approver.requests) == 1


@pytest.mark.parametrize(("mode", "asks"), [(Mode.ACCEPT_EDITS, 1), (Mode.YOLO, 0)])
def test_modes(tmp_path, monkeypatch, mode, asks):
    replies = [[tool_call("write", path="n.txt", content="hi\n"), tool_call("bash", command="cat n.txt")], "Done"]
    session, events, approver = make_session(tmp_path, monkeypatch, replies, Decision("allow"), mode=mode)
    session.send("go")
    assert len(approver.requests) == asks
    assert sorted(finished(events)) == [("bash", "done"), ("write", "done")]


def test_provider_error_becomes_failed_event(tmp_path, monkeypatch):
    session, events, _ = make_session(tmp_path, monkeypatch, [ProviderError("server down")])
    assert session.send("hi") is None
    assert isinstance(events[-1], Failed) and "server down" in events[-1].message


def test_clear_starts_over(tmp_path, monkeypatch):
    session, _, _ = make_session(tmp_path, monkeypatch, ["one", "two"])
    session.send("a")
    assert session.has_conversation and session.usage.requests == 1
    session.clear()
    assert not session.has_conversation and session.usage.requests == 0
