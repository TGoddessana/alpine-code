"""``publish/*`` over the server, against the fake Alpine API and a project with a prebuilt output."""

import asyncio
import json

import pytest
from cloud_project import make_project

from alpine_core.cloud import publish, runtimes
from alpine_server.stdio import Server


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY", "ALPINE_CLOUD_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(runtimes, "_extra_bins", lambda: [])
    monkeypatch.setattr(publish, "POLL_SECONDS", 0.01)


class Harness:
    def __init__(self):
        self.lines: list[dict] = []
        self.server = Server(lambda line: self.lines.append(json.loads(line)))
        self.next_id = 0

    async def call(self, method, params=None):
        self.next_id += 1
        mine = self.next_id  # calls overlap (a cancel arrives while a prepare works)
        request = {"jsonrpc": "2.0", "id": mine, "method": method, "params": params or {}}
        await self.server.handle_line(json.dumps(request))
        return next(line for line in reversed(self.lines) if line.get("id") == mine)

    async def sign_in(self, cloud):
        reply = await self.call("cloud/verifyCode", {"email": "me@example.com", "code": cloud.email_code})
        assert reply["result"]["signedIn"] is True

    def notes(self, method):
        return [line["params"] for line in self.lines if line.get("method") == method]


def reason(reply):
    return reply["error"]["data"]["reason"]


def test_status_follows_the_project_and_the_sign_in(cloud, tmp_path):
    async def scenario():
        h = Harness()
        folder = make_project(tmp_path)
        assert (await h.call("publish/status", {"cwd": str(tmp_path)}))["result"]["reason"] == "no_description"
        assert (await h.call("publish/status", {"cwd": str(folder)}))["result"]["reason"] == "signed_out"
        await h.sign_in(cloud)
        result = (await h.call("publish/status", {"cwd": str(folder)}))["result"]
        assert result["publishable"] is True and result.get("reason") is None and result["changes"] == 0
        assert result.get("app") is None
        missing = await h.call("publish/status", {"cwd": str(tmp_path / "nope")})
        assert reason(missing) == "not_a_folder"
        await h.server.close()

    asyncio.run(scenario())


def test_prepare_and_run_announce_every_phase_and_answer_at_the_end(cloud, tmp_path):
    async def scenario():
        h = Harness()
        folder = make_project(tmp_path)
        await h.sign_in(cloud)
        reply = await h.call("publish/prepare", {"id": "p1", "cwd": str(folder), "locale": "ko"})
        plan = reply["result"]
        assert plan["blocked"] is False and plan["deployId"].startswith("dep_")
        assert [c["id"] for c in plan["checks"]] == ["secret", "open-api"]
        assert plan["app"]["name"] == "craft-booking" and plan["app"]["status"] == "empty"
        assert plan["shape"] == {"pending": [], "added": {"tables": [], "columns": []}, "confirms": []}
        phases = list(dict.fromkeys(n["phase"] for n in h.notes("publish/changed")))
        assert phases == ["build", "checks", "upload"] and all(n["id"] == "p1" for n in h.notes("publish/changed"))
        assert any(n.get("checks") for n in h.notes("publish/changed"))

        before = len(h.notes("publish/changed"))
        reply = await h.call(
            "publish/run", {"id": "p1", "cwd": str(folder), "deployId": plan["deployId"], "confirm": []}
        )
        assert reply["result"]["app"]["status"] == "live" and reply["result"]["publishedAt"] == "2026-10-20T02:00:00Z"
        run_phases = list(dict.fromkeys(n["phase"] for n in h.notes("publish/changed")[before:]))
        assert run_phases == ["restore", "files", "shape", "live"]

        (folder / "src" / "app.ts").write_text("export const a = 2;\n")
        status = (await h.call("publish/status", {"cwd": str(folder)}))["result"]
        assert status["changes"] == 1 and status["app"]["status"] == "live"
        assert status["lastPublishedAt"] == "2026-10-20T02:00:00Z"
        await h.server.close()

    asyncio.run(scenario())


def test_the_running_dev_server_is_handed_to_the_local_checks(cloud, tmp_path, monkeypatch):
    seen = {}
    from alpine_core.cloud.checks import LocalReport

    def fake(project, *, assets, dev_url):
        seen["dev_url"] = dev_url
        return LocalReport((), frozenset({"secret", "open-api"}), {})

    monkeypatch.setattr("alpine_core.cloud.checks.run_local_checks", fake)

    async def scenario():
        h = Harness()
        folder = make_project(tmp_path)
        await h.sign_in(cloud)

        async def servers(cwd):
            return [{"status": "stopped", "url": None}, {"status": "running", "url": "http://localhost:5173"}]

        h.server.dev_servers.manager.list = servers
        plan = (await h.call("publish/prepare", {"id": "p1", "cwd": str(folder)}))["result"]
        assert seen["dev_url"] == "http://localhost:5173"
        assert {c["id"]: c["state"] for c in plan["checks"]} == {"secret": "ok", "open-api": "ok"}
        await h.server.close()

    asyncio.run(scenario())


def test_confirms_blocks_and_failures_come_back_with_their_reasons(cloud, tmp_path):
    cloud.confirms = [{"id": "drop_table:old", "kind": "drop_table", "table": "old", "rows_affected": 0}]

    async def scenario():
        h = Harness()
        folder = make_project(tmp_path)
        await h.sign_in(cloud)
        plan = (await h.call("publish/prepare", {"id": "p1", "cwd": str(folder)}))["result"]
        assert plan["shape"]["confirms"][0]["id"] == "drop_table:old"
        run = {"id": "p1", "cwd": str(folder), "deployId": plan["deployId"]}
        assert reason(await h.call("publish/run", run)) == "needs_confirm"
        cloud.fail_step = "files"
        failed = await h.call("publish/run", run | {"confirm": ["drop_table:old"]})
        assert reason(failed) == "other" and "files" in failed["error"]["message"]

        (folder / "dist" / "client" / "index.html").write_text(
            '<script>"sk_live_' + "a1B2c3D4e5F6g7H8i9J0" + '"</script>'
        )
        blocked = (await h.call("publish/prepare", {"id": "p2", "cwd": str(folder)}))["result"]
        assert blocked["blocked"] is True and blocked["deployId"] == ""
        assert blocked["checks"][0]["findings"][0]["code"] == "secret.stripe_live"
        # Running that plan is refused as blocked, not as a deploy that does not exist.
        empty = {"id": "p2", "cwd": str(folder), "deployId": blocked["deployId"]}
        assert reason(await h.call("publish/run", empty)) == "blocked"
        cloud.apps[next(iter(cloud.apps))]["status"] = "taken_down"
        assert reason(await h.call("publish/run", empty)) == "taken_down"
        taken = (await h.call("publish/status", {"cwd": str(folder)}))["result"]
        assert taken["publishable"] is False and taken["reason"] == "taken_down"
        await h.server.close()

    asyncio.run(scenario())


def test_a_failed_build_is_build_failed_with_the_end_of_its_output(cloud, tmp_path):
    async def scenario():
        h = Harness()
        folder = make_project(tmp_path, command="echo 'error TS2304: cannot find name'; exit 2")
        await h.sign_in(cloud)
        reply = await h.call("publish/prepare", {"id": "p1", "cwd": str(folder)})
        assert reason(reply) == "build_failed" and "TS2304" in reply["error"]["message"]
        await h.server.close()

    asyncio.run(scenario())


def test_a_prepare_can_be_cancelled_while_it_builds(cloud, tmp_path):
    async def scenario():
        h = Harness()
        folder = make_project(tmp_path, command="sleep 30")
        await h.sign_in(cloud)
        task = asyncio.create_task(h.call("publish/prepare", {"id": "p1", "cwd": str(folder)}))
        async with asyncio.timeout(10):
            while not h.notes("publish/changed"):
                await asyncio.sleep(0.02)
        assert (await h.call("publish/cancel", {"id": "p1"}))["result"] == {}
        reply = await asyncio.wait_for(task, 10)
        assert "cancelled" in reply["error"]["message"]
        assert (await h.call("publish/cancel", {"id": "p1"}))["result"] == {}  # nothing left to stop
        await h.server.close()

    asyncio.run(scenario())


def test_restore_points_and_restore(cloud, tmp_path):
    async def scenario():
        h = Harness()
        folder = make_project(tmp_path)
        await h.sign_in(cloud)
        assert reason(await h.call("publish/restorePoints", {"cwd": str(folder)})) == "not_found"
        plan = (await h.call("publish/prepare", {"id": "p1", "cwd": str(folder)}))["result"]
        await h.call("publish/run", {"id": "p1", "cwd": str(folder), "deployId": plan["deployId"]})
        points = (await h.call("publish/restorePoints", {"cwd": str(folder)}))["result"]
        assert points["windowDays"] == 7 and [p["reason"] for p in points["points"]] == ["publish"]
        assert (await h.call("publish/restore", {"cwd": str(folder), "point": points["points"][0]["id"]}))[
            "result"
        ] == {}
        cloud.fail_restore = True
        failed = await h.call("publish/restore", {"cwd": str(folder), "point": points["points"][0]["id"]})
        assert reason(failed) == "other"
        unknown = await h.call("publish/restore", {"cwd": str(folder), "point": "rp_nope"})
        assert reason(unknown) == "not_found"
        await h.server.close()

    asyncio.run(scenario())
