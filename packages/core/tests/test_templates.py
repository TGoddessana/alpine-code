"""Making a project from a template: the copy, the folder name, and the first commit."""

import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from alpine_core import TemplateNotFound, available_templates, create_project, safe_name, templates_dir
from alpine_core import templates as templates_module


def git(folder, *args, **kwargs):
    return subprocess.run(
        ["git", "-C", str(folder), *args], capture_output=True, text=True, check=True, **kwargs
    ).stdout


@pytest.fixture
def templates(tmp_path, monkeypatch):
    """A templates folder with ``web-lite`` (files that must come along, and every kind that must not) and ``blank``."""
    root = tmp_path / "alpine-templates"
    lite = root / "web-lite"
    for path, text in {
        "package.json": '{"name": "app"}\n',
        "package-lock.json": "{}\n",
        "AGENTS.md": "# Agent\n",
        ".gitignore": "node_modules\ndist\n.wrangler\n.dev.vars\n",
        ".alpine-code/cloud.toml": 'version = 1\nkind = "web-lite"\n',
        "drizzle/0000_init.sql": "CREATE TABLE item (id integer);\n",
        "src/main.ts": "export {};\n",
        # None of these belong in a project.
        ".git/HEAD": "ref: refs/heads/trunk\n",
        "node_modules/left-pad/index.js": "x\n",
        "src/node_modules/inner/index.js": "x\n",
        ".wrangler/state/db.sqlite": "x\n",
        "dist/index.html": "x\n",
        ".dev.vars": "SECRET=1\n",
        ".dev.vars.production": "SECRET=2\n",
        ".dev.jar": "cookie\n",
        "tsconfig.app.tsbuildinfo": "{}\n",
        ".DS_Store": "x\n",
        "src/.DS_Store": "x\n",
    }.items():
        (lite / path).parent.mkdir(parents=True, exist_ok=True)
        (lite / path).write_text(text)
    (lite / "run.sh").write_text("#!/bin/sh\n")
    (lite / "run.sh").chmod(0o755)
    (root / "blank" / ".alpine-code").mkdir(parents=True)
    (root / "blank" / ".alpine-code" / "cloud.toml").write_text('version = 1\nkind = "blank"\n')
    monkeypatch.setenv("ALPINE_TEMPLATES", str(root))
    return root


@pytest.fixture
def parent(tmp_path):
    return tmp_path / "AlpineCode"


def files(folder):
    return sorted(
        str(path.relative_to(folder))
        for path in folder.rglob("*")
        if path.is_file() and ".git" not in path.relative_to(folder).parts
    )


def test_the_templates_folder_comes_from_the_environment(templates):
    assert templates_dir() == templates
    assert available_templates() == ["blank", "web-lite"]


def test_the_template_is_copied_without_what_a_project_does_not_keep(templates, parent):
    folder = create_project("web-lite", parent, "craft-booking")

    assert folder == parent.resolve() / "craft-booking"
    assert files(folder) == [
        ".alpine-code/cloud.toml",
        ".gitignore",
        "AGENTS.md",
        "drizzle/0000_init.sql",
        "package-lock.json",
        "package.json",
        "run.sh",
        "src/main.ts",
    ]
    assert not (folder / "src" / "node_modules").exists() and not (folder / "src" / ".DS_Store").exists()
    assert os.access(folder / "run.sh", os.X_OK)
    assert (folder / "package.json").read_text() == '{"name": "app"}\n'


def test_the_template_itself_is_left_as_it_was(templates, parent):
    create_project("web-lite", parent, "app")

    assert (templates / "web-lite" / "node_modules" / "left-pad" / "index.js").exists()
    assert (templates / "web-lite" / ".git" / "HEAD").read_text() == "ref: refs/heads/trunk\n"
    assert not (templates / "web-lite" / ".git" / "index").exists()


def test_a_name_in_use_moves_the_project_to_the_next_free_one(templates, parent):
    (parent / "app").mkdir(parents=True)
    (parent / "app-2").write_text("a file with that name")

    assert create_project("blank", parent, "app") == parent.resolve() / "app-3"
    assert create_project("blank", parent, "app") == parent.resolve() / "app-4"
    assert create_project("blank", parent, "other") == parent.resolve() / "other"


def test_folders_other_creations_are_writing_to_are_not_taken(templates, parent):
    taken = [parent / "app", parent.resolve() / "app-2"]

    folder = create_project("blank", parent, "app", taken=taken)

    assert folder == parent.resolve() / "app-3"
    assert not (parent / "app").exists()  # nothing was made for the ones taken


def test_a_folder_is_given_to_one_creation_even_when_many_run_at_once(templates, parent):
    count = 8
    start = threading.Barrier(count)

    def make(_):
        start.wait()
        return create_project("web-lite", parent, "app")

    with ThreadPoolExecutor(count) as pool:
        folders = list(pool.map(make, range(count)))

    assert sorted(f.name for f in folders) == sorted(["app", *(f"app-{n}" for n in range(2, count + 1))])
    for folder in folders:
        assert git(folder, "rev-list", "--count", "HEAD").strip() == "1"
        assert git(folder, "status", "--porcelain") == ""


def test_the_name_cannot_leave_the_parent_folder(templates, parent):
    assert create_project("blank", parent, "../../outside").parent == parent.resolve()
    assert create_project("blank", parent, "/etc/passwd").parent == parent.resolve()
    assert create_project("blank", parent, "").name == safe_name("")
    assert sorted(p.name for p in parent.iterdir()) == ["etc-passwd", "new-app", "outside"]


def test_the_first_commit_is_the_template_by_alpine_on_main(templates, parent):
    folder = create_project("web-lite", parent, "app")

    assert git(folder, "branch", "--show-current").strip() == "main"
    assert git(folder, "rev-list", "--count", "HEAD").strip() == "1"  # the template's own .git was not carried over
    assert git(folder, "log", "-1", "--format=%an <%ae>|%cn <%ce>|%s").strip() == (
        "Alpine Code <noreply@alpinecode.app>|Alpine Code <noreply@alpinecode.app>|Start from the web-lite template"
    )
    assert git(folder, "status", "--porcelain") == ""  # everything that stays is in the commit
    tracked = git(folder, "ls-files").split()
    assert ".alpine-code/cloud.toml" in tracked and "package-lock.json" in tracked
    assert not [name for name in tracked if "node_modules" in name or name.endswith(".dev.vars")]
    assert git(folder, "config", "--local", "--list").count("user.") == 0  # the repository does not remember Alpine


def test_the_users_git_is_not_touched_and_does_not_get_in_the_way(templates, parent, tmp_path, monkeypatch):
    hooks = tmp_path / "hooks"
    hooks.mkdir()
    (hooks / "pre-commit").write_text("#!/bin/sh\nexit 1\n")
    (hooks / "pre-commit").chmod(0o755)
    config = tmp_path / "gitconfig"
    # A user who signs every commit with a program that fails, runs hooks, and has their own name.
    config.write_text(
        f"[user]\n\tname = Real Person\n\temail = real@example.com\n[commit]\n\tgpgsign = true\n"
        f"[gpg]\n\tprogram = /usr/bin/false\n[core]\n\thooksPath = {hooks}\n[init]\n\tdefaultBranch = trunk\n"
    )
    before = config.read_text()
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    monkeypatch.setenv("GIT_CONFIG_SYSTEM", os.devnull)
    monkeypatch.setenv("GIT_AUTHOR_NAME", "From The Environment")
    monkeypatch.setenv("GIT_COMMITTER_EMAIL", "env@example.com")

    folder = create_project("blank", parent, "app")

    assert config.read_text() == before
    assert git(folder, "branch", "--show-current").strip() == "main"
    assert git(folder, "log", "-1", "--format=%an <%ae>|%cn <%ce>").strip() == (
        "Alpine Code <noreply@alpinecode.app>|Alpine Code <noreply@alpinecode.app>"
    )
    assert git(folder, "config", "user.name").strip() == "Real Person"  # still the user's for their own commits
    assert git(folder, "config", "--local", "--list").count("user.") == 0


def test_without_git_the_folder_is_still_made(templates, parent, monkeypatch):
    monkeypatch.setattr(templates_module, "git_tools_ready", lambda: False)

    folder = create_project("web-lite", parent, "app")

    assert (folder / "package.json").exists() and not (folder / ".git").exists()


def test_an_unknown_template_is_not_found_and_nothing_is_made(templates, parent):
    for name in ("web-pro", "mobile", "nope", "", ".", "..", "../alpine-templates/blank", "blank/.alpine-code"):
        with pytest.raises(TemplateNotFound):
            create_project(name, parent, "app")

    assert not parent.exists()


def test_a_template_that_cannot_be_committed_leaves_nothing_behind(templates, parent, tmp_path, monkeypatch):
    broken = tmp_path / "home"
    broken.mkdir()
    (broken / ".gitconfig").write_text("[user\n\tthis is not a config file\n")
    monkeypatch.setenv("HOME", str(broken))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(broken / ".config"))
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(broken / ".gitconfig"))

    with pytest.raises(OSError, match="git .* failed"):
        create_project("web-lite", parent, "app")

    assert list(parent.iterdir()) == []

    monkeypatch.delenv("GIT_CONFIG_GLOBAL")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert create_project("web-lite", parent, "app") == parent.resolve() / "app"  # the name is free again


def test_a_template_that_cannot_be_copied_leaves_nothing_behind(templates, parent, monkeypatch):
    def fail(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(templates_module.shutil, "copytree", fail)

    with pytest.raises(OSError, match="disk full"):
        create_project("web-lite", parent, "app")

    assert list(parent.iterdir()) == []
