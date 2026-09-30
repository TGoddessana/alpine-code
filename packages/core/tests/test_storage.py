import json
import os

import pytest
from alpineagents import FileStore

from alpine_core import FileSessionLog, SessionInfo, SessionLog, Storage, UsageInfo, file_storage, home_dir


def make_info(session_id="s1", updated_at="2026-09-30T10:00:00+00:00", **fields):
    values = dict(
        id=session_id,
        title="Fix the bug",
        cwd="/work/app",
        model="motif-3",
        mode="ask",
        created_at="2026-09-30T09:00:00+00:00",
        updated_at=updated_at,
    )
    values.update(fields)
    return SessionInfo(**values)


def item(n, text="hi"):
    return {"id": f"i{n}", "kind": "user_message", "text": text}


@pytest.fixture
def log(tmp_path):
    return FileSessionLog(tmp_path / "sessions")


def test_info_round_trips_through_dict():
    info = make_info(
        status="waiting",
        usage=UsageInfo(
            input_tokens=1, output_tokens=2, cache_read_tokens=3, cache_write_tokens=4, requests=5, cost=0.5
        ),
        context_used=99,
    )
    assert SessionInfo.from_dict(json.loads(json.dumps(info.to_dict()))) == info


def test_info_from_dict_defaults_and_null_cost():
    info = SessionInfo.from_dict({"id": "x"})
    assert (info.status, info.usage, info.context_used) == ("idle", UsageInfo(), 0)
    assert make_info().to_dict()["usage"]["cost"] is None


def test_file_log_is_a_session_log(log):
    assert isinstance(log, SessionLog)


def test_create_then_read_empty(log):
    log.create(make_info())
    info, records = log.read("s1")
    assert info == make_info()
    assert records == []


def test_create_twice_fails_and_keeps_the_first(log):
    log.create(make_info(title="first"))
    with pytest.raises(ValueError):
        log.create(make_info(title="second"))
    assert log.read("s1")[0].title == "first"


def test_append_and_read_in_order_with_unicode(log):
    log.create(make_info())
    log.append("s1", [(0, item(0, "안녕")), (1, item(1))])
    log.append("s1", [(2, item(2))])
    _, records = log.read("s1")
    assert records == [(0, item(0, "안녕")), (1, item(1)), (2, item(2))]


def test_append_skips_seq_already_stored(log):
    log.create(make_info())
    log.append("s1", [(0, item(0)), (1, item(1))])
    log.append("s1", [(1, item(1, "changed")), (2, item(2))])
    log.append("s1", [(0, item(0, "again"))])
    _, records = log.read("s1")
    assert records == [(0, item(0)), (1, item(1)), (2, item(2))]


def test_append_skips_across_a_new_instance(tmp_path):
    root = tmp_path / "sessions"
    first = FileSessionLog(root)
    first.create(make_info())
    first.append("s1", [(0, item(0)), (1, item(1))])
    second = FileSessionLog(root)
    second.append("s1", [(1, item(1, "dup")), (2, item(2))])
    assert [seq for seq, _ in second.read("s1")[1]] == [0, 1, 2]


def test_append_nothing_is_fine(log):
    log.create(make_info())
    log.append("s1", [])
    assert log.read("s1")[1] == []


def test_update_replaces_info_and_keeps_items(log):
    log.create(make_info())
    log.append("s1", [(0, item(0))])
    log.update(make_info(status="running", title="New", context_used=7))
    info, records = log.read("s1")
    assert (info.status, info.title, info.context_used) == ("running", "New", 7)
    assert records == [(0, item(0))]


def test_list_is_most_recently_updated_first(log):
    log.create(make_info("a", updated_at="2026-09-30T10:00:00+00:00"))
    log.create(make_info("b", updated_at="2026-09-30T12:00:00+00:00"))
    log.create(make_info("c", updated_at="2026-09-30T11:00:00+00:00"))
    assert [info.id for info in log.list()] == ["b", "c", "a"]
    log.update(make_info("a", updated_at="2026-09-30T13:00:00+00:00"))
    assert [info.id for info in log.list()] == ["a", "b", "c"]


def test_list_of_empty_or_missing_root(log):
    assert log.list() == []


def test_list_ignores_stray_folders_and_files(log, tmp_path):
    log.create(make_info())
    root = tmp_path / "sessions"
    (root / "no-info").mkdir()
    (root / "broken").mkdir()
    (root / "broken" / "info.json").write_text("{not json")
    (root / ".new-x").mkdir()
    (root / "file.txt").write_text("x")
    assert [info.id for info in log.list()] == ["s1"]


def test_delete_removes_and_is_idempotent(log, tmp_path):
    log.create(make_info())
    log.delete("s1")
    log.delete("s1")
    log.delete("never")
    assert log.list() == []
    assert [p.name for p in (tmp_path / "sessions").iterdir()] == []
    with pytest.raises(LookupError):
        log.read("s1")


def test_id_can_be_reused_after_delete(log):
    log.create(make_info())
    log.append("s1", [(0, item(0))])
    log.delete("s1")
    log.create(make_info())
    log.append("s1", [(0, item(0, "fresh"))])
    assert log.read("s1")[1] == [(0, item(0, "fresh"))]


def test_missing_session_raises_lookup_error(log):
    log.create(make_info())
    with pytest.raises(LookupError):
        log.read("nope")
    with pytest.raises(LookupError):
        log.append("nope", [(0, item(0))])
    with pytest.raises(LookupError):
        log.update(make_info("nope"))


def test_append_after_delete_by_another_process_raises(tmp_path):
    root = tmp_path / "sessions"
    mine = FileSessionLog(root)
    mine.create(make_info())
    FileSessionLog(root).delete("s1")
    with pytest.raises(LookupError):
        mine.append("s1", [(0, item(0))])


@pytest.mark.parametrize("bad", ["", "../x", "a/b", ".hidden", "a\\b"])
def test_bad_ids_are_rejected(log, bad):
    with pytest.raises(ValueError):
        log.create(make_info(bad))
    with pytest.raises(ValueError):
        log.read(bad)
    with pytest.raises(ValueError):
        log.delete(bad)


def test_torn_last_line_is_ignored_on_read(log, tmp_path):
    log.create(make_info())
    log.append("s1", [(0, item(0)), (1, item(1))])
    with open(tmp_path / "sessions" / "s1" / "items.jsonl", "ab") as file:
        file.write(b'{"seq":2,"item":{"id":"i2","ki')
    assert [seq for seq, _ in log.read("s1")[1]] == [0, 1]


def test_append_after_a_torn_line_repairs_the_file(tmp_path):
    root = tmp_path / "sessions"
    first = FileSessionLog(root)
    first.create(make_info())
    first.append("s1", [(0, item(0)), (1, item(1))])
    path = root / "s1" / "items.jsonl"
    with open(path, "ab") as file:
        file.write(b'{"seq":2,"item":{"id":"i2","ki')
    second = FileSessionLog(root)
    second.append("s1", [(2, item(2)), (3, item(3))])
    assert [seq for seq, _ in second.read("s1")[1]] == [0, 1, 2, 3]
    assert all(json.loads(line) for line in path.read_text("utf-8").splitlines())


def test_a_complete_last_line_without_newline_is_treated_as_torn(tmp_path):
    root = tmp_path / "sessions"
    first = FileSessionLog(root)
    first.create(make_info())
    first.append("s1", [(0, item(0))])
    path = root / "s1" / "items.jsonl"
    with open(path, "ab") as file:
        file.write(b'{"seq":1,"item":{"id":"i1"}}')
    second = FileSessionLog(root)
    second.append("s1", [(1, item(1))])
    assert [seq for seq, _ in second.read("s1")[1]] == [0, 1]
    assert second.read("s1")[1][1][1] == item(1)


def test_files_are_owner_only(log, tmp_path):
    log.create(make_info())
    log.append("s1", [(0, item(0))])
    folder = tmp_path / "sessions" / "s1"
    for name in ("info.json", "items.jsonl"):
        assert os.stat(folder / name).st_mode & 0o077 == 0


def test_file_storage_uses_home_dir(home):
    storage = file_storage()
    assert isinstance(storage, Storage)
    assert isinstance(storage.states, FileStore)
    storage.log.create(make_info())
    assert (home / "sessions" / "s1" / "info.json").is_file()
    assert home_dir() == home


def test_file_storage_with_explicit_home(tmp_path):
    storage = file_storage(tmp_path / "other")
    storage.log.create(make_info())
    assert (tmp_path / "other" / "sessions" / "s1" / "info.json").is_file()
    assert storage.states == FileStore(tmp_path / "other" / "states")


def test_state_and_log_share_an_id_without_colliding(tmp_path):
    storage = file_storage(tmp_path)
    storage.log.create(make_info("shared"))
    # A State folder may be created before or after the log folder, in either order.
    storage.states.write(
        "shared", [{"seq": 0, "at": "2026-09-30T09:00:00+00:00", "role": "user", "content": "task"}], None, create=True
    )
    assert storage.log.read("shared")[0].id == "shared"
    assert [saved.id for saved in storage.states.list()] == ["shared"]
    assert [info.id for info in storage.log.list()] == ["shared"]
