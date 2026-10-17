"""Actual file/command outcomes survive approvals, intermediate edits, errors and resume."""

import subprocess

import pytest
from alpineagents import ToolError, tool
from alpineagents.testing import FakeModel, tool_call

from alpine_core import Decision, Mode, Offered, Session, Settings, ToolCallItem, file_storage
from alpine_core import session as session_module
from alpine_core.events import ToolFinished
from alpine_core.review import Review
from alpine_core.tools import Workspace as ToolWorkspace
from alpine_core.work_changes import WorkChanges


class Allow:
    def approve(self, request):
        return Decision("allow")

    async def review(self, request):
        return Review(True, "safe test")


def make(root, monkeypatch, replies, mode=Mode.YOLO, storage=None, **kwargs):
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    monkeypatch.setattr(Session, "_reviewer", lambda self: Allow())
    return Session(Settings(model="fake", mode=mode), cwd=root, approver=Allow(), storage=storage, **kwargs)


def calls(session):
    return [item for item in session.snapshot().items if isinstance(item, ToolCallItem)]


@pytest.mark.parametrize("mode", list(Mode))
def test_all_modes_collect_actual_final_diff_without_approval_previews(tmp_path, monkeypatch, mode):
    (tmp_path / "file.txt").write_text("user's existing edit\n")
    session = make(
        tmp_path,
        monkeypatch,
        [
            tool_call("edit", path="file.txt", old_string="existing", new_string="intermediate"),
            tool_call("edit", path="file.txt", old_string="intermediate", new_string="final"),
            "Done",
        ],
        mode,
    )
    session.send("change it")
    [first, second] = calls(session)
    assert first.status == second.status == "done"
    [change] = second.file_changes
    assert change == {
        "path": "file.txt",
        "added": 1,
        "removed": 1,
        "diff": ["@@ -1 +1 @@", "-user's existing edit", "+user's final edit"],
    }


def test_parallel_engine_edits_keep_both_changes_and_final_diff(tmp_path, monkeypatch):
    target = tmp_path / "file.txt"
    target.write_text("alpha=0\nbeta=0\n")
    session = make(
        tmp_path,
        monkeypatch,
        [
            [
                tool_call("edit", path="file.txt", old_string="alpha=0", new_string="alpha=1"),
                tool_call("edit", path="file.txt", old_string="beta=0", new_string="beta=1"),
            ],
            "Done",
        ],
    )
    session.send("edit both")
    assert target.read_text() == "alpha=1\nbeta=1\n"
    assert all(call.status == "done" for call in calls(session))
    [change] = calls(session)[-1].file_changes
    assert change["added"] == change["removed"] == 2


def test_failed_shell_records_failure_for_model_events_items_and_actual_changes(tmp_path, monkeypatch):
    events = []
    session = make(
        tmp_path,
        monkeypatch,
        [tool_call("bash", command="echo changed > out.txt; echo build_failed; exit 3"), "Done"],
        on_event=events.append,
    )
    session.send("run")
    [item] = calls(session)
    assert item.status == "error" and item.command_result["exit_code"] == 3
    assert item.command_result["stdout"] == "build_failed"
    assert item.file_changes[0]["path"] == "out.txt" and item.file_changes[0]["added"] == 1
    [event] = [e for e in events if isinstance(e, ToolFinished)]
    assert event.is_error and event.kind == "error" and "[exit code 3]" in event.result
    [history_result] = [entry for entry in session._state.history if entry.kind == "tool_result"]
    assert history_result.is_error and history_result.outcome == "error"


def test_user_tool_changes_and_partial_failure_are_observed(tmp_path, monkeypatch):
    @tool(read_only=False)
    def custom() -> str:
        """Writes then reports failure."""
        (tmp_path / "created.txt").write_text("actual\n")
        raise ToolError("partial failure")

    class Source:
        def offered(self):
            return [Offered(custom, "user")]

    session = make(tmp_path, monkeypatch, [tool_call("custom"), "Done"], tools=lambda root: [Source()])
    session.send("go")
    [item] = calls(session)
    assert item.status == "error"
    assert item.file_changes == [
        {"path": "created.txt", "added": 1, "removed": 0, "diff": ["@@ -0,0 +1 @@", "+actual"]}
    ]


def test_baseline_survives_resume_and_full_revert_clears_changes(tmp_path, monkeypatch):
    (tmp_path / "file.txt").write_text("original\n")
    storage = file_storage()
    session = make(
        tmp_path, monkeypatch, [tool_call("write", path="file.txt", content="intermediate\n"), "Done"], storage=storage
    )
    session.send("first")
    monkeypatch.setattr(
        session_module,
        "make_model",
        lambda settings: FakeModel(
            [
                tool_call("write", path="file.txt", content="original\n"),
                "Done",
            ]
        ),
    )
    resumed = Session.resume(storage, session.id, Settings(model="fake"), approver=Allow())
    resumed.send("undo")
    assert calls(resumed)[-1].file_changes == []
    assert calls(resumed)[0].file_changes[0]["diff"] == ["@@ -1 +1 @@", "-original", "+intermediate"]


def test_final_newline_only_changes_are_not_hidden(tmp_path):
    target = tmp_path / "file.txt"
    target.write_text("same")
    tracker = WorkChanges(ToolWorkspace(tmp_path))
    tracker.start("write", {"path": "file.txt"})
    target.write_text("same\n")
    [change] = tracker.finish()
    assert change["added"] == change["removed"] == 1
    assert change["diff"] == ["@@ -1 +1 @@", "-same", "\\ No newline at end of file", "+same"]


def test_git_dirty_baseline_deletion_rename_binary_and_ignored_paths(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    (tmp_path / ".gitignore").write_text("ignored/\n")
    (tmp_path / "tracked").write_text("committed\n")
    subprocess.run(["git", "add", "tracked", ".gitignore"], cwd=tmp_path, check=True)
    (tmp_path / "tracked").write_text("already dirty\n")
    (tmp_path / ".env").write_text("SECRET=before")
    tracker = WorkChanges(ToolWorkspace(tmp_path))
    tracker.start("bash", {})
    (tmp_path / "tracked").rename(tmp_path / "renamed")
    (tmp_path / "binary").write_bytes(b"\0\xff")
    (tmp_path / "ignored").mkdir()
    (tmp_path / "ignored/output").write_text("ignored")
    (tmp_path / ".env").write_text("SECRET=after")
    changes = {c["path"]: c for c in tracker.finish()}
    assert set(changes) == {"tracked", "renamed", "binary"}
    assert changes["tracked"]["diff"][-1] == "-already dirty"
    assert changes["binary"]["diff"] is None
    tracker.start("write", {"path": "ignored/output"})
    (tmp_path / "ignored/output").write_text("explicit change")
    assert "ignored/output" in {c["path"] for c in tracker.finish()}


@pytest.mark.parametrize("content", ["existing notes\n", "updated notes\n", None])
def test_newly_ignored_file_uses_disk_state_instead_of_assuming_deletion(tmp_path, content):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    notes = tmp_path / "notes.txt"
    notes.write_text("existing notes\n")
    tracker = WorkChanges(ToolWorkspace(tmp_path))
    tracker.start("bash", {})
    (tmp_path / ".gitignore").write_text("notes.txt\n")
    # Merely ignoring a file must not report it as deleted, even on subsequent scans.
    for _ in range(2):
        assert {c["path"] for c in tracker.finish()} == {".gitignore"}
    tracker.start("bash", {})
    if content is None:
        notes.unlink()
    else:
        notes.write_text(content)
    changes = {c["path"]: c for c in tracker.finish()}
    if content == "existing notes\n":
        assert set(changes) == {".gitignore"}
    else:
        assert changes["notes.txt"] == {
            "path": "notes.txt",
            "added": 0 if content is None else 1,
            "removed": 1,
            "diff": (
                ["@@ -1 +0,0 @@", "-existing notes"]
                if content is None
                else ["@@ -1 +1 @@", "-existing notes", "+updated notes"]
            ),
        }
