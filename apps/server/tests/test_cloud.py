"""``cloud/*`` and ``projects/nodeTools`` over the server, against the fake Alpine API."""

import asyncio
import json
import urllib.request

import pytest

from alpine_core import Settings
from alpine_core.cloud import account, runtimes
from alpine_server.stdio import Server


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY", "ALPINE_CLOUD_URL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(runtimes, "_extra_bins", lambda: [])
    return tmp_path / "home"


class Harness:
    def __init__(self):
        self.lines: list[dict] = []
        self.server = Server(lambda line: self.lines.append(json.loads(line)))

    async def call(self, method, params=None):
        request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
        await self.server.handle_line(json.dumps(request))
        return next(line for line in reversed(self.lines) if line.get("id") == 1)

    def notes(self, method):
        return [line["params"] for line in self.lines if line.get("method") == method]

    async def until(self, method, count=1):
        async with asyncio.timeout(10):
            while len(self.notes(method)) < count:
                await asyncio.sleep(0.02)
        return self.notes(method)


def browse(url):
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status


def test_signed_out_status_names_the_api(cloud):
    async def scenario():
        h = Harness()
        result = (await h.call("cloud/status"))["result"]
        assert result["signedIn"] is False and result["apiUrl"] == cloud.url and result["reachable"] is True
        assert result["account"] is None and result["plan"] is None and result["credits"] is None
        await h.server.close()

    asyncio.run(scenario())


def test_browser_sign_in_announces_its_end_and_the_new_status(cloud):
    async def scenario():
        h = Harness()
        started = (await h.call("cloud/signIn", {"method": "google"}))["result"]
        assert started["url"].startswith(cloud.url + "/v1/auth/authorize?provider=google")
        assert await asyncio.to_thread(browse, started["url"]) == 200
        [done] = await h.until("cloud/signInFinished")
        assert done["attemptId"] == started["attemptId"] and done["result"] == "connected"
        status = done["status"]
        assert status["signedIn"] and status["account"]["email"] == "test@alpine.local"
        assert status["plan"]["id"] == "free" and status["limits"]["apps"] == 3
        assert status["credits"]["balance"] == 300 and status["appDomain"] == "alpinesite.test"
        assert h.notes("cloud/changed")[-1]["status"]["signedIn"] is True

        listed = (await h.call("connections/list"))["result"]
        alpine = next(c for c in listed["connections"] if c["name"] == "alpine")
        assert alpine["provider"] == "alpine" and alpine["billing"] == "credits" and alpine["hasKey"] is True
        assert all(p["id"] != "alpine" for p in listed["providers"])
        assert listed["defaultModel"] == "alpine/alpine-coder"

        assert (await h.call("cloud/signOut"))["result"] == {}
        assert h.notes("cloud/changed")[-1]["status"]["signedIn"] is False
        assert (await h.call("cloud/status"))["result"]["signedIn"] is False
        assert all(c["name"] != "alpine" for c in (await h.call("connections/list"))["result"]["connections"])
        await h.server.close()

    asyncio.run(scenario())


def test_a_new_sign_in_cancels_the_waiting_one_and_cancel_ends_it(cloud):
    async def scenario():
        h = Harness()
        first = (await h.call("cloud/signIn", {"method": "github"}))["result"]
        second = (await h.call("cloud/signIn", {"method": "google"}))["result"]
        await h.until("cloud/signInFinished")
        assert h.notes("cloud/signInFinished")[0]["attemptId"] == first["attemptId"]
        assert h.notes("cloud/signInFinished")[0]["result"] == "cancelled"
        await h.call("cloud/cancelSignIn", {"attemptId": second["attemptId"]})
        done = await h.until("cloud/signInFinished", 2)
        assert [d["result"] for d in done] == ["cancelled", "cancelled"]
        await h.server.close()

    asyncio.run(scenario())


def test_the_email_code_signs_in_and_a_wrong_code_is_invalid_code(cloud):
    async def scenario():
        h = Harness()
        assert (await h.call("cloud/sendCode", {"email": "haneul@example.com", "locale": "ko"}))["result"] == {}
        assert cloud.sent_codes == [{"email": "haneul@example.com", "locale": "ko"}]
        wrong = (await h.call("cloud/verifyCode", {"email": "haneul@example.com", "code": "000000"}))["error"]
        assert wrong["data"] == {"reason": "invalid_code"}
        bad = (await h.call("cloud/sendCode", {"email": "nope", "locale": "ko"}))["error"]
        assert bad["data"] == {"reason": "invalid"}  # only a wrong code is invalid_code
        status = (await h.call("cloud/verifyCode", {"email": "haneul@example.com", "code": "123456"}))["result"]
        assert status["signedIn"] and status["account"]["email"] == "haneul@example.com"
        assert Settings.load().model == "alpine/alpine-coder"
        await h.server.close()

    asyncio.run(scenario())


def test_credits_after_a_model_answer_are_announced(cloud):
    async def scenario():
        h = Harness()
        await h.call("cloud/verifyCode", {"email": "haneul@example.com", "code": "123456"})
        before = len(h.notes("cloud/changed"))
        await asyncio.to_thread(account.credits_seen, 250)
        await asyncio.sleep(0.05)
        assert h.notes("cloud/changed")[before:][0]["status"]["credits"]["balance"] == 250
        await h.server.close()

    asyncio.run(scenario())


def test_an_unreachable_api_is_reachable_false_not_signed_out(cloud):
    async def scenario():
        h = Harness()
        await h.call("cloud/verifyCode", {"email": "haneul@example.com", "code": "123456"})
        cloud.stop()
        status = (await h.call("cloud/status", {"refresh": True}))["result"]
        assert status["signedIn"] is True and status["reachable"] is False and status["credits"]["balance"] == 300
        await h.server.close()

    asyncio.run(scenario())


def test_plans_come_from_the_api_and_later_methods_say_not_available(cloud):
    async def scenario():
        h = Harness()
        plans = (await h.call("cloud/plans"))["result"]["plans"]
        assert [p["id"] for p in plans] == ["free", "pro"] and plans[1]["trialDays"] == 7
        for method, params in (
            ("publish/domains", {"cwd": "/x"}),
            ("publish/setBadge", {"cwd": "/x", "badge": False}),
            ("cloud/startTrial", {}),
        ):
            error = (await h.call(method, params))["error"]
            assert error["data"] == {"reason": "not_available"}
        await h.server.close()

    asyncio.run(scenario())


# ---------------------------------------------------------------- Node.js


def fake_node(folder, version):
    folder.mkdir(parents=True, exist_ok=True)
    node = folder / "node"
    node.write_text(f"#!/bin/sh\necho v{version}\n")
    node.chmod(0o755)


def test_node_tools_report_what_is_there(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))

    async def scenario():
        h = Harness()
        none = (await h.call("projects/nodeTools"))["result"]
        assert none == {"ready": False, "version": None, "required": "22.12", "alpineManaged": False}
        fake_node(runtimes.runtime_dir() / "bin", "22.14.0")
        own = (await h.call("projects/nodeTools"))["result"]
        assert own == {"ready": True, "version": "22.14.0", "required": "22.12", "alpineManaged": True}
        await h.server.close()

    asyncio.run(scenario())


def test_installing_node_reports_progress_and_the_end(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))

    def install(progress=None):
        progress(0.5)
        progress(1.0)
        fake_node(runtimes.runtime_dir() / "bin", "22.14.0")

    monkeypatch.setattr(runtimes, "install", install)

    async def scenario():
        h = Harness()
        assert (await h.call("projects/installNodeTools"))["result"] == {}
        await h.until("projects/nodeToolsChanged", 4)
        states = [n["state"] for n in h.notes("projects/nodeToolsChanged")]
        assert states[0] == "downloading" and states[-1] == "done"
        assert (await h.call("projects/nodeTools"))["result"]["ready"] is True
        await h.server.close()

    asyncio.run(scenario())


def test_a_failed_install_is_reported_with_its_reason(tmp_path, monkeypatch):
    def install(progress=None):
        raise runtimes.NodeInstallError("checksum", "The downloaded Node.js does not match.")

    monkeypatch.setattr(runtimes, "install", install)

    async def scenario():
        h = Harness()
        await h.call("projects/installNodeTools")
        [*_, failed] = await h.until("projects/nodeToolsChanged", 2)
        assert failed["state"] == "failed" and failed["reason"] == "checksum" and "does not match" in failed["message"]
        await h.server.close()

    asyncio.run(scenario())
