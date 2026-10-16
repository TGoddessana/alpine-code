import asyncio
import subprocess

import pytest

from alpine_protocol import ProjectsCancelCloneParams, ProjectsCloneParams, ProjectsListParams
from alpine_server.clones import Clones
from alpine_server.methods import MethodError


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "config.toml").write_text(f'clone_folder = "{tmp_path / "repos"}"\n')
    return tmp_path


@pytest.fixture
def origin(tmp_path):
    repo = tmp_path / "origin" / "demo"
    repo.mkdir(parents=True)
    for args in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "init"]):
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=repo, check=True)
    return repo


class Harness:
    def __init__(self):
        self.changes = []
        self.clones = Clones(self.changes.append)

    async def clone(self, address, clone_id="c1"):
        return await self.clones.clone(ProjectsCloneParams(id=clone_id, address=address))

    async def until(self, state):
        for _ in range(200):
            if any(change.clone.state == state for change in self.changes):
                return next(change for change in self.changes if change.clone.state == state)
            await asyncio.sleep(0.05)
        raise AssertionError(f"no {state} among {[c.clone.state for c in self.changes]}")


def test_a_clone_ends_as_a_project_and_a_second_one_opens_it(tmp_path, origin):
    async def run():
        harness = Harness()
        result = await harness.clone(f"file://{origin}")
        if result.clone is not None:  # the host answered before git finished: the rest was announced
            assert result.clone.state == "receiving" and result.clone.name == "demo"
            project = (await harness.until("done")).project
        else:
            project = result.project
        assert project.path == str((tmp_path / "repos" / "demo").resolve())
        listed = await harness.clones.list(ProjectsListParams())
        assert [p.path for p in listed.projects] == [project.path] and listed.clones == []

        again = await harness.clone(str(origin), "c2")
        assert again.existing and again.project.path == project.path

    asyncio.run(run())


def test_a_wrong_address_fails_the_request_and_leaves_nothing_listed(tmp_path):
    async def run():
        harness = Harness()
        with pytest.raises(MethodError) as failed:
            await harness.clone(str(tmp_path / "nope"))
        assert failed.value.data.reason == "no_access"
        assert (await harness.clones.list(ProjectsListParams())).clones == []

    asyncio.run(run())


def test_a_clone_in_the_background_can_be_cancelled(tmp_path, monkeypatch):
    ssh = tmp_path / "slow-ssh"
    ssh.write_text("#!/bin/sh\necho 'remote: Counting objects: 50% (1/2)' >&2\nsleep 30\n")
    ssh.chmod(0o755)
    monkeypatch.setenv("GIT_SSH_COMMAND", str(ssh))
    monkeypatch.setenv("GIT_SSH_VARIANT", "ssh")  # else git first runs it once to ask what kind of ssh it is

    async def run():
        harness = Harness()
        result = await harness.clone("ssh://example.invalid/owner/repo")
        assert result.clone.state == "receiving"
        assert [c.id for c in (await harness.clones.list(ProjectsListParams())).clones] == ["c1"]
        await harness.clones.cancel(ProjectsCancelCloneParams(id="c1"))
        await harness.until("cancelled")
        assert (await harness.clones.list(ProjectsListParams())).clones == []
        assert not (tmp_path / "repos" / "repo").exists()

    asyncio.run(run())
