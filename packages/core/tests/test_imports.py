"""Conversations from Claude Code and Codex: finding them, reading them, and continuing them as sessions."""

import json
import re
from pathlib import Path

import pytest
from alpineagents.testing import FakeModel
from alpineagents.types import Message, ToolCall, ToolResultBlock

from alpine_core import (
    Compaction,
    Imported,
    Session,
    Settings,
    ToolCallItem,
    file_storage,
    find_external_sessions,
    import_session,
)
from alpine_core import session as session_module
from alpine_core.imports import read
from alpine_core.imports._transcript import model_messages, screen_items, shape

PROJECT = "/work/app"


class Approver:
    def approve(self, request):
        raise AssertionError("no tool should run")


def slug(path) -> str:
    return re.sub(r"[^A-Za-z0-9]", "-", str(path))


def write_jsonl(path: Path, records: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in records))
    return path


@pytest.fixture
def project(tmp_path):
    folder = tmp_path / "work" / "app"
    (folder / "sub").mkdir(parents=True)
    return folder


# ------------------------------------------------------------------------------------------------- Claude Code


def claude(uid, parent, kind, content, **more):
    record = {"type": kind, "uuid": uid, "parentUuid": parent, "sessionId": "s", "cwd": more.pop("cwd", PROJECT)}
    record["message"] = {"role": kind, "content": content, **more.pop("message", {})}
    return record | more


def claude_session(cwd: str) -> list[dict]:
    return [
        {"type": "file-history-snapshot", "messageId": "x"},  # no uuid: skipped
        claude("u0", None, "user", "<local-command-caveat>Caveat</local-command-caveat>", isMeta=True, cwd=cwd),
        claude("u1", "u0", "user", "Fix the login bug\n<system-reminder>be careful</system-reminder>", cwd=cwd),
        {"type": "attachment", "uuid": "at", "parentUuid": "u1", "attachment": {"type": "date"}},
        claude(
            "a1", "at", "assistant", [{"type": "thinking", "thinking": "", "signature": "sig"}], message={"id": "m1"}
        ),
        claude("a2", "a1", "assistant", [{"type": "text", "text": "Looking."}], message={"id": "m1"}),
        claude(
            "a3",
            "a2",
            "assistant",
            [{"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "a.py"}}],
            message={"id": "m1"},
        ),
        claude(
            "a4",
            "a3",
            "assistant",
            [{"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "ls"}}],
            message={"id": "m1"},
        ),
        # Calls made together: each result is a sibling, and the chain goes on from the last one.
        claude("r1", "a3", "user", [{"type": "tool_result", "tool_use_id": "t1", "content": "print(1)"}]),
        claude(
            "r2",
            "a4",
            "user",
            [
                {
                    "type": "tool_result",
                    "tool_use_id": "t2",
                    "content": [{"type": "text", "text": "a.py"}],
                    "is_error": True,
                }
            ],
        ),
        {"type": "some-future-record", "whatever": 1},
        claude("a5", "r2", "assistant", [{"type": "text", "text": "Fixed it."}], message={"id": "m2"}),
        {"type": "ai-title", "aiTitle": "Login bug", "sessionId": "s"},
    ]


def test_claude_code_conversation_keeps_calls_and_drops_thinking_and_app_text(project, tmp_path):
    root = tmp_path / "claude"
    folder = root / slug(project)
    write_jsonl(folder / "s1.jsonl", claude_session(str(project)))

    [found] = find_external_sessions(project, claude_projects=root, codex_root=tmp_path / "none")
    assert (found.source, found.id, found.title) == ("claude_code", "s1", "Login bug")

    transcript = read(found)
    messages = model_messages(transcript, "claude_code")
    assert [m.role for m in messages] == ["user", "assistant", "user", "assistant", "user"]
    assert messages[0].text == "Fix the login bug"
    assert messages[1].text == "Looking."
    assert [c.name for c in messages[1].tool_calls] == ["Read", "Bash"]
    results = [b for b in messages[2].content if isinstance(b, ToolResultBlock)]
    assert [(r.call_id, r.content, r.is_error) for r in results] == [("t1", "print(1)", False), ("t2", "a.py", True)]
    assert messages[-1].is_notice and "Claude Code" in messages[-1].text

    items = screen_items(transcript, "claude_code")
    assert [i.kind for i in items] == [
        "user_message",
        "agent_message",
        "tool_call",
        "tool_call",
        "agent_message",
        "imported",
    ]
    assert [(i.name, i.status) for i in items if isinstance(i, ToolCallItem)] == [("Read", "done"), ("Bash", "error")]


def test_claude_code_compaction_gives_the_model_the_summary_and_the_screen_everything(project, tmp_path):
    root = tmp_path / "claude"
    records = [
        claude("u1", None, "user", "Start", cwd=str(project)),
        claude("a1", "u1", "assistant", [{"type": "text", "text": "Old answer"}], message={"id": "m1"}),
        {
            "type": "system",
            "subtype": "compact_boundary",
            "uuid": "b",
            "parentUuid": None,
            "logicalParentUuid": "a1",
            "compactMetadata": {"trigger": "auto", "preTokens": 9000},
        },
        claude("u2", "b", "user", "Summary of before", isCompactSummary=True, isVisibleInTranscriptOnly=True),
        claude("u3", "u2", "user", "Go on"),
        claude("a2", "u3", "assistant", [{"type": "text", "text": "New answer"}], message={"id": "m2"}),
    ]
    write_jsonl(root / slug(project) / "s2.jsonl", records)
    [found] = find_external_sessions(project, claude_projects=root, codex_root=tmp_path / "none")
    assert found.title == "Start"

    transcript = read(found)
    messages = model_messages(transcript, "claude_code")
    assert [[b.text for b in m.content] for m in messages[:2]] == [["Summary of before", "Go on"], ["New answer"]]
    items = screen_items(transcript, "claude_code")
    assert [i.kind for i in items] == [
        "user_message",
        "agent_message",
        "compaction",
        "user_message",
        "agent_message",
        "imported",
    ]
    assert next(i for i in items if isinstance(i, Compaction)).before_tokens == 9000


# ------------------------------------------------------------------------------------------------------- Codex


def line(kind, payload, ts="2026-10-01T00:00:00Z"):
    return {"timestamp": ts, "type": kind, "payload": payload}


def meta(thread, cwd, **more):
    return line(
        "session_meta",
        {
            "id": thread,
            "session_id": thread,
            "cwd": cwd,
            "cli_version": "0.160.0",
            "source": "cli",
            "originator": "codex-tui",
            "timestamp": "x",
        }
        | more,
    )


def text(role, value, kind=None):
    kind = kind or ("output_text" if role == "assistant" else "input_text")
    return line("response_item", {"type": "message", "role": role, "content": [{"type": kind, "text": value}]})


def rollout(home: Path, thread: str, records: list[dict], day="2026/10/01") -> Path:
    return write_jsonl(home / "sessions" / day / f"rollout-2026-10-01T00-00-00-{thread}.jsonl", records)


def codex_records(cwd: str) -> list[dict]:
    return [
        meta("t-1", cwd),
        text("developer", "<permissions instructions>...</permissions instructions>"),
        text("user", "# AGENTS.md instructions for /work/app\n\n<INSTRUCTIONS>x</INSTRUCTIONS>"),
        text("user", "<environment_context>\n  <cwd>/work/app</cwd>\n</environment_context>"),
        text("user", "Add a button"),
        line("event_msg", {"type": "item_completed", "item": {}}),
        line("response_item", {"type": "reasoning", "encrypted_content": "gAAA"}),
        text("assistant", "Adding it."),
        line(
            "response_item",
            {
                "type": "function_call",
                "name": "exec_command",
                "arguments": json.dumps({"cmd": "ls"}),
                "call_id": "call_1",
            },
        ),
        line(
            "response_item",
            {"type": "function_call_output", "call_id": "call_1", "output": [{"type": "input_text", "text": "a.tsx"}]},
        ),
        line(
            "response_item",
            {"type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch", "call_id": "call_2"},
        ),
        line("response_item", {"type": "custom_tool_call_output", "call_id": "call_2", "output": "Success"}),
        line("world_state", {"full": True, "state": {}}),
        text("assistant", "Done."),
    ]


def test_codex_conversation_reads_response_items_and_skips_codex_context(project, tmp_path):
    home = tmp_path / "codex"
    rollout(home, "t-1", codex_records(str(project / "sub")))
    rollout(home, "t-sub", [meta("t-sub", str(project), source={"subagent": "review"}), text("user", "review it")])
    rollout(home, "t-other", [meta("t-other", str(tmp_path / "elsewhere")), text("user", "hi")])
    write_jsonl(home / "session_index.jsonl", [{"id": "t-1", "thread_name": "Button", "updated_at": "x"}])

    [found] = find_external_sessions(project, claude_projects=tmp_path / "none", codex_root=home)
    assert (found.source, found.id, found.title) == ("codex", "t-1", "Button")

    messages = model_messages(read(found), "codex")
    assert [m.role for m in messages] == ["user", "assistant", "user", "assistant", "user", "assistant", "user"]
    assert messages[0].text == "Add a button"
    assert messages[1].tool_calls == (ToolCall("exec_command", {"cmd": "ls"}, "call_1"),)
    assert messages[3].tool_calls == (ToolCall("apply_patch", {"input": "*** Begin Patch"}, "call_2"),)
    assert messages[2].content[0].content == "a.tsx"
    assert messages[-1].is_notice and "Codex" in messages[-1].text


def test_codex_compaction_and_a_fork_prefix(project, tmp_path):
    home = tmp_path / "codex"
    parent = rollout(home, "t-p", [meta("t-p", str(project)), text("user", "First"), text("assistant", "One")])
    end = parent.stat().st_size
    with parent.open("a") as f:
        f.write(json.dumps(text("user", "Not inherited")) + "\n")
    child = [
        meta(
            "t-c", str(project), history_base={"thread_id": "t-p", "end_ordinal_exclusive": 3, "end_byte_offset": end}
        ),
        text("user", "Second"),
        text("assistant", "Two"),
        line(
            "compacted",
            {
                "message": "",
                "replacement_history": [
                    {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Second"}]},
                    {"type": "compaction", "encrypted_content": "gAAA"},
                ],
            },
        ),
        text("user", "Third"),
        text("assistant", "Three"),
        line("compacted", {"message": "Summary so far", "replacement_history": []}),
        text("user", "Fourth"),
    ]
    rollout(home, "t-c", child, day="2026/10/02")
    found = {s.id: s for s in find_external_sessions(project, claude_projects=tmp_path / "none", codex_root=home)}
    transcript = read(found["t-c"])

    items = screen_items(transcript, "codex")
    shown = [getattr(i, "text", i.kind) for i in items]
    assert shown == [
        "First",
        "One",
        "Second",
        "Two",
        "compaction",
        "Third",
        "Three",
        "compaction",
        "Fourth",
        "imported",
    ]
    # The encrypted cut is skipped; the readable one replaces what came before it.
    messages = model_messages(transcript, "codex")
    assert len(messages) == 1
    assert [b.text for b in messages[0].content] == ["Summary so far", "Fourth", messages[0].content[-1].text]


# --------------------------------------------------------------------------------------------- shaping and import


def test_shape_answers_every_call_and_drops_stray_results():
    messages = shape(
        [
            Message("assistant", (ToolCall("Bash", {}, "a.b"),)),
            Message("user", (ToolResultBlock("zzz", "stray"),)),
            Message.user("next"),
            Message("assistant", (ToolCall("mcp.tool", {}, "c"),)),
        ]
    )
    assert messages[0].is_notice
    assert messages[1].tool_calls == (ToolCall("Bash", {}, "a_b"),)
    assert [b.call_id for b in messages[2].content if isinstance(b, ToolResultBlock)] == ["a_b"]
    assert messages[2].text == "next"
    assert messages[3].tool_calls[0].name == "mcp_tool"
    assert messages[4].content[0].is_error


def test_import_then_resume_continues_with_the_whole_conversation(project, tmp_path, monkeypatch):
    root = tmp_path / "claude"
    write_jsonl(root / slug(project) / "s1.jsonl", claude_session(str(project)))
    [found] = find_external_sessions(project, claude_projects=root, codex_root=tmp_path / "none")
    storage = file_storage()
    info = import_session(storage, found, project, model="", mode="default", agent=None)
    assert info.imported_from == {"source": "claude_code", "id": "s1", "updated_at": found.updated_at}

    seen = []

    def reply(request):
        seen.append(request.messages)
        return "Continuing."

    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel([reply]))
    session = Session.resume(storage, info.id, Settings(model="fake"), approver=Approver(), cwd=project)
    assert session.info.title == "Login bug" and session.info.imported_from == info.imported_from
    assert isinstance(session.snapshot().items[-1], Imported)
    assert session.send("And the logout bug?") == "Continuing."
    [messages] = seen
    assert messages[0].text == "Fix the login bug" and messages[-1].text == "And the logout bug?"
    assert any(m.tool_calls for m in messages)
    kinds = [i.kind for i in session.snapshot().items]
    assert kinds[-3:] == ["imported", "user_message", "agent_message"]
    # Saved info keeps where it came from across changes.
    assert storage.log.read(info.id)[0].imported_from == info.imported_from


def test_a_long_project_path_matches_its_cut_folder_name(tmp_path):
    project = tmp_path / ("x" * 230)
    project.mkdir()
    root = tmp_path / "claude"
    write_jsonl(root / (slug(project)[:200] + "-abc123") / "s.jsonl", claude_session(str(project)))
    assert [s.id for s in find_external_sessions(project, claude_projects=root, codex_root=tmp_path / "none")] == ["s"]
