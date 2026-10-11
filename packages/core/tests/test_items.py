import json

import pytest

from alpine_core import (
    AgentChanged,
    AgentMessage,
    AgentSwitched,
    ApprovalItem,
    Compaction,
    ItemCompleted,
    ItemDelta,
    ItemDiscarded,
    ItemRecorder,
    ItemStarted,
    NoticeItem,
    RunStopped,
    StatusLine,
    ToolCallItem,
    UserMessage,
    event_from_dict,
    event_to_dict,
    item_from_dict,
    item_to_dict,
)
from alpine_core.events import (
    AssistantDone,
    ContextCompacted,
    Failed,
    Interrupted,
    Notice,
    RunFinished,
    TextDelta,
    ToolFinished,
    ToolStarted,
    TurnStarted,
    UsageInfo,
)
from alpine_core.items import Deleted, InfoChanged


def make(seq=0, items=()):
    log: list[tuple[int, object]] = []
    counter = iter(range(1, 1000))
    rec = ItemRecorder(lambda s, e: log.append((s, e)), seq=seq, items=items, id_factory=lambda: f"i{next(counter)}")
    return rec, log


def events(log):
    return [e for _, e in log]


def types(log):
    return [e.type for _, e in log]


def test_seq_grows_from_start():
    rec, log = make(seq=10)
    rec.add_user_message("hi")
    rec.info_changed({"id": "x"})
    rec.deleted()
    assert [s for s, _ in log] == [11, 12, 13, 14]
    assert rec.seq == 14


def test_user_message_started_then_completed():
    rec, log = make()
    item = rec.add_user_message("hi")
    assert item == UserMessage("i1", "hi") and item.kind == "user_message"
    assert events(log) == [ItemStarted(item), ItemCompleted(item)]
    assert rec.items == (item,) and rec.active == ()


def test_streaming_agent_message():
    rec, log = make()
    rec.handle(TurnStarted(1))
    rec.handle(TextDelta("Hel"))
    rec.handle(TextDelta("lo"))
    assert rec.active == (AgentMessage("i1", "Hello"),)
    assert rec.items == ()
    rec.handle(AssistantDone("Hello"))
    assert events(log) == [
        ItemStarted(AgentMessage("i1", "")),
        ItemDelta("i1", "Hel"),
        ItemDelta("i1", "lo"),
        ItemCompleted(AgentMessage("i1", "Hello")),
    ]
    assert rec.active == () and rec.items == (AgentMessage("i1", "Hello"),)


def test_leading_whitespace_is_held_until_text():
    rec, log = make()
    rec.handle(TextDelta("\n"))
    assert log == []
    rec.handle(TextDelta("Hi"))
    assert events(log)[1] == ItemDelta("i1", "\nHi")


def test_tool_only_reply_makes_no_message():
    rec, log = make()
    rec.handle(TurnStarted(1))
    rec.handle(TextDelta("\n\n"))
    rec.handle(AssistantDone(""))
    assert log == []


def test_whitespace_streamed_message_with_empty_done_is_discarded():
    rec, log = make()
    rec.handle(TextDelta("x"))
    rec.handle(AssistantDone("  "))  # full text says nothing, streamed text is kept
    assert rec.items == (AgentMessage("i1", "x"),)


def test_non_streamed_reply():
    rec, log = make()
    rec.handle(AssistantDone("all at once"))
    assert rec.items == (AgentMessage("i1", "all at once"),)
    assert types(log) == ["item_started", "item_completed"]


def test_done_text_replaces_streamed_text():
    rec, _ = make()
    rec.handle(TextDelta("abc"))
    rec.handle(AssistantDone("abcd"))
    assert rec.items == (AgentMessage("i1", "abcd"),)


def test_new_turn_discards_unfinished_reply():
    rec, log = make()
    rec.handle(TextDelta("part"))
    rec.handle(TurnStarted(2))
    assert events(log)[-1] == ItemDiscarded("i1")
    assert rec.active == () and rec.items == ()
    rec.handle(TextDelta("again"))
    rec.handle(AssistantDone("again"))
    assert rec.items == (AgentMessage("i2", "again"),)


def test_tool_call_lifecycle():
    rec, log = make()
    rec.handle(ToolStarted("c1", "bash", {"command": "ls"}))
    assert rec.active == (ToolCallItem("c1", "bash", {"command": "ls"}, "running"),)
    rec.handle(ToolFinished("c1", "bash", {"command": "ls"}, "a\nb", "done", 0))
    done = ToolCallItem("c1", "bash", {"command": "ls"}, "done", "a\nb", 0)
    assert events(log) == [ItemStarted(ToolCallItem("c1", "bash", {"command": "ls"})), ItemCompleted(done)]
    assert rec.items == (done,) and rec.active == ()


@pytest.mark.parametrize("kind", ["denied", "cancelled"])
def test_tool_finished_without_start(kind):
    rec, log = make()
    rec.handle(ToolFinished("c9", "edit", {"path": "a"}, "declined", kind, 0))
    item = ToolCallItem("c9", "edit", {"path": "a"}, kind, "declined", 0)
    assert events(log) == [ItemStarted(item), ItemCompleted(item)]


def test_tool_images():
    rec, _ = make()
    rec.handle(ToolStarted("c1", "read", {}))
    rec.handle(ToolFinished("c1", "read", {}, "(image/png, 1KB)", "done", 1))
    assert rec.items[0].images == 1


def test_compaction_and_notice_events():
    rec, _ = make()
    rec.handle(ContextCompacted(100, 20))
    rec.handle(Notice("fell back"))
    assert rec.items == (Compaction("i1", 100, 20), StatusLine("i2", "fell back"))


def test_add_notice():
    rec, _ = make()
    assert rec.add_notice("go on", "hand_back") == NoticeItem("i1", "go on", "hand_back")


def test_approval_flow():
    rec, log = make()
    item = rec.start_approval("c1", "Edit a.py", "diff", "diff", "outside", "edits to a.py")
    assert isinstance(item, ApprovalItem) and item.decision is None
    assert rec.has_active_approval and rec.active == (item,)
    done = rec.finish_approval(item.id, "allow_always")
    assert done.decision == "allow_always"
    assert not rec.has_active_approval
    assert events(log) == [ItemStarted(item), ItemCompleted(done)]
    assert rec.items == (done,)


def test_first_answer_wins():
    rec, log = make()
    item = rec.start_approval("c1", "t")
    assert rec.finish_approval(item.id, "allow") is not None
    n = len(log)
    assert rec.finish_approval(item.id, "deny") is None
    assert rec.finish_approval("nope", "deny") is None
    assert len(log) == n


def test_interrupted_marks_running_tools_and_completes_partial_message():
    rec, log = make()
    rec.handle(TextDelta("part"))
    rec.handle(AssistantDone("part"))
    rec.handle(TextDelta("more"))
    rec.handle(ToolStarted("c1", "bash", {}))
    rec.handle(Interrupted())
    assert rec.active == ()
    assert [i.kind for i in rec.items] == ["agent_message", "agent_message", "tool_call", "run_stopped"]
    assert rec.items[1].text == "more"
    assert rec.items[-1].reason == "interrupted"
    assert {i.status for i in rec.items if isinstance(i, ToolCallItem)} == {"interrupted"}


def test_interrupted_with_pending_approval_denies_it():
    rec, _ = make()
    item = rec.start_approval("c1", "t")
    rec.handle(Interrupted())
    assert rec.items[0] == ApprovalItem(item.id, "c1", "t", decision="deny")
    assert rec.items[1].reason == "interrupted"


def test_deny_with_stop_then_interrupted_is_permission():
    rec, _ = make()
    item = rec.start_approval("c1", "t")
    rec.finish_approval(item.id, "deny", stop=True)
    rec.handle(ToolFinished("c1", "bash", {}, "declined", "denied", 0))
    rec.handle(Interrupted())
    assert rec.items[-1] == RunStopped("i2", "permission")


def test_deny_without_stop_or_cancelled_is_not_permission():
    rec, _ = make()
    item = rec.start_approval("c1", "t")
    rec.finish_approval(item.id, "deny", "use ls")
    rec.handle(Interrupted())
    assert rec.items[-1].reason == "interrupted"
    item = rec.start_approval("c2", "t")
    rec.finish_approval(item.id, "deny")
    rec.handle(Interrupted())
    assert rec.items[-1].reason == "interrupted"
    item = rec.start_approval("c3", "t")
    rec.finish_approval(item.id, "deny", stop=True, cancelled=True)
    rec.handle(Interrupted())
    assert rec.items[-1].reason == "interrupted"


def test_new_user_message_clears_stop_flag():
    rec, _ = make()
    item = rec.start_approval("c1", "t")
    rec.finish_approval(item.id, "deny", stop=True)
    rec.add_user_message("next")
    rec.handle(Interrupted())
    assert rec.items[-1].reason == "interrupted"


def test_failed_keeps_partial_reply_and_reports_message():
    rec, _ = make()
    rec.handle(TextDelta("half"))
    rec.handle(Failed("AuthError: bad key"))
    assert rec.items == (AgentMessage("i1", "half"), RunStopped("i2", "failed", "AuthError: bad key"))


def test_run_finished_answered_adds_nothing():
    rec, log = make()
    rec.handle(RunFinished("answered", UsageInfo()))
    rec.handle(RunFinished("finish", UsageInfo()))
    rec.handle(RunFinished(None, UsageInfo()))
    assert log == []


def test_run_finished_limit():
    rec, _ = make()
    rec.handle(RunFinished("limit", UsageInfo()))
    assert rec.items == (RunStopped("i1", "limit"),)


def test_stop_run_explicit_repeating():
    rec, _ = make()
    rec.handle(ToolStarted("c1", "bash", {}))
    stopped = rec.stop_run("repeating", "same call 3 times")
    assert stopped == RunStopped("i1", "repeating", "same call 3 times")
    assert rec.items[0].status == "interrupted"


def test_discard_active_item():
    rec, log = make()
    rec.handle(TextDelta("x"))
    assert rec.discard("i1") is True
    assert rec.discard("i1") is False
    assert rec.active == () and types(log)[-1] == "item_discarded"
    rec.handle(AssistantDone("x"))  # a later done does not resurrect the discarded stream id
    assert rec.items[0].id != "i1"


def test_resume_keeps_items_and_continues_seq():
    old = UserMessage("u", "hi")
    rec, log = make(seq=7, items=[old])
    rec.add_user_message("again")
    assert rec.items[0] == old and len(rec.items) == 2
    assert log[0][0] == 8


def test_default_ids_are_unique():
    rec = ItemRecorder(lambda s, e: None)
    a = rec.add_user_message("a")
    b = rec.add_user_message("b")
    assert a.id != b.id


ALL_ITEMS = [
    UserMessage("1", "hi"),
    AgentMessage("2", "yo"),
    ToolCallItem("c", "bash", {"command": "ls", "n": [1, 2]}, "done", "out", 2),
    ToolCallItem("c", "bash"),
    ApprovalItem("3", "c", "t", "p", "diff", "r", "m", "allow_always", "f"),
    ApprovalItem("3", "c", "t"),
    NoticeItem("4", "go on", "hand_back"),
    StatusLine("5", "fallback"),
    Compaction("6", 10, 2),
    RunStopped("7", "failed", "boom"),
    AgentMessage("2", "yo", "a1"),
    AgentSwitched("8", "a1", "Reviewer", "glasses", 3),
    AgentChanged("9", "a1", "", "antenna", 2, ["fetch"], ["bash"], True, "x/y"),
    AgentChanged("9", "a1", "Site", "hardhat", 1, [], [], False, None),
]


@pytest.mark.parametrize("item", ALL_ITEMS)
def test_item_round_trip(item):
    data = item_to_dict(item)
    assert data["kind"] == item.kind
    assert item_from_dict(json.loads(json.dumps(data))) == item


def test_item_dict_is_snake_case():
    data = item_to_dict(Compaction("6", 10, 2))
    assert data == {"kind": "compaction", "id": "6", "before_tokens": 10, "after_tokens": 2}
    assert "preview_kind" in item_to_dict(ALL_ITEMS[4]) and "call_id" in item_to_dict(ALL_ITEMS[4])


def test_item_from_dict_errors():
    with pytest.raises(ValueError):
        item_from_dict({"kind": "nope", "id": "1"})
    with pytest.raises(ValueError):
        item_from_dict({"kind": "user_message", "id": "1"})
    with pytest.raises(ValueError):
        item_from_dict({"kind": "user_message", "id": "1", "text": "x", "extra": 1})


def test_event_round_trip():
    for event in [
        InfoChanged({"id": "s"}),
        Deleted(),
        ItemStarted(UserMessage("1", "hi")),
        ItemDelta("1", "x"),
        ItemCompleted(StatusLine("2", "l")),
        ItemDiscarded("1"),
    ]:
        data = json.loads(json.dumps(event_to_dict(event)))
        assert data["type"] == event.type
        assert event_from_dict(data) == event


def test_info_dataclass_becomes_dict():
    from dataclasses import dataclass

    @dataclass(frozen=True)
    class Info:
        id: str
        title: str

    assert event_to_dict(InfoChanged(Info("a", "b"))) == {"type": "info_changed", "info": {"id": "a", "title": "b"}}


def test_event_from_dict_errors():
    with pytest.raises(ValueError):
        event_from_dict({"type": "nope"})
    with pytest.raises(ValueError):
        event_from_dict({"type": "item_delta", "item_id": "1"})


def test_recorder_marks_replies_with_the_agent():
    rec, _ = make()
    rec.agent = "a1"
    rec.handle(AssistantDone("all at once"))
    assert rec.items == (AgentMessage("i1", "all at once", "a1"),)


def test_recorder_adds_agent_dividers():
    rec, _ = make()
    switched = rec.add_agent_switched("a1", "Reviewer", "glasses", 3)
    changed = rec.add_agent_changed("a1", "Reviewer", "glasses", 3, ["fetch"], [], True, None)
    assert rec.items == (switched, changed)
    assert item_to_dict(changed)["added"] == ["fetch"] and item_to_dict(changed)["kind"] == "agent_changed"
