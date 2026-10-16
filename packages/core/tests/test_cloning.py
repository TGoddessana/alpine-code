import asyncio
import os
import subprocess

import pytest

from alpine_core import Clone, CloneCancelled, CloneFailed, Credentials, git_tools_ready, place
from alpine_core.cloning import _write_askpass, failure_kind, repository_key


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def origin(tmp_path):
    repo = tmp_path / "origin" / "demo"
    repo.mkdir(parents=True)
    git("init", "-q", "-b", "trunk", cwd=repo)
    (repo / "a.txt").write_text("hi")
    git("add", ".", cwd=repo)
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init", cwd=repo)
    return repo


def test_every_way_of_writing_an_address_is_one_repository():
    same = [
        "owner/repo",
        "github.com/owner/repo",
        "https://github.com/Owner/repo.git",
        "https://user@github.com/owner/repo/",
        "git@github.com:owner/repo.git",
        "ssh://git@github.com:22/owner/repo",
    ]
    assert {repository_key(address) for address in same} == {"github.com/owner/repo"}
    assert repository_key("owner/other") != repository_key("owner/repo")
    assert repository_key("https://gitlab.example.com/team/app") == "gitlab.example.com/team/app"


def test_a_repository_already_here_is_opened_not_cloned_again(tmp_path, origin):
    parent = tmp_path / "AlpineCode"
    assert place(str(origin), parent, []) == ((parent / "demo").resolve(), False)

    # A project elsewhere with the same origin wins.
    git("clone", "-q", str(origin), str(tmp_path / "elsewhere"), cwd=tmp_path)
    assert place(str(origin), parent, [tmp_path / "elsewhere"]) == (tmp_path / "elsewhere", True)

    # Already in the folder, though not a project.
    git("clone", "-q", str(origin), str(parent / "demo"), cwd=tmp_path)
    assert place(str(origin), parent, []) == ((parent / "demo").resolve(), True)


def test_another_folder_with_the_name_moves_the_clone_aside(tmp_path, origin):
    parent = tmp_path / "AlpineCode"
    (parent / "demo").mkdir(parents=True)
    assert place(str(origin), parent, []) == ((parent / "demo-2").resolve(), False)
    assert place(str(origin), parent, [], taken=[(parent / "demo-2").resolve()]) == (
        (parent / "demo-3").resolve(),
        False,
    )


def test_clone_reports_progress_and_returns_the_folder(tmp_path, origin):
    seen = []

    async def run():
        clone = await Clone.start(f"file://{origin}", tmp_path / "work" / "demo", on_progress=seen.append)
        await clone.contacted()
        return await clone.wait()

    dest = asyncio.run(run())
    assert (dest / "a.txt").read_text() == "hi"
    assert seen and seen[-1].percent == 100
    assert [p.percent for p in seen] == sorted(p.percent for p in seen)


def test_a_failed_clone_says_why_and_leaves_nothing(tmp_path):
    dest = tmp_path / "work" / "missing"

    async def run():
        clone = await Clone.start(str(tmp_path / "missing"), dest)
        await clone.contacted()
        assert not clone.running
        await clone.wait()

    with pytest.raises(CloneFailed) as failed:
        asyncio.run(run())
    assert failed.value.kind == "no_access"
    assert not dest.exists()


def test_a_cancelled_clone_leaves_nothing(tmp_path, monkeypatch):
    slow = tmp_path / "slow-ssh"
    slow.write_text("#!/bin/sh\nsleep 30\n")
    slow.chmod(0o755)
    monkeypatch.setenv("GIT_SSH_COMMAND", str(slow))
    monkeypatch.setenv("GIT_SSH_VARIANT", "ssh")
    dest = tmp_path / "work" / "repo"

    async def run():
        clone = await Clone.start("ssh://example.invalid/owner/repo", dest)
        await asyncio.sleep(0.3)
        clone.cancel()
        await clone.wait()

    with pytest.raises(CloneCancelled):
        asyncio.run(run())
    assert not dest.exists()


def test_credentials_reach_git_only_through_askpass():
    script = _write_askpass()
    try:
        env = {**os.environ, "ALPINE_GIT_USERNAME": "me", "ALPINE_GIT_PASSWORD": "t0ken"}
        ask = lambda prompt: subprocess.run([script, prompt], env=env, capture_output=True, text=True).stdout  # noqa: E731
        assert ask("Username for 'https://gitlab.example.com': ") == "me\n"
        assert ask("Password for 'https://me@gitlab.example.com': ") == "t0ken\n"
    finally:
        script.unlink()
    assert Credentials("me", "t0ken") != Credentials("me", "other")


def test_what_git_says_becomes_what_the_user_can_do():
    assert failure_kind("fatal: could not read Username for 'https://github.com': terminal prompts disabled") == (
        "no_access"
    )
    assert failure_kind("remote: Repository not found.") == "no_access"
    assert failure_kind("git@github.com: Permission denied (publickey).") == "no_access"
    assert failure_kind("fatal: unable to access 'https://x/': Could not resolve host: x") == "unreachable"
    assert failure_kind("fatal: the remote end hung up unexpectedly") == "failed"


def test_git_runs_here():
    assert git_tools_ready()
