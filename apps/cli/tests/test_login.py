import io

import pytest
from rich.console import Console

import alpine_cli.commands as commands
import alpine_core.chatgpt.connections as connections
from alpine_cli.commands import Context, find
from alpine_core import FileSecrets, config_file, home_dir
from alpine_core.chatgpt import Account

SCOPES = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ALPINE_API_KEY"):
        monkeypatch.delenv(name, raising=False)


def account(scope=SCOPES) -> Account:
    tokens = {"access_token": "at", "refresh_token": "rt", "id_token": "idt", "expires_in": 3600, "scope": scope}
    return Account(client_id="oaiapp_1", subject="user-1", email="a@example.com").with_tokens(tokens)


def run(line: str) -> str:
    out = io.StringIO()
    cmd, arg = find(line)
    assert cmd.run(Context(session=None, console=Console(file=out, width=200)), arg)
    return out.getvalue()


def test_login_adds_a_connection_and_logout_signs_it_out(monkeypatch):
    signed_in = []

    async def sign_in(console, previous, consent):
        signed_in.append((previous, consent))
        return account()

    monkeypatch.setattr(commands, "_sign_in", sign_in)
    monkeypatch.setattr(commands, "fetch_models", lambda token: [type("M", (), {"slug": "gpt-5.5"})()])
    out = run("/login")
    assert "Signed in as a@example.com · connection chatgpt" in out and "/model chatgpt/gpt-5.5" in out
    assert '[connections.chatgpt]\nprovider = "chatgpt"' in config_file().read_text()

    monkeypatch.setattr(connections, "revoke", lambda account: True)
    assert "Signed out of chatgpt" in run("/logout")
    assert FileSecrets(home_dir() / "auth.json").get_oauth("chatgpt")["access_token"] == ""

    run("/login chatgpt")  # signs in again to the same registration
    assert signed_in[-1][0].client_id == "oaiapp_1" and signed_in[-1][1] is False


def test_login_without_plan_permission_says_how_to_allow_it(monkeypatch):
    async def sign_in(console, previous, consent):
        return account(scope="openid profile email offline_access")

    monkeypatch.setattr(commands, "_sign_in", sign_in)
    assert "was not allowed. Run /login chatgpt to allow it." in run("/login")
    assert "No ChatGPT connection named 'nope'" in run("/login nope")
