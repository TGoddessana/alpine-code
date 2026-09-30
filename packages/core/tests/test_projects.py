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


def test_hide_until_opened_again(tmp_path):
    projects = ProjectList(tmp_path / "projects.json")
    folder = tmp_path / "a"
    folder.mkdir()
    projects.open(folder)
    assert projects.clone_parent() == tmp_path.resolve()
    projects.hide(folder)
    assert [p.hidden for p in projects.list()] == [True]
    projects.open(folder)
    assert [p.hidden for p in projects.list()] == [False]
