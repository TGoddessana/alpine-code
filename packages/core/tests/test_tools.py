import asyncio
import json
import struct
import zlib
from pathlib import Path

import pytest
from alpineagents import Image, ToolError

from alpine_core.tools import Workspace
from alpine_core.tools.bash import Bash
from alpine_core.tools.edit import Edit
from alpine_core.tools.glob_files import Glob
from alpine_core.tools.grep import Grep
from alpine_core.tools.read import Read
from alpine_core.tools.write import Write


@pytest.fixture
def ws(tmp_path: Path) -> Workspace:
    return Workspace(tmp_path)


def run(tool, **args):
    value = tool.invoke(args, None)
    return asyncio.run(value) if asyncio.iscoroutine(value) else value


def png(width: int = 1, height: int = 1) -> bytes:
    """A valid grey PNG."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    rows = b"".join(b"\0" + b"\x80" * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def test_read_numbers_lines_and_pages(ws):
    (ws.root / "a.txt").write_text("one\ntwo\nthree\n")
    tool = Read(ws).read
    assert run(tool, path="a.txt") == "1\tone\n2\ttwo\n3\tthree"
    out = run(tool, path="a.txt", offset=2, limit=1)
    assert out.startswith("2\ttwo") and "offset=3" in out


def test_read_failures_raise_tool_error(ws):
    tool = Read(ws).read
    with pytest.raises(ToolError, match="missing.txt does not exist"):
        run(tool, path="missing.txt")
    assert run(tool, path=".") == "(empty directory)"
    (ws.root / "bin").write_bytes(b"\0\1\2")
    with pytest.raises(ToolError, match="binary"):
        run(tool, path="bin")
    (ws.root / "a.txt").write_text("one\n")
    with pytest.raises(ToolError, match="past the end"):
        run(tool, path="a.txt", offset=5)


def test_os_errors_become_tool_errors(ws):
    locked = ws.root / "locked.txt"
    locked.write_text("secret\n")
    locked.chmod(0)
    try:
        with pytest.raises(ToolError, match="Permission denied") as caught:
            run(Read(ws).read, path="locked.txt")
        assert isinstance(caught.value.__cause__, PermissionError)
        with pytest.raises(ToolError, match="Permission denied"):
            run(Edit(ws).edit, path="locked.txt", old_string="secret", new_string="x")
    finally:
        locked.chmod(0o644)
    with pytest.raises(ToolError, match="File exists"):
        run(Write(ws).write, path="locked.txt/child.txt", content="x")


def test_other_exceptions_still_stop_the_run(ws, monkeypatch):
    (ws.root / "a.txt").write_text("one\n")

    def broken(self):
        raise RuntimeError("a bug")

    monkeypatch.setattr(Path, "read_bytes", broken)
    with pytest.raises(RuntimeError, match="a bug"):
        run(Read(ws).read, path="a.txt")


def test_read_views_images(ws):
    (ws.root / "dot.png").write_bytes(png())
    image = run(Read(ws).read, path="dot.png", offset=3)
    assert isinstance(image, Image) and image.media_type == "image/png" and image.data == png()
    (ws.root / "photo.jpg").write_bytes(b"\xff\xd8\xff\xe0" + b"\0" * 16)
    assert run(Read(ws).read, path="photo.jpg").media_type == "image/jpeg"


def test_read_refuses_images_over_the_provider_limit(ws):
    (ws.root / "big.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 4_000_000)  # 5.3MB once base64-encoded
    with pytest.raises(ToolError, match="too large"):
        run(Read(ws).read, path="big.png")
    (ws.root / "ok.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\0" * 3_900_000)
    assert isinstance(run(Read(ws).read, path="ok.png"), Image)


def test_write_creates_parents(ws):
    out = run(Write(ws).write, path="deep/dir/f.py", content="x = 1\n")
    assert out == "Created deep/dir/f.py (1 lines)"
    assert (ws.root / "deep/dir/f.py").read_text() == "x = 1\n"


def test_edit_unique_and_replace_all(ws):
    f = ws.root / "f.py"
    f.write_text("a = 1\na = 1\nb = 2\n")
    tool = Edit(ws).edit
    with pytest.raises(ToolError, match="appears 2 times"):
        run(tool, path="f.py", old_string="a = 1", new_string="a = 3")
    with pytest.raises(ToolError, match="not found"):
        run(tool, path="f.py", old_string="zzz", new_string="y")
    assert run(tool, path="f.py", old_string="b = 2", new_string="b = 5").startswith("Edited")
    assert run(tool, path="f.py", old_string="a = 1", new_string="a = 0", replace_all=True).endswith(
        "(2 occurrences replaced)"
    )
    assert f.read_text() == "a = 0\na = 0\nb = 5\n"


def test_a_json_file_left_invalid_is_reported_at_once(ws):
    card = ws.root / "card.json"
    card.write_text('{\n "title": "Refund",\n "checks": []\n}\n')
    edit = Edit(ws).edit
    # The slip seen in map upkeep runs: the replacement repeats the file's tail, so old text trails the new end.
    broken = run(edit, path="card.json", old_string=' "checks": []\n}', new_string=' "checks": []\n}\n "checks": []\n}')
    assert broken.startswith("Edited card.json") and "not valid JSON now: Extra data (line 5, column 2)" in broken
    fixed = run(edit, path="card.json", old_string='}\n "checks": []\n}', new_string="}")
    assert fixed == "Edited card.json (1 occurrence replaced)"
    assert "not valid JSON" in run(Write(ws).write, path="flow.json", content='{"nodeIds": [}')
    assert run(Write(ws).write, path="notes.txt", content="{") == "Created notes.txt (1 lines)"


def test_bash_output_exit_code_and_timeout(ws):
    tool = Bash(ws).bash
    success = json.loads(run(tool, command="echo hi && pwd"))
    assert success["stdout"] == f"hi\n{ws.root}" and success["exit_code"] == 0
    with pytest.raises(ToolError) as failed:
        run(tool, command="echo oops >&2; exit 3")
    failure = json.loads(str(failed.value))
    assert failure["stderr"] == "oops" and failure["exit_code"] == 3
    with pytest.raises(ToolError, match="timed out") as expired:
        run(tool, command="echo partial_progress; sleep 5", timeout=1)
    timeout = json.loads(str(expired.value))
    assert timeout["timed_out"] and timeout["stdout"] == "partial_progress"


def test_bash_empty_output_and_both_streams_are_structured_and_bounded(ws):
    assert json.loads(run(Bash(ws).bash, command="true"))["stdout"] == ""
    result = json.loads(
        run(Bash(ws).bash, command="python3 -c \"import sys; print('x' * 40000); print('y' * 40000, file=sys.stderr)\"")
    )
    assert result["stdout"].endswith("x" * 100) and result["stderr"].endswith("y" * 100)
    assert "characters truncated" in result["stdout"] and "characters truncated" in result["stderr"]
    assert len(result["stdout"]) + len(result["stderr"]) < 30200


def make_tree(root: Path) -> None:
    (root / ".git").mkdir()
    (root / ".gitignore").write_text("node_modules/\n")
    (root / "src/pkg").mkdir(parents=True)
    (root / "src/pkg/app.py").write_text("def handler():\n    return 'TODO: fix'\n")
    (root / "src/pkg/util.py").write_text("x = 1\n")
    (root / "README.md").write_text("# todo list\n")
    (root / ".env").write_text("TODO_SECRET=1\n")
    (root / "node_modules/dep").mkdir(parents=True)
    (root / "node_modules/dep/index.py").write_text("TODO = 1\n")


def test_read_lists_directories(ws):
    make_tree(ws.root)
    out = run(Read(ws).read, path=".")
    assert out.splitlines() == [".git/", "node_modules/", "src/", ".env", ".gitignore", "README.md"]


def test_glob_uses_gitignore(ws):
    make_tree(ws.root)
    tool = Glob(ws).glob
    assert sorted(run(tool, pattern="*.py").splitlines()) == ["src/pkg/app.py", "src/pkg/util.py"]
    assert run(tool, pattern="src/**/app.py") == "src/pkg/app.py"
    assert run(tool, pattern="*.md") == "README.md"
    assert run(tool, pattern=".env") == "No files match .env"
    assert run(tool, pattern="*.rs") == "No files match *.rs"


def test_grep(ws):
    make_tree(ws.root)
    tool = Grep(ws).grep
    assert run(tool, pattern="TODO") == "src/pkg/app.py:2:    return 'TODO: fix'"
    assert sorted(run(tool, pattern="todo", ignore_case=True).splitlines()) == [
        "README.md:1:# todo list",
        "src/pkg/app.py:2:    return 'TODO: fix'",
    ]
    assert run(tool, pattern="def", glob="*.md") == "No matches for def"
    with pytest.raises(ToolError, match="invalid regular expression"):
        run(tool, pattern="(")
    with pytest.raises(ToolError, match="nope does not exist"):
        run(tool, pattern="x", path="nope")
