import asyncio
import json

import pytest

from alpine_core import FileSecrets, home_dir
from alpine_core.chatgpt import Account, SignInError
from alpine_server.chatgpt import ChatGPTSignIns
from alpine_server.stdio import Server


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path / "home"


SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"


def account(client_id="oaiapp_1", scope=SCOPES) -> Account:
    tokens = {"access_token": "at", "refresh_token": "rt", "id_token": "idt", "expires_in": 3600, "scope": scope}
    return Account(client_id=client_id, subject="user-1", email="a@example.com").with_tokens(tokens)


class FakeSignIn:
    """A sign-in whose browser part ends when the test says so."""

    def __init__(self, previous, consent):
        self.previous, self.consent = previous, consent
        self.url = "https://auth.openai.com/api/accounts/authorize?fake"
        self.outcome: asyncio.Future = asyncio.get_running_loop().create_future()

    async def wait(self):
        return await self.outcome

    def cancel(self):
        if not self.outcome.done():
            self.outcome.set_exception(SignInError(SignInError.Kind.CANCELLED, "Signing in was cancelled."))


class Harness:
    def __init__(self):
        self.lines: list[dict] = []
        self.started: list[FakeSignIn] = []

        async def start(host, *, previous=None, consent=False):
            assert host.startswith("urn:uuid:")
            self.started.append(FakeSignIn(previous, consent))
            return self.started[-1]

        self.server = Server(lambda line: self.lines.append(json.loads(line)))
        self.server.sign_ins = ChatGPTSignIns(self.server._send_sign_in_finished, start)
        self.server._async_handlers |= self.server.sign_ins.handlers()

    async def call(self, method, params=None):
        await self.server.handle_line(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}))
        return self.lines.pop()

    def finished(self):
        return [line["params"] for line in self.lines if line.get("method") == "chatgpt/signInFinished"]


def test_sign_in_adds_a_connection_and_announces_it(home):
    async def run():
        h = Harness()
        started = (await h.call("chatgpt/signIn"))["result"]
        assert started["url"].startswith("https://auth.openai.com/")
        h.started[0].outcome.set_result(account())
        await asyncio.sleep(0.05)
        [done] = h.finished()
        assert done["attemptId"] == started["attemptId"] and done["result"] == "connected"
        assert done["connection"] == {
            "name": "chatgpt",
            "provider": "chatgpt",
            "baseUrl": "https://api.openai.com/v1",
            "billing": "subscription",
            "hasKey": True,
            "account": {"email": "a@example.com", "signedIn": True, "planUsage": True},
        }
        listed = (await h.call("connections/list"))["result"]
        assert [c["name"] for c in listed["connections"]] == ["chatgpt"]
        assert all(p["id"] != "chatgpt" for p in listed["providers"])  # not in the API key form

        # Signing in again to that connection passes its account, and a new sign-in cancels the waiting one.
        await h.call("chatgpt/signIn", {"connection": "chatgpt", "consent": True})
        assert h.started[1].previous.client_id == "oaiapp_1" and h.started[1].consent
        await h.call("chatgpt/signIn")
        await asyncio.sleep(0.05)
        assert [f["result"] for f in h.finished()] == ["connected", "cancelled"]
        await h.server.close()

    asyncio.run(run())


def test_declined_sign_in_and_sign_out(home, monkeypatch):
    import alpine_core.chatgpt.connections as connections

    monkeypatch.setattr(connections, "revoke", lambda account: True)

    async def run():
        h = Harness()
        await h.call("chatgpt/signIn")
        h.started[0].outcome.set_exception(SignInError(SignInError.Kind.DECLINED, "Signing in was declined."))
        await asyncio.sleep(0.05)
        assert h.finished()[0]["result"] == "declined" and h.finished()[0]["connection"] is None

        await h.call("chatgpt/signIn")
        h.started[1].outcome.set_result(account(scope="openid profile email offline_access"))
        await asyncio.sleep(0.05)
        connection = h.finished()[-1]["connection"]
        assert connection["hasKey"] is False and connection["account"]["planUsage"] is False

        assert (await h.call("chatgpt/signOut", {"connection": "chatgpt"}))["result"] == {"revoked": True}
        saved = FileSecrets(home_dir() / "auth.json").get_oauth("chatgpt")
        assert saved["access_token"] == "" and saved["client_id"] == "oaiapp_1"
        info = (await h.call("connections/list"))["result"]["connections"][0]
        assert info["account"]["signedIn"] is False
        missing = await h.call("chatgpt/signOut", {"connection": "nope"})
        assert "No ChatGPT connection" in missing["error"]["message"]
        await h.server.close()

    asyncio.run(run())
