from pathlib import Path
from unittest.mock import patch

import pytest

from alpine_protocol.files import FilesActionParams, FilesListParams, FilesReadParams, FilesSearchParams
from alpine_server.files import file_action, list_files, read_file, search_files
from alpine_server.methods import MethodError


def test_read_line_and_window(tmp_path: Path):
    source = tmp_path / "source.ts"
    source.write_text("\n".join(str(i) for i in range(1, 1001)))
    result = read_file(FilesReadParams(cwd=str(tmp_path), path="source.ts", line=650, limit=100))
    assert result.line == 650
    assert result.start_line == 600
    assert result.content.splitlines()[50] == "650"
    assert result.total_lines == 1000
    assert result.truncated
    result = read_file(FilesReadParams(cwd=str(tmp_path), path="source.ts", line=9999))
    assert result.line == 1000
    assert result.content.splitlines()[-1] == "1000"


def test_empty_and_missing(tmp_path: Path):
    (tmp_path / "empty").write_text("")
    result = read_file(FilesReadParams(cwd=str(tmp_path), path="empty", line=4))
    assert (result.content, result.total_lines, result.line) == ("", 0, 1)
    with pytest.raises(MethodError, match="does not exist"):
        read_file(FilesReadParams(cwd=str(tmp_path), path="missing"))


def test_traversal_absolute_and_symlink_escape(tmp_path: Path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path / "private.txt"
    outside.write_text("secret")
    (workspace / "link.txt").symlink_to(outside)
    for path in ["../private.txt", str(outside), "link.txt"]:
        with pytest.raises(MethodError, match="outside"):
            read_file(FilesReadParams(cwd=str(workspace), path=path))
        with pytest.raises(MethodError, match="outside"):
            file_action(FilesActionParams(cwd=str(workspace), path=path, action="editor"))


def test_binary_and_large_file(tmp_path: Path):
    for name, content, error in [("image", b"a\0b", "Binary"), ("large", b"a" * (2 * 1024 * 1024 + 1), "limit")]:
        (tmp_path / name).write_bytes(content)
        with pytest.raises(MethodError, match=error):
            read_file(FilesReadParams(cwd=str(tmp_path), path=name))


def test_search_skips_dependencies_and_symlinks_and_limits(tmp_path: Path):
    for name in ["a.ts", "b.ts", "c.ts"]:
        (tmp_path / name).touch()
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "d.ts").touch()
    (tmp_path / "alias.ts").symlink_to(tmp_path / "a.ts")
    result = search_files(FilesSearchParams(cwd=str(tmp_path), query=".ts", limit=2))
    assert result.paths == ["a.ts", "b.ts"]
    assert result.truncated
    assert search_files(FilesSearchParams(cwd=str(tmp_path), query="d.ts")).paths == []


def test_editor_uses_argv_and_precise_line(tmp_path: Path):
    (tmp_path / "a.ts").touch()
    with (
        patch("alpine_server.files.shutil.which", return_value="/bin/code"),
        patch("alpine_server.files.subprocess.run") as run,
    ):
        file_action(FilesActionParams(cwd=str(tmp_path), path="a.ts", line=42, action="editor"))
    assert run.call_args.args[0] == ["/bin/code", "--goto", f"{tmp_path / 'a.ts'}:42"]


def test_editor_failure_is_reported(tmp_path: Path):
    (tmp_path / "a.ts").touch()
    with patch("alpine_server.files.subprocess.run", side_effect=OSError("not installed")):
        with pytest.raises(MethodError, match="Could not open"):
            file_action(FilesActionParams(cwd=str(tmp_path), path="a.ts", action="editor"))


def test_tree_lists_one_level_directories_first_and_paginates(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "inside.ts").touch()
    for name in ("b.ts", "A.ts", ".gitignore"):
        (tmp_path / name).touch()
    first = list_files(FilesListParams(cwd=str(tmp_path), limit=2))
    assert [(e.name, e.kind) for e in first.entries] == [("src", "directory"), (".gitignore", "file")]
    assert first.has_more and first.next_offset == 2
    second = list_files(FilesListParams(cwd=str(tmp_path), offset=first.next_offset, limit=2))
    assert [e.path for e in second.entries] == ["A.ts", "b.ts"]
    assert not second.has_more
    child = list_files(FilesListParams(cwd=str(tmp_path), path="src"))
    assert [e.path for e in child.entries] == ["src/inside.ts"]


def test_tree_rejects_outside_directories_and_does_not_follow_symlinks(tmp_path):
    root, outside = tmp_path / "project", tmp_path / "outside"
    root.mkdir()
    outside.mkdir()
    (outside / "private").touch()
    (root / "shortcut").symlink_to(outside, target_is_directory=True)
    result = list_files(FilesListParams(cwd=str(root)))
    assert [(e.name, e.kind) for e in result.entries] == [("shortcut", "symlink")]
    for path in ("../outside", str(outside), "shortcut"):
        with pytest.raises(MethodError, match="outside"):
            list_files(FilesListParams(cwd=str(root), path=path))


def test_tree_empty_missing_and_unreadable_directories(tmp_path):
    assert not list_files(FilesListParams(cwd=str(tmp_path))).entries
    with pytest.raises(MethodError, match="does not exist"):
        list_files(FilesListParams(cwd=str(tmp_path), path="gone"))
    with patch("alpine_server.files.os.scandir", side_effect=PermissionError):
        with pytest.raises(MethodError, match="Cannot read"):
            list_files(FilesListParams(cwd=str(tmp_path)))
