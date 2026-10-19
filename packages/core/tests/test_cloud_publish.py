"""Publishing against the scripted fake API (``fake_cloud.py``), with a project whose build output is already there, so
no npm runs. The layout is what the Cloudflare Vite plugin writes (see ``make_project``)."""

import json
import subprocess
import threading
import time

import pytest
from cloud_project import git, make_project

from alpine_core.cloud import CloudError, auth, links, project, publish
from alpine_core.cloud import build as cloud_build
from alpine_core.cloud.build import BuildCancelled, BuildFailed


@pytest.fixture(autouse=True)
def quick_polls(monkeypatch):
    monkeypatch.setattr(publish, "POLL_SECONDS", 0.01)


@pytest.fixture
def signed_in(cloud):
    auth.save(auth.verify_code("me@example.com", cloud.email_code))


class Recorder:
    """What ``publish/changed`` would carry."""

    def __init__(self):
        self.events: list[tuple[str, float, str | None, list | None]] = []

    def __call__(self, phase, progress, message=None, checks=None):
        self.events.append((phase, progress, message, checks))

    @property
    def phases(self) -> list[str]:
        return list(dict.fromkeys(e[0] for e in self.events))


# ---------------------------------------------------------------- cloud.toml and status


def test_cloud_toml_gives_build_and_database(tmp_path):
    description = project.read_description(make_project(tmp_path))
    assert description.build_command == "echo building" and description.build_output == "dist"
    assert (description.database_kind, description.migrations) == ("d1", "drizzle")
    assert not description.needs_node
    assert project.CloudDescription(1, "web-lite", "cloudflare-workers", build_command="npm run build").needs_node


def test_status_says_why_a_project_cannot_be_published(cloud, signed_in, tmp_path, monkeypatch):
    bare = tmp_path / "bare"
    bare.mkdir()
    assert publish.status(bare).reason == "no_description"
    blank = tmp_path / "blank"
    (blank / ".alpine-code").mkdir(parents=True)
    (blank / ".alpine-code" / "cloud.toml").write_text('version = 1\nkind = "blank"\n')
    assert publish.status(blank).reason == "not_web"

    folder = make_project(tmp_path, command="npm run build")
    with monkeypatch.context() as no_node:
        no_node.setattr("alpine_core.cloud.runtimes.find_node", lambda *a, **k: None)
        assert publish.status(folder).reason == "no_node"
    assert publish.status(folder).reason is None

    auth.forget()
    assert publish.status(make_project(tmp_path, name="other")).reason == "signed_out"


def test_status_of_a_new_project_then_a_linked_one(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    first = publish.status(folder)
    assert first.publishable and first.reason is None and first.app is None and first.changes == 0
    plan = publish.prepare(folder, progress=Recorder())
    again = publish.status(folder)
    assert again.app is not None and again.app.id == plan.app.id and again.app.status == "empty"
    assert again.last_published_at is None and again.changes == 0  # nothing was published yet


def test_a_deleted_app_is_forgotten(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    publish.prepare(folder, progress=Recorder())
    cloud.apps.clear()
    assert publish.status(folder).app is None
    assert links.get(folder) is None


# ---------------------------------------------------------------- build


def test_the_vite_output_is_read_through_the_deploy_pointer(tmp_path):
    folder = make_project(tmp_path)
    built = cloud_build.read_output(folder, project.read_description(folder))
    assert built.main == "index.js" and built.compatibility_date == "2026-10-19"
    assert built.compatibility_flags == ["nodejs_compat"]
    assert [m.name for m in built.modules] == ["assets/chunk-1.js", "index.js"]  # no map, no config
    assert {m.type for m in built.modules} == {"esm"}
    assert [a.path for a in built.assets] == ["/assets/index-1a2b.css", "/assets/index-1a2b.js", "/index.html"]
    types = {a.path: a.content_type for a in built.assets}
    assert types["/index.html"] == "text/html" and types["/assets/index-1a2b.js"] == "text/javascript"
    assert types["/assets/index-1a2b.css"] == "text/css"
    assert [m.name for m in built.migrations] == ["0000_auth.sql", "0001_notes.sql"]
    assert built.expects == {"secrets": ["BETTER_AUTH_SECRET"], "d1": ["DB"]}
    assert all(len(a.hash) == 64 for a in built.assets) and built.assets[2].size == 31


def test_a_pointer_that_leaves_the_project_is_refused(tmp_path):
    folder = make_project(tmp_path)
    (folder / ".wrangler" / "deploy" / "config.json").write_text(json.dumps({"configPath": "../../../outside.json"}))
    with pytest.raises(BuildFailed, match="outside the project"):
        cloud_build.read_output(folder, project.read_description(folder))


def test_no_output_is_a_failed_build(tmp_path):
    folder = make_project(tmp_path)
    (folder / ".wrangler" / "deploy" / "config.json").unlink()
    (folder / "dist" / "my_app" / "wrangler.json").unlink()
    with pytest.raises(BuildFailed):
        cloud_build.read_output(folder, project.read_description(folder))


def test_a_failed_build_carries_the_last_forty_lines(tmp_path):
    folder = make_project(tmp_path, command="seq 1 100; echo oops >&2; exit 3")
    with pytest.raises(BuildFailed) as failed:
        cloud_build.build(folder, project.read_description(folder))
    lines = failed.value.tail.splitlines()
    assert len(lines) == 40 and lines[-1] == "oops" and lines[0] == "62" and "exit 3" in failed.value.message


def test_a_build_can_be_cancelled(tmp_path):
    folder = make_project(tmp_path, command="sleep 30")
    cancel = threading.Event()
    threading.Timer(0.3, cancel.set).start()
    started = time.monotonic()
    with pytest.raises(BuildCancelled):
        cloud_build.build(folder, project.read_description(folder), cancel=cancel)
    assert time.monotonic() - started < 10


def test_the_build_runs_in_the_project_folder(tmp_path):
    folder = make_project(tmp_path, command="pwd > built-here.txt")
    cloud_build.build(folder, project.read_description(folder))
    assert (folder / "built-here.txt").read_text().strip() == str(folder.resolve())


# ---------------------------------------------------------------- prepare


def test_prepare_builds_checks_uploads_and_makes_the_app(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    progress = Recorder()
    plan = publish.prepare(folder, progress=progress, locale="ko")
    assert plan.deploy_id.startswith("dep_") and not plan.blocked
    assert plan.app.name == "craft-booking" and links.get(folder).app_id == plan.app.id
    assert [c["id"] for c in plan.checks] == ["secret", "open-api"]
    assert [c["state"] for c in plan.checks] == ["ok", "skipped"]  # no dev server running
    assert plan.shape["pending"] == [] and plan.shape["confirms"] == []
    assert progress.phases == ["build", "checks", "upload"]

    [start] = cloud.calls("POST", f"/v1/apps/{plan.app.id}/deploys")
    manifest = start["body"]
    assert manifest["cloud"] == {
        "version": 1,
        "kind": "web-lite",
        "adapter": "cloudflare-workers",
        "database": {"kind": "d1", "migrations": "drizzle"},
    }
    assert manifest["worker"]["main"] == "index.js" and manifest["worker"]["expects"]["d1"] == ["DB"]
    assert manifest["worker"]["compatibility_flags"] == ["nodejs_compat"]
    assert [a["path"] for a in manifest["assets"]][-1] == "/index.html"
    assert [m["name"] for m in manifest["migrations"]] == ["0000_auth.sql", "0001_notes.sql"]
    assert manifest["client"]["checks"] == {"secret": "ok"}
    assert (
        manifest["source"]["commit"]
        == subprocess.check_output(["git", "-C", str(folder), "rev-parse", "HEAD"], text=True).strip()
    )
    assert start["headers"]["Accept-Language"] == "ko"
    assert len(cloud.blobs) == 2 + 3 + 2  # modules, assets (the ignored file stays home), migrations


def test_prepare_uploads_only_what_the_api_misses(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    plan = publish.prepare(folder, progress=Recorder())
    first = len([r for r in cloud.requests if r["method"] == "PUT"])
    assert first == 7
    (folder / "dist" / "client" / "index.html").write_text("<!doctype html><title>changed</title>")
    publish.prepare(folder, progress=Recorder())
    assert len([r for r in cloud.requests if r["method"] == "PUT"]) == first + 1
    assert len(cloud.calls("POST", f"/v1/apps/{plan.app.id}/deploys")) == 2


def test_prepare_reuses_the_app_it_is_linked_to(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    publish.prepare(folder, progress=Recorder())
    publish.prepare(folder, progress=Recorder())
    assert len(cloud.apps) == 1 and len(cloud.calls("POST", "/v1/apps")) == 1


def test_prepare_passes_the_dev_server_to_the_local_checks(cloud, signed_in, tmp_path, monkeypatch):
    seen = {}

    def fake(project_folder, *, assets, dev_url):
        seen.update(project=project_folder, assets=assets, dev_url=dev_url)
        from alpine_core.cloud.checks import Finding, LocalReport

        route = Finding(
            "open-api", "open_api.readable", "warn", None, None, {"method": "GET", "path": "/api/notes"}, "Close it."
        )
        return LocalReport((route,), frozenset({"secret", "open-api"}), {})

    monkeypatch.setattr("alpine_core.cloud.checks.run_local_checks", fake)
    folder = make_project(tmp_path)
    progress = Recorder()
    plan = publish.prepare(folder, progress=progress, dev_url="http://localhost:5173")
    assert seen["dev_url"] == "http://localhost:5173" and seen["assets"].name == "client" and seen["project"] == folder
    by_id = {c["id"]: c for c in plan.checks}
    assert (
        by_id["open-api"]["state"] == "attention" and by_id["open-api"]["findings"][0]["params"]["path"] == "/api/notes"
    )
    assert by_id["secret"]["state"] == "ok"  # the server's answer
    sent = cloud.calls("POST", f"/v1/apps/{plan.app.id}/deploys")[0]["body"]["client"]["checks"]
    assert sent == {"secret": "ok", "open-api": "attention"}
    shown = [e for e in progress.events if e[3] is not None]
    assert shown[0][3][1]["id"] == "open-api" and shown[-1][3] == plan.checks  # local first, then the merged sheet


def test_a_secret_in_the_build_stops_before_anything_is_uploaded(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    (folder / "dist" / "client" / "assets" / "index-1a2b.js").write_text(
        'const key = "sk_live_' + "a1B2c3D4e5F6g7H8i9J0" + '";\n'
    )
    plan = publish.prepare(folder, progress=Recorder())
    assert plan.blocked and plan.deploy_id == ""
    [secret] = [c for c in plan.checks if c["id"] == "secret"]
    assert secret["state"] == "blocked" and secret["findings"][0]["code"] == "secret.stripe_live"
    assert "a1B2c3D4e5F6g7H8i9J0" not in json.dumps(plan.checks)  # redacted
    assert not cloud.calls("POST", f"/v1/apps/{plan.app.id}/deploys") and not cloud.blobs


def test_the_servers_secret_scan_is_the_one_that_decides(cloud, signed_in, tmp_path, monkeypatch):
    monkeypatch.setattr(publish, "_local_checks", lambda *a: [])  # a local scan that misses it
    folder = make_project(tmp_path)
    (folder / "dist" / "client" / "assets" / "index-1a2b.js").write_text(
        'const key = "sk_live_' + "a1B2c3D4e5F6g7H8i9J0" + '";\n'
    )
    plan = publish.prepare(folder, progress=Recorder())
    assert plan.blocked and plan.deploy_id
    [secret] = plan.checks
    assert secret["state"] == "blocked" and secret["findings"][0]["fallback"]
    with pytest.raises(CloudError) as error:
        publish.run(folder, plan.deploy_id, [], progress=Recorder())
    assert error.value.code == "blocked" and error.value.status == 422


def test_the_server_secret_check_replaces_the_local_one():
    local = [
        {"id": "secret", "state": "blocked", "findings": [{"code": "secret.x"}]},
        {"id": "open-api", "state": "attention", "findings": []},
    ]
    server = [
        {"id": "secret", "state": "ok", "findings": []},
        {
            "id": "advisor",
            "state": "attention",
            "findings": [{"check": "advisor", "code": "advisor.x", "severity": "warn"}],
        },
    ]
    merged = publish.merge_checks(local, server)
    assert [(c["id"], c["state"]) for c in merged] == [
        ("secret", "ok"),
        ("open-api", "attention"),
        ("advisor", "attention"),
    ]
    assert merged[2]["findings"][0]["params"] == {} and merged[2]["findings"][0]["fix"] == ""


def test_prepare_can_be_cancelled(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(publish.Cancelled):
        publish.prepare(folder, progress=Recorder(), cancel=cancel)
    assert not cloud.calls("POST", "/v1/apps/app_1/deploys")


def test_prepare_with_a_failing_build_says_what_failed(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path, command="echo 'src/app.ts(3,1): error TS2304'; exit 2")
    with pytest.raises(BuildFailed) as failed:
        publish.prepare(folder, progress=Recorder())
    assert "TS2304" in failed.value.tail


def test_prepare_signed_out_is_signed_out(cloud, tmp_path):
    with pytest.raises(auth.SignedOut):
        publish.prepare(make_project(tmp_path), progress=Recorder())


# ---------------------------------------------------------------- run


def test_run_publishes_and_follows_the_steps(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    plan = publish.prepare(folder, progress=Recorder())
    progress = Recorder()
    app, at = publish.run(folder, plan.deploy_id, [], progress=progress)
    assert app.status == "live" and app.id == plan.app.id and at == "2026-10-20T02:00:00Z"
    assert progress.phases == ["restore", "files", "shape", "live"]
    assert ("live", 1.0, None, None) in progress.events
    published = links.get(folder).published
    assert published.at == at and published.commit and published.tree
    status = publish.status(folder)
    assert status.last_published_at == at and status.changes == 0 and status.app.status == "live"


def test_an_unconfirmed_drop_stops_the_publish_until_it_is_confirmed(cloud, signed_in, tmp_path):
    cloud.confirms = [
        {
            "id": "drop_column:bookings.memo",
            "kind": "drop_column",
            "table": "bookings",
            "column": "memo",
            "rows_affected": 12,
        }
    ]
    cloud.pending_migrations = ["0002_drop_memo.sql"]
    folder = make_project(tmp_path)
    plan = publish.prepare(folder, progress=Recorder())
    assert plan.shape["pending"] == ["0002_drop_memo.sql"]
    assert (
        plan.shape["confirms"][0]["id"] == "drop_column:bookings.memo"
        and plan.shape["confirms"][0]["rows_affected"] == 12
    )
    with pytest.raises(CloudError) as refused:
        publish.run(folder, plan.deploy_id, [], progress=Recorder())
    assert (
        refused.value.code == "needs_confirm"
        and refused.value.detail["confirms"][0]["id"] == "drop_column:bookings.memo"
    )
    assert links.get(folder).published is None
    app, _ = publish.run(folder, plan.deploy_id, ["drop_column:bookings.memo"], progress=Recorder())
    assert app.status == "live"
    [publish_call] = [r for r in cloud.requests if r["path"].endswith("/publish")][-1:]
    assert publish_call["body"] == {"confirm": ["drop_column:bookings.memo"]}


def test_a_failed_step_is_reported_with_its_name(cloud, signed_in, tmp_path):
    cloud.fail_step = "shape"
    folder = make_project(tmp_path)
    plan = publish.prepare(folder, progress=Recorder())
    progress = Recorder()
    with pytest.raises(publish.PublishError) as failed:
        publish.run(folder, plan.deploy_id, [], progress=progress)
    assert failed.value.step == "shape" and "shape" in failed.value.message
    assert links.get(folder).published is None
    assert publish.status(folder).changes == 0


def test_run_needs_a_linked_app(cloud, signed_in, tmp_path):
    with pytest.raises(publish.NotLinked):
        publish.run(make_project(tmp_path), "dep_1", [], progress=Recorder())


# ---------------------------------------------------------------- unpublished changes


def test_changes_count_the_files_that_differ_from_the_last_publish(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    plan = publish.prepare(folder, progress=Recorder())
    publish.run(folder, plan.deploy_id, [], progress=Recorder())
    assert publish.status(folder).changes == 0
    (folder / "src" / "app.ts").write_text("export const a = 2;\n")  # edited, not committed
    assert publish.status(folder).changes == 1
    (folder / "src" / "new.ts").write_text("export {};\n")  # untracked
    (folder / "drizzle" / "0001_notes.sql").unlink()  # deleted
    assert publish.status(folder).changes == 3
    (folder / "dist" / "client" / "index.html").write_text("rebuilt")  # ignored: build output is not a change
    assert publish.status(folder).changes == 3
    git(folder, "add", "-A")
    git(folder, "commit", "-q", "-m", "second")  # committing changes nothing about the files
    assert publish.status(folder).changes == 3
    (folder / "src" / "app.ts").write_text("export const a = 1;\n")
    assert publish.status(folder).changes == 2


def test_source_leaves_the_real_index_alone_and_needs_git(tmp_path):
    folder = make_project(tmp_path)
    (folder / "src" / "staged.ts").write_text("x")
    git(folder, "add", "src/staged.ts")
    (folder / "src" / "loose.ts").write_text("y")
    before = subprocess.check_output(["git", "-C", str(folder), "status", "--porcelain"], text=True)
    source = project.source(folder)
    assert source.commit and source.tree
    assert subprocess.check_output(["git", "-C", str(folder), "status", "--porcelain"], text=True) == before
    plain = tmp_path / "plain"
    plain.mkdir()
    assert project.source(plain) is None


def test_source_works_before_the_first_commit(tmp_path):
    folder = tmp_path / "fresh"
    folder.mkdir()
    git(folder, "init", "-q", "-b", "main")
    (folder / "a.txt").write_text("a")
    source = project.source(folder)
    assert source.commit == "" and source.tree


# ---------------------------------------------------------------- restore


def test_restore_points_are_listed_made_and_restored(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    plan = publish.prepare(folder, progress=Recorder())
    publish.run(folder, plan.deploy_id, [], progress=Recorder())
    listed = publish.restore_points(folder)
    assert listed["window_days"] == 7 and [p["reason"] for p in listed["points"]] == ["publish"]
    manual = publish.create_restore_point(folder)
    assert manual["reason"] == "manual"
    publish.restore(folder, listed["points"][0]["id"])
    reasons = [p["reason"] for p in publish.restore_points(folder)["points"]]
    assert reasons == ["publish", "manual", "before_restore"]
    [call] = cloud.calls("POST", f"/v1/apps/{plan.app.id}/restore")
    assert call["body"] == {"point": listed["points"][0]["id"]}


def test_a_failed_restore_raises(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    publish.prepare(folder, progress=Recorder())
    point = publish.create_restore_point(folder)
    cloud.fail_restore = True
    with pytest.raises(publish.PublishError):
        publish.restore(folder, point["id"])


def test_restoring_an_unknown_point_is_not_found(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    publish.prepare(folder, progress=Recorder())
    with pytest.raises(CloudError) as error:
        publish.restore(folder, "rp_nope")
    assert error.value.code == "not_found"


def test_restore_without_an_app(cloud, signed_in, tmp_path):
    folder = make_project(tmp_path)
    with pytest.raises(publish.NotLinked):
        publish.restore_points(folder)
