"""Where the templates come from: the environment, the local folder, a fetched copy; nothing fetched without a repo."""

import subprocess

from alpine_core import templates


def test_the_environment_wins_then_the_local_folder_then_a_fetched_copy(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    fetched = tmp_path / "alpine-home" / "templates" / "abc123"
    fetched.mkdir(parents=True)
    assert templates.templates_dir() == fetched  # nothing local: the fetched copy

    local = tmp_path / "home" / "Developments" / "alpine-templates"
    local.mkdir(parents=True)
    assert templates.templates_dir() == local  # the local folder while it exists

    monkeypatch.setenv("ALPINE_TEMPLATES", str(tmp_path / "mine"))
    assert templates.templates_dir() == tmp_path / "mine"


def test_with_nothing_anywhere_the_local_path_is_returned_and_has_no_templates(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    assert templates.templates_dir() == tmp_path / "home" / "Developments" / "alpine-templates"
    assert templates.available_templates() == []


def test_nothing_is_fetched_while_the_repository_is_unset():
    assert templates.TEMPLATES_REPO is None
    assert templates.fetch_templates() is None


def test_a_fetched_copy_is_kept_by_commit_without_history(tmp_path, monkeypatch):
    repo = tmp_path / "public"
    (repo / "web-lite").mkdir(parents=True)
    (repo / "web-lite" / "package.json").write_text("{}\n")
    for args in (
        ("init", "-q"),
        ("add", "-A"),
        ("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x"),
    ):
        subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True)
    commit = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True
    ).stdout.strip()

    folder = templates.fetch_templates(f"file://{repo}")
    assert folder.name == commit and (folder / "web-lite" / "package.json").is_file() and not (folder / ".git").exists()
    assert templates.fetch_templates(f"file://{repo}") == folder  # the latest is already there
    assert [p.name for p in folder.parent.iterdir()] == [commit]
    monkeypatch.setenv("HOME", str(tmp_path / "nohome"))
    assert templates.templates_dir() == folder
