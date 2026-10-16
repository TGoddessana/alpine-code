import asyncio
import json

import pytest

from alpine_core import FileSecrets
from alpine_core.github import Account, DeviceCode, Repository, SignInError, SignInErrorKind, saved_account
from alpine_server import clones as clones_module
from alpine_server import github as github_module
from alpine_server.github import GitHubSignIns
from alpine_server.stdio import Server


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("ALPINE_GITHUB_CLIENT_ID", "Iv1.test")
    return tmp_path / "home"


class FakeSignIn:
    """A sign-in whose code is entered when the test says so."""

    def __init__(self):
        self.code = DeviceCode("WDJB-MJHT", "https://github.com/login/device", "dev", 5, 0)
        self.outcome: asyncio.Future = asyncio.get_running_loop().create_future()

    async def wait(self):
        return await self.outcome

    def cancel(self):
        if not self.outcome.done():
            self.outcome.set_exception(asyncio.CancelledError())


class Harness:
    def __init__(self):
        self.lines: list[dict] = []
        self.started: list[FakeSignIn] = []

        async def start():
            self.started.append(FakeSignIn())
            return self.started[-1]

        self.server = Server(lambda line: self.lines.append(json.loads(line)))
        self.server.github = GitHubSignIns(self.server._send_github_sign_in_finished, start)
        self.server._async_handlers |= self.server.github.handlers()

    async def call(self, method, params=None):
        await self.server.handle_line(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}))
        return self.lines.pop()

    def finished(self):
        return [line["params"] for line in self.lines if line.get("method") == "github/signInFinished"]


def test_sign_in_keeps_the_account_and_announces_it(home):
    async def run():
        harness = Harness()
        status = (await harness.call("github/status"))["result"]
        assert status["available"] and status["account"] is None and status["accessUrl"].endswith("/Iv1.test")

        started = (await harness.call("github/signIn"))["result"]
        assert started["userCode"] == "WDJB-MJHT" and started["verificationUri"] == "https://github.com/login/device"
        harness.started[0].outcome.set_result(Account("octo", "gho_1"))
        await asyncio.sleep(0.05)
        assert harness.finished() == [
            {"attemptId": started["attemptId"], "result": "connected", "account": {"login": "octo"}, "message": None}
        ]
        assert (await harness.call("github/status"))["result"]["account"] == {"login": "octo"}
        assert saved_account(FileSecrets(home / "auth.json")).token == "gho_1"

        await harness.call("github/signOut")
        assert (await harness.call("github/status"))["result"]["account"] is None

    asyncio.run(run())


def test_a_new_sign_in_cancels_the_waiting_one_and_declines_are_announced(home):
    async def run():
        harness = Harness()
        first = (await harness.call("github/signIn"))["result"]["attemptId"]
        second = (await harness.call("github/signIn"))["result"]["attemptId"]
        await asyncio.sleep(0.05)
        harness.started[1].outcome.set_exception(SignInError(SignInErrorKind.DECLINED, "Declined on GitHub"))
        await asyncio.sleep(0.05)
        ends = {f["attemptId"]: f["result"] for f in harness.finished()}
        assert ends == {first: "cancelled", second: "declined"}

    asyncio.run(run())


def test_no_client_id_offers_no_sign_in(home, monkeypatch):
    monkeypatch.delenv("ALPINE_GITHUB_CLIENT_ID")
    monkeypatch.setattr("alpine_core.github.CLIENT_ID", "")

    async def run():
        server = Server(lambda line: None)
        assert not (await server.github.status(None)).available

    asyncio.run(run())


def test_repositories_need_a_sign_in_that_github_still_accepts(home, monkeypatch):
    store = FileSecrets(home / "auth.json")

    async def run():
        harness = Harness()
        assert (await harness.call("github/repos"))["error"]["data"] == {"reason": "auth"}

        github_module.save_account(store, Account("octo", "gho_1"))
        monkeypatch.setattr(
            github_module,
            "repositories",
            lambda token: [Repository("acme/app", "https://github.com/acme/app.git", True, None, None)],
        )
        repos = (await harness.call("github/repos"))["result"]["repositories"]
        assert repos == [
            {
                "fullName": "acme/app",
                "cloneUrl": "https://github.com/acme/app.git",
                "private": True,
                "pushedAt": None,
                "description": None,
            }
        ]

        def refused(token):
            raise github_module.SignedOut("Bad credentials")

        monkeypatch.setattr(github_module, "repositories", refused)
        assert (await harness.call("github/repos"))["error"]["data"] == {"reason": "auth"}
        assert saved_account(store) is None  # a token GitHub refuses is forgotten

    asyncio.run(run())


def test_clones_from_github_use_the_sign_in(home):
    store = FileSecrets(home / "auth.json")
    assert clones_module._github_sign_in("acme/app") is None
    github_module.save_account(store, Account("octo", "gho_1"))
    assert clones_module._github_sign_in("acme/app") == clones_module.Credentials("octo", "gho_1")
    assert clones_module._github_sign_in("https://gitlab.com/acme/app") is None
    assert clones_module._github_sign_in("git@github.com:acme/app.git") is None  # SSH signs in with a key
