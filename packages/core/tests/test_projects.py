import pytest

from alpine_core import ProjectList


def test_open_adds_then_marks_used(tmp_path):
    projects = ProjectList(tmp_path / "projects.json")
    a, b = tmp_path / "a", tmp_path / "b"
    a.mkdir()
    b.mkdir()
    first = projects.open(a)
    projects.open(b)
    assert [p.path for p in projects.list()] == [b.resolve(), a.resolve()]

    again = projects.open(a)
    assert again.added_at == first.added_at and again.last_used_at > first.last_used_at
    assert [p.name for p in ProjectList(tmp_path / "projects.json").list()] == ["a", "b"]


def test_open_refuses_a_missing_folder(tmp_path):
    with pytest.raises(NotADirectoryError):
        ProjectList(tmp_path / "projects.json").open(tmp_path / "missing")


def test_archive_until_opened_again(tmp_path):
    projects = ProjectList(tmp_path / "projects.json")
    folder = tmp_path / "a"
    folder.mkdir()
    projects.open(folder)
    assert projects.clone_parent() == tmp_path.resolve()
    projects.archive(folder)
    assert [p.archived for p in projects.list()] == [True]
    projects.open(folder)
    assert [p.archived for p in projects.list()] == [False]


def test_delete_forgets_the_project_but_keeps_the_folder(tmp_path):
    projects = ProjectList(tmp_path / "projects.json")
    folder = tmp_path / "a"
    folder.mkdir()
    (folder / "main.py").write_text("print()")
    projects.open(folder)
    projects.delete(folder)
    assert projects.list() == []
    assert (folder / "main.py").exists()
    projects.delete(folder)  # already gone: nothing to do


def test_delete_removes_the_users_own_memory_of_the_project_only(tmp_path):
    from alpine_core.memory import MarkdownStore, Memory

    home = tmp_path / "home"
    folder = tmp_path / "a"
    folder.mkdir()
    projects = ProjectList(home / "projects.json")
    projects.open(folder)
    store = MarkdownStore(folder, home)
    mine = store.put(Memory("tests", "rule", "project_me", "결제 테스트는 테스트 키로", ""))
    team = store.put(Memory("tone", "rule", "team", "해요체", ""))
    everywhere = store.put(Memory("plain", "user", "me", "쉬운 말로", ""))

    projects.delete(folder)
    assert not mine.path.exists()
    assert team.path.exists() and everywhere.path.exists()


def test_last_agent_round_trips_and_open_keeps_it(tmp_path):
    projects = ProjectList(tmp_path / "projects.json")
    folder = tmp_path / "a"
    folder.mkdir()
    assert projects.open(folder).last_agent is None
    projects.set_agent(folder, "reviewer")
    assert projects.get(folder).last_agent == "reviewer"
    assert projects.open(folder).last_agent == "reviewer"
    assert ProjectList(tmp_path / "projects.json").get(folder).last_agent == "reviewer"
    projects.set_agent(folder, None)
    assert projects.get(folder).last_agent is None


def test_set_agent_ignores_unknown_folders(tmp_path):
    projects = ProjectList(tmp_path / "projects.json")
    projects.set_agent(tmp_path / "nowhere", "reviewer")
    assert projects.list() == [] and projects.get(tmp_path / "nowhere") is None
    assert not (tmp_path / "projects.json").exists()
