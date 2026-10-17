"""Regression coverage for successful-but-lost edits and failed staging writes."""

import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import pytest
from alpineagents import ToolError

from alpine_core.tools import Workspace, _file_write
from alpine_core.tools.edit import Edit
from alpine_core.tools.write import Write


def test_parallel_edits_across_tool_instances_and_path_aliases_keep_every_change(tmp_path, monkeypatch):
    target = tmp_path / "file.txt"
    target.write_text("".join(f"key{i}=0\n" for i in range(8)))
    alias = tmp_path / "alias.txt"
    alias.symlink_to(target)
    original = Path.read_bytes

    def slow_read(path):
        data = original(path)
        if path == target:
            time.sleep(0.01)  # expose overlapping read-modify-write without the lock
        return data

    monkeypatch.setattr(Path, "read_bytes", slow_read)
    ready = Barrier(8)

    def edit(i):
        ready.wait(timeout=5)
        return Edit(Workspace(tmp_path)).edit.invoke(
            {"path": "alias.txt" if i % 2 else "file.txt", "old_string": f"key{i}=0", "new_string": f"key{i}=1"}, None
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(edit, range(8)))
    assert all(result.startswith("Edited") for result in results)
    assert target.read_text() == "".join(f"key{i}=1\n" for i in range(8))
    assert alias.is_symlink()


def test_edit_and_write_share_a_lock_across_processes(tmp_path):
    # Holding the canonical edit lock must also block a write from another process.
    import subprocess
    import sys

    target = tmp_path / "file.txt"
    target.write_text("before")
    script = (
        "from pathlib import Path; from alpine_core.tools import Workspace; "
        "from alpine_core.tools.write import Write; print('ready', flush=True); "
        f"Write(Workspace(Path({str(tmp_path)!r}))).write.invoke({{'path':'file.txt','content':'after'}}, None)"
    )
    child = None
    try:
        with _file_write.file_lock(target):
            child = subprocess.Popen([sys.executable, "-c", script], stdout=subprocess.PIPE, text=True)
            assert child.stdout.readline().strip() == "ready"
            time.sleep(0.1)
            assert child.poll() is None and target.read_text() == "before"
        assert child.wait(timeout=10) == 0
        assert target.read_text() == "after"
    finally:
        if child is not None and child.poll() is None:
            child.kill()
            child.wait()


def test_failed_atomic_replace_preserves_original_and_removes_staging_file(tmp_path, monkeypatch):
    target = tmp_path / "file.txt"
    target.write_text("before")

    def fail(*args):
        raise OSError("disk failure")

    monkeypatch.setattr(_file_write.os, "replace", fail)
    with pytest.raises(ToolError, match="disk failure"):
        Write(Workspace(tmp_path)).write.invoke({"path": "file.txt", "content": "after"}, None)
    assert target.read_text() == "before"
    assert list(tmp_path.iterdir()) == [target]


def test_external_change_during_staging_is_not_overwritten(tmp_path, monkeypatch):
    target = tmp_path / "file.txt"
    target.write_text("before")
    original = _file_write.os.fsync

    def external_write(fd):
        original(fd)
        target.write_text("human's change")

    monkeypatch.setattr(_file_write.os, "fsync", external_write)
    with pytest.raises(ToolError, match="changed while being written"):
        Edit(Workspace(tmp_path)).edit.invoke({"path": "file.txt", "old_string": "before", "new_string": "after"}, None)
    assert target.read_text() == "human's change"


def test_atomic_edit_keeps_executable_mode(tmp_path):
    target = tmp_path / "script"
    target.write_text("before")
    target.chmod(0o755)
    Edit(Workspace(tmp_path)).edit.invoke({"path": "script", "old_string": "before", "new_string": "after"}, None)
    assert target.stat().st_mode & 0o777 == 0o755
