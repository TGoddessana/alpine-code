"""The 데이터 tab's backend (practice and live data) and the agent's live-data tools, against the scripted fake API and
a fixture sqlite in the folder layout the Cloudflare Vite plugin keeps."""

import json
import sqlite3
from pathlib import Path

import pytest
from alpineagents import State, ToolCall, ToolError
from alpineagents.permissions import Allowed, Denied
from alpineagents.testing import FakeModel, tool_call
from alpineagents.tool import collect_tools
from cloud_project import SCHEMA, make_practice

from alpine_core import Decision, Mode, Notice, Session, Settings
from alpine_core import session as session_module
from alpine_core.approval import AllowByPolicy, DecideByApprover
from alpine_core.cancellation import current_notice
from alpine_core.cloud import AlpineTokens, CloudClient, CloudError, LiveData, auth, create_app, data, links, tools
from alpine_core.cloud.data import DataError
from alpine_core.cloud.tools import LiveDataTools, write_hints, write_title_and_preview
from alpine_core.permissions import PermissionPolicy, kind_of
from alpine_core.tool_sources import Builtins
from alpine_core.tools import Workspace


@pytest.fixture(autouse=True)
def fresh_tools():
    tools.forget()
    yield
    tools.forget()


@pytest.fixture
def folder(tmp_path):
    folder = tmp_path / "craft-booking"
    folder.mkdir()
    return folder


@pytest.fixture
def signed_in(cloud):
    auth.save(auth.verify_code("me@example.com", cloud.email_code))


@pytest.fixture
def live(cloud, signed_in, folder):
    """The project's app, linked and live, with the schema's data."""
    app = create_app(CloudClient(AlpineTokens()), "craft-booking", "web-lite")
    links.link(folder, app.id)
    cloud.make_live(app.id, SCHEMA)
    return app


# ---------------------------------------------------------------- practice data


def test_masking_follows_whole_words():
    for name in (
        "password_hash",
        "accessToken",
        "token",
        "client_secret",
        "refresh_token_hash",
        "API_SECRET",
        "api_tokens",
        "passwords",
    ):
        assert data.is_masked(name), name
    for name in ("hashtag", "secretary", "id", "email"):
        assert not data.is_masked(name), name


def test_the_platform_tables_are_hidden_like_the_apis():
    for name in ("sqlite_master", "_cf_KV", "d1_migrations", "alpine_backup__todos_dep1", "alpine_meta__x"):
        assert data.is_hidden(name), name
    assert not data.is_hidden("todos")


def test_practice_is_available_once_the_plugin_made_its_database(folder):
    assert data.practice_file(folder) is None
    assert data.sources(folder)[0] == {"kind": "practice", "available": False}
    file = make_practice(folder)
    assert data.practice_file(folder) == file  # not the empty metadata file
    assert data.sources(folder)[0] == {"kind": "practice", "available": True}
    assert data.sources(folder)[1] == {"kind": "live", "available": False}


def test_practice_tables_hide_the_platforms_and_describe_columns(folder):
    make_practice(folder)
    found = {t.name: t for t in data.tables(folder, "practice")}
    assert sorted(found) == ["bookings", "user"]  # d1_migrations and _cf_KV are hidden
    assert found["bookings"].rows == 3
    guest = next(c for c in found["bookings"].columns if c["name"] == "guest")
    pk = next(c for c in found["bookings"].columns if c["name"] == "id")
    assert guest == {"name": "guest", "type": "TEXT", "pk": False, "nullable": False, "references": None}
    assert pk["pk"] is True and pk["nullable"] is False


def test_practice_rows_page_sort_and_mask(folder):
    make_practice(folder)
    page = data.rows(folder, "practice", "bookings", limit=2, offset=1, order="guest", dir="desc")
    assert page["columns"] == ["id", "guest", "status", "party", "created_at"]
    assert [r[1] for r in page["rows"]] == ["Joon", "Ara"] and page["total"] == 3
    users = data.rows(folder, "practice", "user")
    assert users["rows"][0] == ["u1", "mina@example.com", "••••", "••••", "fun"]
    assert users["rows"][1] == ["u2", "joon@example.com", None, None, None]  # nothing to hide in an empty cell


def test_practice_refuses_hidden_tables_and_unknown_names(folder):
    make_practice(folder)
    for table in ("d1_migrations", "_cf_KV", "sqlite_master", "nope", 'bookings"; DROP TABLE bookings; --'):
        with pytest.raises(DataError) as e:
            data.rows(folder, "practice", table)
        assert e.value.code == "not_found"
    with pytest.raises(DataError) as e:
        data.rows(folder, "practice", "bookings", order="nope")
    assert e.value.code == "invalid"
    with pytest.raises(DataError) as e:
        data.rows(Path("/nonexistent-project"), "practice", "bookings")
    assert e.value.code == "not_available"


def test_practice_save_updates_by_key_and_inserts_without_one(folder):
    file = make_practice(folder)
    data.save(folder, "practice", "bookings", {"id": "b1"}, {"status": "cancelled", "party": 5})
    data.save(folder, "practice", "bookings", None, {"id": "b4", "guest": "O'Neil", "party": 1})
    db = sqlite3.connect(file)
    assert db.execute("SELECT status, party FROM bookings WHERE id = 'b1'").fetchone() == ("cancelled", 5)
    assert db.execute("SELECT guest FROM bookings WHERE id = 'b4'").fetchone() == ("O'Neil",)
    assert db.execute("SELECT count(*) FROM bookings").fetchone() == (4,)


def test_practice_save_is_parameterized_and_checks_the_key(folder):
    file = make_practice(folder)
    data.save(folder, "practice", "bookings", {"id": "b1"}, {"guest": "x'; DROP TABLE bookings; --"})
    assert sqlite3.connect(file).execute("SELECT guest FROM bookings WHERE id = 'b1'").fetchone()[0].startswith("x'")
    with pytest.raises(DataError) as e:
        data.save(folder, "practice", "bookings", {"id": "zzz"}, {"guest": "x"})
    assert e.value.code == "not_found"
    for key, cells in (
        ({"nope": 1}, {"guest": "x"}),
        ({"id": "b1"}, {"nope": "x"}),
        ({}, {"guest": "x"}),
        ({"id": "b1"}, {}),
    ):
        with pytest.raises(DataError) as e:
            data.save(folder, "practice", "bookings", key, cells)
        assert e.value.code == "invalid"
    with pytest.raises(DataError):
        data.save(folder, "practice", "bookings", {"id": "b1"}, {"guest": ["a"]})
    with pytest.raises(DataError) as e:
        data.save(folder, "practice", "bookings", None, {"id": "b1", "guest": "dup"})  # primary key taken
    assert e.value.code == "invalid"


def test_practice_does_not_edit_secrets_or_hidden_tables(folder):
    make_practice(folder)
    with pytest.raises(DataError) as e:
        data.save(folder, "practice", "user", {"id": "u1"}, {"password_hash": "x"})
    assert e.value.code == "invalid"
    for table in ("d1_migrations", "_cf_KV"):
        with pytest.raises(DataError) as e:
            data.delete(folder, "practice", table, {"id": 1})
        assert e.value.code == "not_found"


def test_practice_delete_by_key(folder):
    file = make_practice(folder)
    data.delete(folder, "practice", "bookings", {"id": "b2"})
    assert sqlite3.connect(file).execute("SELECT count(*) FROM bookings").fetchone() == (2,)
    with pytest.raises(DataError) as e:
        data.delete(folder, "practice", "bookings", {"id": "b2"})
    assert e.value.code == "not_found"


def test_practice_waits_for_a_busy_database(folder):
    file = make_practice(folder)
    holder = sqlite3.connect(file, timeout=0.1)
    holder.execute("BEGIN IMMEDIATE")  # the running dev server holds the write lock
    try:
        assert data.rows(folder, "practice", "bookings")["total"] == 3  # reading still works
        assert data.BUSY_TIMEOUT == 5.0
    finally:
        holder.rollback()
        holder.close()


# ---------------------------------------------------------------- live data


def test_live_is_read_only_here(live, folder):
    for fn, args in ((data.save, (None, {"guest": "x"})), (data.delete, ({"id": "b1"},))):
        with pytest.raises(DataError) as e:
            fn(folder, "live", "bookings", *args)
        assert e.value.code == "read_only"


def test_live_tables_rows_and_masking_through_the_api(cloud, live, folder):
    assert data.sources(folder)[1] == {"kind": "live", "available": True}
    assert [t.name for t in data.tables(folder, "live")] == ["bookings", "user"]
    page = data.rows(folder, "live", "user")
    assert page["rows"][0][2] == "••••"
    assert data.rows(folder, "live", "bookings", limit=2)["rows"][0][0] == "b1"
    request = cloud.calls("GET", f"/v1/apps/{live.id}/data/tables/bookings/rows")[0]
    assert request["query"]["limit"] == "2"
    with pytest.raises(CloudError) as e:
        data.rows(folder, "live", "d1_migrations")
    assert e.value.code == "not_found"


def test_live_foreign_keys_come_as_table_dot_column(cloud, signed_in, folder):
    app = create_app(CloudClient(AlpineTokens()), "craft-booking", "web-lite")
    cloud.make_live(
        app.id,
        "CREATE TABLE a (id integer PRIMARY KEY);"
        "CREATE TABLE b (id integer PRIMARY KEY, a_id integer REFERENCES a(id));",
    )
    links.link(folder, app.id)
    [b] = [t for t in data.tables(folder, "live") if t.name == "b"]
    assert {c["name"]: c["references"] for c in b.columns} == {"id": None, "a_id": "a.id"}


def test_live_is_not_available_before_the_app_is_live(cloud, signed_in, folder):
    app = create_app(CloudClient(AlpineTokens()), "craft-booking", "web-lite")
    with pytest.raises(DataError) as e:
        data.tables(folder, "live")  # not linked
    assert e.value.code == "not_available"
    links.link(folder, app.id)
    assert data.sources(folder)[1]["available"] is False  # empty
    assert LiveData(folder).offered() == []


def test_reads_lists_what_the_ai_read(cloud, live, folder):
    assert data.reads(folder) == []
    LiveDataTools(folder).app_data_read("SELECT guest FROM bookings")
    [read] = data.reads(folder)
    assert read["sql"] == "SELECT guest FROM bookings" and read["rows"] == 3 and read["tables"] == ["bookings"]


# ---------------------------------------------------------------- the tools


def tool_map(folder) -> dict:
    return collect_tools([LiveDataTools(folder)])


def test_tools_are_only_offered_for_a_live_app(live, folder, tmp_path):
    names = {o.tool.name for o in LiveData(folder).offered()}
    assert names == {"app_data_read", "app_data_write"}
    other = tmp_path / "other"
    other.mkdir()
    assert LiveData(other).offered() == []


def test_a_read_is_kind_read_and_a_write_is_exec(live, folder):
    mapped = tool_map(folder)
    read, write = mapped["app_data_read"], mapped["app_data_write"]
    assert kind_of(read, {"sql": "SELECT 1"}) == "read"
    assert kind_of(write, {"sql": "UPDATE bookings SET status = 'x' WHERE id = ?"}) == "exec"
    assert kind_of(write, {"sql": "DELETE FROM bookings"}) == "exec"


@pytest.mark.parametrize(
    ("sql", "destructive"),
    [
        ("DELETE FROM bookings WHERE id = ?", True),
        ("delete from bookings", True),
        ("UPDATE bookings SET status = 'x'", True),
        ("UPDATE bookings SET status = 'WHERE' ", True),  # the word inside a text is not a WHERE
        ("UPDATE bookings SET status = 'x' WHERE id = 'b1'", False),
        ("UPDATE bookings SET status = ? -- where\n", True),
        ("REPLACE INTO bookings (id, guest) VALUES ('b1', 'x')", True),
        ("INSERT OR REPLACE INTO bookings (id, guest) VALUES ('b1', 'x')", True),
        ("INSERT INTO bookings (id, guest) SELECT id, email FROM user", True),
        ("INSERT INTO bookings (id, guest) VALUES ('b9', 'new')", False),
        ("INSERT INTO bookings (id, guest) VALUES ('b9', 'select')", False),
        ("VACUUM", True),  # not understood: the worst case
    ],
)
def test_destructive_comes_from_the_statement(sql, destructive):
    hints = write_hints({"sql": sql})
    assert hints.destructive is destructive
    assert hints.read_only is False and hints.open_world is True
    assert write_hints({}).destructive is True  # no statement at all


def test_the_approval_says_when_a_write_is_hard_to_undo():
    title, preview = write_title_and_preview(
        {"sql": "DELETE FROM bookings WHERE status = ?", "params": ["cancelled"], "reason": "Clean up"}
    )
    assert title == "Delete rows in bookings (live data, hard to undo; a restore point is taken first)"
    assert "DELETE FROM bookings" in preview and '["cancelled"]' in preview and "Reason: Clean up" in preview
    title, _ = write_title_and_preview({"sql": "UPDATE bookings SET status = 'x' WHERE id = 'b1'"})
    assert title == "Change rows in bookings (live data; a restore point is taken first)"
    assert write_title_and_preview({"sql": "INSERT INTO bookings (id) VALUES ('x')"})[0].startswith(
        "Add rows to bookings"
    )
    assert write_title_and_preview({"sql": "VACUUM"})[0].startswith("Change data (live data, hard to undo")


class Approver:
    def __init__(self, *decisions: Decision) -> None:
        self.decisions = list(decisions) or [Decision("allow")]
        self.requests = []

    def approve(self, request):
        self.requests.append(request)
        return self.decisions.pop(0)


def checks(folder, mode):
    """What `AllowByPolicy` and `DecideByApprover` say about each tool in a mode."""
    policy = PermissionPolicy(Workspace(folder), mode)
    approver = Approver()
    mapped = tool_map(folder)
    allow, decide = AllowByPolicy(policy), DecideByApprover(policy, approver)

    def ask(name, **args):
        call = ToolCall(name, args, "c1")
        verdict = allow.check(State(), call, mapped[name])
        return verdict if verdict is not None else decide.check(State(), call, mapped[name])

    return ask, approver


def test_a_read_never_asks_and_a_write_asks_except_in_yolo(live, folder):
    for mode in (Mode.DEFAULT, Mode.ACCEPT_EDITS):
        ask, approver = checks(folder, mode)
        assert ask("app_data_read", sql="SELECT 1") == Allowed()
        assert ask("app_data_write", sql="UPDATE bookings SET status = 'x' WHERE id = 'b1'", reason="r") == Allowed()
        [request] = approver.requests  # the owner was asked once, for the write
        assert "restore point" in request.title and "UPDATE bookings" in request.preview
    ask, approver = checks(folder, Mode.YOLO)
    assert ask("app_data_write", sql="DELETE FROM bookings", reason="r") == Allowed()
    assert approver.requests == []


def test_a_declined_write_does_not_run(cloud, live, folder):
    policy = PermissionPolicy(Workspace(folder), Mode.DEFAULT)
    decide = DecideByApprover(policy, Approver(Decision("deny")))
    call = ToolCall("app_data_write", {"sql": "DELETE FROM bookings", "reason": "r"}, "c1")
    assert isinstance(decide.check(State(), call, tool_map(folder)["app_data_write"]), Denied)
    assert cloud.calls("POST", f"/v1/apps/{live.id}/data/execute") == []


def test_a_read_sends_purpose_agent_and_the_session(cloud, live, folder):
    result = json.loads(LiveDataTools(folder).app_data_read("SELECT guest FROM bookings WHERE id = ?", ["b1"]))
    assert result["rows"] == [["Mina"]]
    [call] = cloud.calls("POST", f"/v1/apps/{live.id}/data/query")
    assert call["body"]["purpose"] == "agent" and call["body"]["params"] == ["b1"]


def test_a_write_reaches_the_api_and_reports_the_restore_point(cloud, live, folder):
    result = json.loads(
        LiveDataTools(folder).app_data_write("DELETE FROM bookings WHERE status = ?", "Clean up", ["cancelled"])
    )
    assert result["changes"] == 1 and result["restore_point"]["id"].startswith("rp_")
    [call] = cloud.calls("POST", f"/v1/apps/{live.id}/data/execute")
    assert call["body"]["reason"] == "Clean up" and call["body"]["sql"].startswith("DELETE FROM")
    assert cloud.points[live.id][-1]["reason"] == "data_write"


def test_the_api_refusing_a_statement_reaches_the_model(cloud, live, folder):
    with pytest.raises(ToolError, match="invalid"):
        LiveDataTools(folder).app_data_write("DROP TABLE bookings", "oops")
    with pytest.raises(ToolError, match="invalid"):
        LiveDataTools(folder).app_data_read("DELETE FROM bookings")
    assert LiveDataTools(folder).app_data_read("SELECT 1") is not None
    auth.forget()
    with pytest.raises(ToolError, match="sign in"):
        LiveDataTools(folder).app_data_read("SELECT 1")


def test_the_first_read_of_a_project_gives_a_notice_once(live, folder, tmp_path):
    seen = []
    token = current_notice.set(lambda text, code: seen.append((text, code)))
    try:
        tool_ = LiveDataTools(folder)
        tool_.app_data_read("SELECT 1")
        tool_.app_data_read("SELECT 2")
        assert [code for _, code in seen] == ["live_data_first_read"]
        assert "sent to the AI model" in seen[0][0]
        assert links.get(folder).live_read_notice is True
        # a failed read does not use it up: the project below never read anything
        other = tmp_path / "other"
        other.mkdir()
        with pytest.raises(ToolError):
            LiveDataTools(other).app_data_read("SELECT 1")
        assert len(seen) == 1
    finally:
        current_notice.reset(token)


def test_the_notice_is_remembered_across_sessions_of_the_project(live, folder):
    seen = []
    token = current_notice.set(lambda text, code: seen.append(code))
    try:
        LiveDataTools(folder).app_data_read("SELECT 1")
        LiveDataTools(folder).app_data_read("SELECT 1")  # a new tool object, as a new session makes
    finally:
        current_notice.reset(token)
    assert seen == ["live_data_first_read"]


# ---------------------------------------------------------------- in a session


def run_session(folder, monkeypatch, replies, *decisions, mode=Mode.DEFAULT):
    model = FakeModel(replies)  # one, so building the agent again goes on where the replies were
    monkeypatch.setattr(session_module, "make_model", lambda settings: model)
    events, approver = [], Approver(*decisions)
    session = Session(
        Settings(model="fake", mode=mode),
        on_event=events.append,
        approver=approver,
        cwd=folder,
        tools=lambda f: [Builtins(Workspace(f)), LiveData(f)],
    )
    return session, events, approver


def test_a_session_reads_live_data_without_asking_and_tells_the_user_once(live, folder, monkeypatch):
    session, events, approver = run_session(
        folder,
        monkeypatch,
        [
            tool_call("app_data_read", sql="SELECT count(*) FROM bookings"),
            tool_call("app_data_read", sql="SELECT 1"),
            "3",
        ],
    )
    assert session.send("how many bookings?") == "3"
    assert approver.requests == []
    notices = [e for e in events if isinstance(e, Notice)]
    assert [n.code for n in notices] == ["live_data_first_read"]


def test_a_session_asks_before_a_live_write(cloud, live, folder, monkeypatch):
    write = tool_call("app_data_write", sql="DELETE FROM bookings WHERE id = ?", params=["b1"], reason="Test")
    session, _, approver = run_session(folder, monkeypatch, [write, "done"], Decision("allow"))
    assert session.send("delete b1") == "done"
    [request] = approver.requests
    assert request.title.startswith("Delete rows in bookings") and "hard to undo" in request.title
    assert cloud.databases[live.id].execute("SELECT count(*) FROM bookings").fetchone() == (2,)


def test_a_session_gets_the_tools_when_its_app_goes_live(cloud, signed_in, folder, monkeypatch):
    app = create_app(CloudClient(AlpineTokens()), "craft-booking", "web-lite")
    links.link(folder, app.id)
    session, events, _ = run_session(folder, monkeypatch, ["hi", tool_call("app_data_read", sql="SELECT 1"), "ok"])
    assert session.send("hello") == "hi"
    cloud.make_live(app.id, SCHEMA)
    tools.forget()  # the answer to "is it live?" is kept for a few seconds
    assert session.send("read it") == "ok"
    assert any(getattr(e, "name", None) == "app_data_read" for e in events)
