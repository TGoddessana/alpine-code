import hashlib

from alpine_core import ProjectList, migrate_projects
from alpine_core.memory import project_key
from alpine_core.migrate import migrate_project


def old_local(home, folder):
    return home / "product-map" / hashlib.sha256(str(folder.resolve()).encode()).hexdigest()


def test_moves_alpine_folders_and_the_local_map(tmp_path):
    home, folder = tmp_path / "home", tmp_path / "proj"
    (folder / ".alpine" / "memory").mkdir(parents=True)
    (folder / ".alpine" / "memory" / "tone.md").write_text("plain words")
    (folder / ".alpine" / "map" / "features").mkdir(parents=True)
    old_local(home, folder).mkdir(parents=True)
    (old_local(home, folder) / "history.json").write_text("{}")

    migrate_project(folder, home)

    assert (folder / ".alpine-code" / "memory" / "tone.md").read_text() == "plain words"
    assert (folder / ".alpine-code" / "map" / "features").is_dir()
    assert not (folder / ".alpine").exists()
    assert (home / "projects" / project_key(folder) / "product-map" / "history.json").exists()
    assert not (home / "product-map").exists()
    migrate_project(folder, home)  # again: nothing to do
    assert (folder / ".alpine-code" / "memory" / "tone.md").exists()


def test_leaves_other_tools_files_and_never_overwrites(tmp_path):
    home, folder = tmp_path / "home", tmp_path / "proj"
    (folder / ".alpine" / "memory").mkdir(parents=True)
    (folder / ".alpine" / "memory" / "old.md").write_text("old")
    (folder / ".alpine" / "skills").mkdir()
    (folder / ".alpine" / "build.yaml").write_text("not ours")
    (folder / ".alpine-code" / "memory").mkdir(parents=True)
    (folder / ".alpine-code" / "memory" / "new.md").write_text("new")
    old_local(home, folder).mkdir(parents=True)
    (home / "projects" / project_key(folder) / "product-map").mkdir(parents=True)

    migrate_project(folder, home)

    assert (folder / ".alpine" / "memory" / "old.md").exists()  # the new one already existed
    assert not (folder / ".alpine-code" / "memory" / "old.md").exists()
    assert (folder / ".alpine-code" / "skills").is_dir()
    assert (folder / ".alpine" / "build.yaml").read_text() == "not ours"
    assert old_local(home, folder).is_dir()


def test_never_moves_links(tmp_path):
    home, folder, outside = tmp_path / "home", tmp_path / "proj", tmp_path / "outside"
    (outside / "memory").mkdir(parents=True)
    folder.mkdir()
    (folder / ".alpine").symlink_to(outside, target_is_directory=True)

    migrate_project(folder, home)

    assert (folder / ".alpine").is_symlink() and not (folder / ".alpine-code").exists()


def test_the_server_start_moves_every_listed_project_and_opening_moves_a_new_one(tmp_path):
    home, listed, new = tmp_path / "home", tmp_path / "listed", tmp_path / "new"
    projects = ProjectList(home / "projects.json")
    (listed / ".alpine" / "map").mkdir(parents=True)
    projects.open(listed)
    (listed / ".alpine-code").rename(listed / ".alpine")  # as an older version left it

    migrate_projects(home)
    assert (listed / ".alpine-code" / "map").is_dir()

    (new / ".alpine" / "memory").mkdir(parents=True)
    projects.open(new)
    assert (new / ".alpine-code" / "memory").is_dir()


def test_deleting_a_project_removes_its_local_map_too(tmp_path):
    home, folder = tmp_path / "home", tmp_path / "proj"
    folder.mkdir()
    projects = ProjectList(home / "projects.json")
    projects.open(folder)
    (home / "projects" / project_key(folder) / "product-map").mkdir(parents=True)

    projects.delete(folder)

    assert not (home / "projects" / project_key(folder)).exists()
