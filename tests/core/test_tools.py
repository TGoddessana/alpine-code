import asyncio
from pathlib import Path

import pytest

from alpine_code.core.tools import Workspace
from alpine_code.core.tools.bash import Bash
from alpine_code.core.tools.edit import Edit
from alpine_code.core.tools.glob_files import Glob
from alpine_code.core.tools.grep import Grep
from alpine_code.core.tools.read import Read
from alpine_code.core.tools.write import Write


@pytest.fixture
def ws(tmp_path: Path) -> Workspace:
    return Workspace(tmp_path)


def run(tool, **args):
    value = tool.invoke(args, None)
    return asyncio.run(value) if asyncio.iscoroutine(value) else value


def test_read_numbers_lines_and_pages(ws):
    (ws.root / "a.txt").write_text("one\ntwo\nthree\n")
    tool = Read(ws).read
    assert run(tool, path="a.txt") == "1\tone\n2\ttwo\n3\tthree"
    out = run(tool, path="a.txt", offset=2, limit=1)
    assert out.startswith("2\ttwo") and "offset=3" in out


def test_read_errors_are_results(ws):
    tool = Read(ws).read
    assert run(tool, path="missing.txt").startswith("Error:")
    assert run(tool, path=".") == "(empty directory)"
    (ws.root / "bin").write_bytes(b"\0\1\2")
    assert "binary" in run(tool, path="bin")


def test_write_creates_parents(ws):
    out = run(Write(ws).write, path="deep/dir/f.py", content="x = 1\n")
    assert out == "Created deep/dir/f.py (1 lines)"
    assert (ws.root / "deep/dir/f.py").read_text() == "x = 1\n"


def test_edit_unique_and_replace_all(ws):
    f = ws.root / "f.py"
    f.write_text("a = 1\na = 1\nb = 2\n")
    tool = Edit(ws).edit
    assert "appears 2 times" in run(tool, path="f.py", old_string="a = 1", new_string="a = 3")
    assert "not found" in run(tool, path="f.py", old_string="zzz", new_string="y")
    assert run(tool, path="f.py", old_string="b = 2", new_string="b = 5").startswith("Edited")
    assert run(tool, path="f.py", old_string="a = 1", new_string="a = 0", replace_all=True).endswith(
        "(2 occurrences replaced)"
    )
    assert f.read_text() == "a = 0\na = 0\nb = 5\n"


def test_bash_output_exit_code_and_timeout(ws):
    tool = Bash(ws).bash
    assert run(tool, command="echo hi && pwd") == f"hi\n{ws.root}"
    assert run(tool, command="echo oops >&2; exit 3") == "oops\n[exit code 3]"
    assert "timed out" in run(tool, command="sleep 5", timeout=1)


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
    assert run(tool, pattern="(").startswith("Error: invalid regular expression")
