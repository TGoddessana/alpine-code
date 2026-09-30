import subprocess

import pytest

from alpine_core import CloneError, clone, current_branch
from alpine_core.git import clone_url, repo_name


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


def test_what_the_user_types_becomes_a_url():
    assert clone_url("owner/repo") == "https://github.com/owner/repo.git"
    assert clone_url("github.com/owner/repo") == "https://github.com/owner/repo"
    assert clone_url("git@github.com:owner/repo.git") == "git@github.com:owner/repo.git"
    assert repo_name("git@github.com:owner/repo.git") == "repo"
    assert repo_name("https://github.com/owner/repo/") == "repo"


def test_clone_and_branch(tmp_path, origin):
    parent = tmp_path / "work"
    parent.mkdir()
    dest = clone(str(origin), parent)
    assert dest == (parent / "demo").resolve() and (dest / "a.txt").read_text() == "hi"
    assert current_branch(dest) == "trunk"
    assert current_branch(tmp_path) is None

    with pytest.raises(FileExistsError):
        clone(str(origin), parent)
    with pytest.raises(CloneError):
        clone(str(tmp_path / "missing"), parent)
