"""Plans, the trial, payment, custom domains, the badge and the web-pro dev branch over the server, against the fake
Alpine API."""

import asyncio
import json
import urllib.request

import pytest
from cloud_project import make_project

from alpine_core import Settings
from alpine_core import session as session_module
from alpine_core.cloud import links, pro, publish, runtimes
from alpine_protocol import SessionNewParams, SessionSendParams
from alpine_server.dev_branches import DevBranches
from alpine_server.sessions import SessionManager
from alpine_server.stdio import Server


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY", "ALPINE_CLOUD_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(runtimes, "_extra_bins", lambda: [])
    monkeypatch.setattr(publish, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(pro, "POLL_SECONDS", 0.01)


class Harness:
    def __init__(self):
        self.lines: list[dict] = []
        self.server = Server(lambda line: self.lines.append(json.loads(line)))
        self.next_id = 0

    async def call(self, method, params=None):
        self.next_id += 1
        mine = self.next_id
        request = {"jsonrpc": "2.0", "id": mine, "method": method, "params": params or {}}
        await self.server.handle_line(json.dumps(request))
        return next(line for line in reversed(self.lines) if line.get("id") == mine)

    async def sign_in(self, cloud):
        reply = await self.call("cloud/verifyCode", {"email": "me@example.com", "code": cloud.email_code})
        assert reply["result"]["signedIn"] is True

    def notes(self, method):
        return [line["params"] for line in self.lines if line.get("method") == method]

    async def changed(self, predicate, seconds=5):
        async with asyncio.timeout(seconds):
            while True:
                found = [n["status"] for n in self.notes("cloud/changed") if predicate(n["status"])]
                if found:
                    return found[-1]
                await asyncio.sleep(0.02)


def reason(reply):
    return reply["error"]["data"]["reason"]


async def browser(url):
    def visit():
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.read().decode()

    return await asyncio.to_thread(visit)


def test_the_trial_makes_pro_and_is_announced_and_a_second_one_is_a_conflict(cloud):
    async def scenario():
        h = Harness()
        assert reason(await h.call("cloud/startTrial")) == "signed_out"
        await h.sign_in(cloud)
        status = (await h.call("cloud/startTrial"))["result"]
        assert status["plan"]["id"] == "pro" and status["plan"]["status"] == "trialing"
        assert status["limits"]["webPro"] is True
        await h.changed(lambda s: s["plan"]["status"] == "trialing")
        assert reason(await h.call("cloud/startTrial")) == "conflict"
        await h.server.close()

    asyncio.run(scenario())


def test_checkout_hands_out_the_page_and_the_return_announces_the_plan(cloud):
    async def scenario():
        h = Harness()
        await h.sign_in(cloud)
        url = (await h.call("cloud/checkout", {"plan": "pro"}))["result"]["url"]
        assert "/v1/billing/fake/checkout/" in url
        await browser(url + "/pay")  # the fake provider sends the browser to the app's loopback address
        status = await h.changed(lambda s: s["plan"]["id"] == "pro")
        assert status["plan"]["status"] == "active"
        await h.server.close()

    asyncio.run(scenario())


def test_checkout_needs_a_sign_in_and_the_portal_a_plan(cloud):
    async def scenario():
        h = Harness()
        assert reason(await h.call("cloud/checkout", {"plan": "pro"})) == "signed_out"
        await h.sign_in(cloud)
        assert reason(await h.call("cloud/portal")) == "conflict"
        await h.call("cloud/startTrial")
        url = (await h.call("cloud/portal"))["result"]["url"]
        assert "/v1/billing/fake/portal/" in url
        await h.server.close()

    asyncio.run(scenario())


def test_domains_and_the_badge_map_to_the_api(cloud, tmp_path):
    async def scenario():
        h = Harness()
        folder = make_project(tmp_path)
        await h.sign_in(cloud)
        cwd = str(folder)
        assert reason(await h.call("publish/domains", {"cwd": cwd})) == "not_found"  # no app yet
        await h.call("publish/prepare", {"id": "p1", "cwd": cwd})  # makes and links the app
        assert reason(await h.call("publish/addDomain", {"cwd": cwd, "domain": "craft.example.com"})) == (
            "payment_required"
        )
        assert reason(await h.call("publish/setBadge", {"cwd": cwd, "badge": False})) == "payment_required"
        shown = (await h.call("publish/setBadge", {"cwd": cwd, "badge": True}))["result"]
        assert shown["app"]["badge"] is True

        await h.call("cloud/startTrial")
        added = (await h.call("publish/addDomain", {"cwd": cwd, "domain": "craft.example.com", "mail": True}))["result"]
        domain = added["domain"]
        assert domain["status"] == "pending" and len(domain["records"]) == 5 and domain["domainConnect"] is None
        assert domain["records"][0]["purpose"] == "web" and domain["records"][0]["ok"] is False
        listed = (await h.call("publish/domains", {"cwd": cwd}))["result"]["domains"]
        assert [d["name"] for d in listed] == ["craft.example.com"]
        cloud.dns_ready = True
        checked = (await h.call("publish/checkDomain", {"cwd": cwd, "id": domain["id"]}))["result"]["domain"]
        assert checked["status"] == "active"
        assert (await h.call("publish/removeDomain", {"cwd": cwd, "id": domain["id"]}))["result"] == {}
        assert (await h.call("publish/domains", {"cwd": cwd}))["result"]["domains"] == []
        off = (await h.call("publish/setBadge", {"cwd": cwd, "badge": False}))["result"]
        assert off["app"]["badge"] is False
        await h.server.close()

    asyncio.run(scenario())


# ---------------------------------------------------------------- the dev branch around a session


def test_a_session_in_a_web_pro_project_gets_the_dev_branch_and_a_publish_takes_it_away(cloud, tmp_path, monkeypatch):
    from alpineagents.testing import FakeModel

    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(["ok", "ok again"]))

    async def scenario():
        from alpine_core.cloud import account, auth, billing

        auth.save(auth.verify_code("me@example.com", cloud.email_code))
        billing.start_trial()
        folder = make_project(tmp_path, kind="web-pro")
        plan = await asyncio.to_thread(publish.prepare, folder, progress=lambda *a: None)  # makes the web-pro app
        app_id = links.get(folder).app_id
        env_file = folder / ".env.development.local"
        assert not env_file.exists() and cloud.calls("POST", f"/v1/apps/{app_id}/dev-branch") == []

        sessions = SessionManager(lambda params: None, settings=lambda: Settings(model="fake"))
        branches = DevBranches()
        sessions.on_start, sessions.before_run = branches.start, branches.ready
        started = await sessions.new(SessionNewParams(cwd=str(folder)))
        await branches.ready(folder)
        assert env_file.read_text().splitlines() == [
            "VITE_SUPABASE_URL=https://craft-booking-dev.db.test",
            "VITE_SUPABASE_ANON_KEY=anon-dev-craft-booking",
        ]

        await asyncio.to_thread(publish.run, folder, plan.deploy_id, [], progress=lambda *a: None)
        assert not env_file.exists() and app_id not in cloud.branches

        # the next message of the session makes a new branch before the AI works
        await sessions.send(SessionSendParams(session_id=started.info.id, text="go on"))
        async with asyncio.timeout(5):
            while not env_file.exists():
                await asyncio.sleep(0.02)
        assert len(cloud.calls("POST", f"/v1/apps/{app_id}/dev-branch")) == 2
        await branches.shutdown()
        await sessions.shutdown()
        account.reset()

    asyncio.run(scenario())


def test_a_project_that_is_not_web_pro_or_has_no_app_makes_no_branch(cloud, tmp_path):
    async def scenario():
        from alpine_core.cloud import auth, billing

        auth.save(auth.verify_code("me@example.com", cloud.email_code))
        billing.start_trial()
        branches = DevBranches()
        lite = make_project(tmp_path, name="lite-one")
        pro_unlinked = make_project(tmp_path, name="pro-one", kind="web-pro")
        for folder in (lite, pro_unlinked):
            branches.start(folder)
            await branches.ready(folder)
        assert not [r for r in cloud.requests if "dev-branch" in r["path"]]
        await branches.shutdown()

    asyncio.run(scenario())


def test_a_branch_that_cannot_be_made_does_not_stop_the_session(cloud, tmp_path, capsys):
    async def scenario():
        from alpine_core.cloud import auth, billing

        auth.save(auth.verify_code("me@example.com", cloud.email_code))
        billing.start_trial()
        folder = make_project(tmp_path, kind="web-pro")
        await asyncio.to_thread(publish.prepare, folder, progress=lambda *a: None)
        cloud.plan = {**cloud.plan, "id": "free", "status": "cancelled"}  # the trial ended meanwhile
        branches = DevBranches()
        await branches.ready(folder)  # answers, does not raise
        assert not (folder / ".env.development.local").exists()
        err = capsys.readouterr().err
        assert "CloudError" in err and "anon" not in err

    asyncio.run(scenario())
