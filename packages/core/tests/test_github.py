import asyncio

import pytest

from alpine_core import github
from alpine_core.github import (
    Account,
    SignedOut,
    SignIn,
    SignInError,
    access_token,
    forget_account,
    repositories,
    save_account,
    saved_account,
)
from alpine_core.secrets import FileSecrets


@pytest.fixture(autouse=True)
def client_id(monkeypatch):
    monkeypatch.setenv("ALPINE_GITHUB_CLIENT_ID", "Iv1.test")


class FakeGitHub:
    """Answers the device flow from a script of token responses, then ``/user``."""

    def __init__(self, polls):
        self.polls = list(polls)
        self.calls = []

    def __call__(self, method, url, fields, token):
        self.calls.append((method, url, fields, token))
        if url == github.DEVICE_CODE_URL:
            return 200, {
                "device_code": "dev-1",
                "user_code": "WDJB-MJHT",
                "verification_uri": "https://github.com/login/device",
                "expires_in": 900,
                "interval": 5,
            }
        if url == github.TOKEN_URL:
            return self.polls.pop(0)
        if url == f"{github.API}/user":
            return (200, {"login": "octo"}) if token == "gho_1" else (401, {"message": "Bad credentials"})
        raise AssertionError(url)


class Clock:
    def __init__(self):
        self.now = 1000.0
        self.slept = []

    def __call__(self):
        return self.now

    async def sleep(self, seconds):
        self.slept.append(seconds)
        self.now += seconds


def run_sign_in(polls):
    fake, clock = FakeGitHub(polls), Clock()

    async def go():
        sign_in = await SignIn.start(fake, clock.sleep, clock)
        assert sign_in.code.user_code == "WDJB-MJHT"
        return await sign_in.wait()

    return asyncio.run(go()), fake, clock


def test_the_code_is_entered_and_github_hands_over_the_account():
    account, fake, clock = run_sign_in(
        [
            (200, {"error": "authorization_pending"}),
            (200, {"error": "slow_down", "interval": 10}),
            (200, {"access_token": "gho_1", "token_type": "bearer", "scope": "repo"}),
        ]
    )
    assert account == Account(login="octo", token="gho_1")
    assert clock.slept == [5, 5, 10]  # slow_down makes the next wait longer
    asked = fake.calls[0][2]
    assert asked == {"client_id": "Iv1.test", "scope": "repo"}


def test_declined_and_expired_codes_end_the_sign_in():
    with pytest.raises(SignInError) as declined:
        run_sign_in([(200, {"error": "access_denied"})])
    assert declined.value.kind == "declined"
    with pytest.raises(SignInError) as expired:
        run_sign_in([(200, {"error": "expired_token"})])
    assert expired.value.kind == "timed_out"


def test_no_client_id_means_no_sign_in(monkeypatch):
    monkeypatch.delenv("ALPINE_GITHUB_CLIENT_ID")
    monkeypatch.setattr(github, "CLIENT_ID", "")
    with pytest.raises(SignInError) as failed:
        asyncio.run(SignIn.start(FakeGitHub([])))
    assert failed.value.kind == "failed"


def test_cancel_stops_waiting():
    fake = FakeGitHub([(200, {"error": "authorization_pending"})] * 100)

    async def go():
        sign_in = await SignIn.start(fake, asyncio.sleep)
        sign_in.code = sign_in.code.__class__(**{**sign_in.code.__dict__, "interval": 0.01})
        waiting = asyncio.create_task(sign_in.wait())
        await asyncio.sleep(0.05)
        sign_in.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiting

    asyncio.run(go())


def test_the_sign_in_is_kept_refreshed_and_forgotten(tmp_path):
    store = FileSecrets(tmp_path / "auth.json")
    assert saved_account(store) is None
    with pytest.raises(SignedOut):
        access_token(store)

    save_account(store, Account("octo", "old", refresh_token="ghr_1", expires_at=1000.0 + 100))
    calls = []

    def refresh(method, url, fields, token):
        calls.append(fields)
        return 200, {"access_token": "new", "refresh_token": "ghr_2", "expires_in": 28800}

    renewed = access_token(store, refresh, clock=lambda: 1000.0)
    assert (renewed.token, renewed.refresh_token, renewed.expires_at) == ("new", "ghr_2", 1000.0 + 28800)
    assert calls[0]["grant_type"] == "refresh_token" and calls[0]["refresh_token"] == "ghr_1"
    assert saved_account(store) == renewed
    assert access_token(store, refresh, clock=lambda: 1000.0) == renewed and len(calls) == 1  # not due yet

    assert forget_account(store) and saved_account(store) is None and not forget_account(store)


def test_repositories_are_read_page_by_page():
    pages = {
        1: [{"full_name": f"acme/r{i}", "clone_url": f"https://github.com/acme/r{i}.git"} for i in range(100)],
        2: [{"full_name": "me/blog", "clone_url": "https://github.com/me/blog.git", "private": True}],
    }

    def call(method, url, fields, token):
        assert token == "gho_1" and "affiliation=owner" in url
        page = int(url.split("&page=")[1].split("&")[0])
        return 200, pages[page]

    found = repositories("gho_1", call)
    assert len(found) == 101 and found[-1].full_name == "me/blog" and found[-1].private
    with pytest.raises(SignedOut):
        repositories("gho_1", lambda *args: (401, {"message": "Bad credentials"}))
