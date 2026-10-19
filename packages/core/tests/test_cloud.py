"""Alpine sign-in, account and links against the scripted fake API (``fake_cloud.py``)."""

import asyncio
import json
import urllib.error
import urllib.request

import pytest

from alpine_core import FileSecrets, Settings, home_dir
from alpine_core.cloud import (
    AlpineTokens,
    BrowserSignIn,
    CloudClient,
    CloudError,
    SignedOut,
    SignInError,
    Tokens,
    account,
    auth,
    complete_sign_in,
    links,
    send_code,
    verify_code,
)
from alpine_core.cloud import settings as cloud_settings


def browse(url: str) -> tuple[int, str]:
    """The person's browser: follows every redirect, like a real one, and returns the last page."""
    with urllib.request.urlopen(url, timeout=10) as response:
        return response.status, response.read().decode()


async def sign_in_with_browser(provider="google", **kwargs) -> Tokens:
    sign_in = await BrowserSignIn.start(provider, **kwargs)
    tokens, (status, page) = await asyncio.gather(sign_in.wait(), asyncio.to_thread(browse, sign_in.url))
    assert status == 200 and "Signed in" in page
    return tokens


def signed_in(cloud) -> Tokens:
    tokens = asyncio.run(sign_in_with_browser())
    auth.save(tokens)
    return tokens


# ---------------------------------------------------------------- settings


def test_api_url_prefers_the_environment_then_config_then_production(monkeypatch):
    assert cloud_settings.api_url() == "https://api.alpinecode.app"
    (home_dir()).mkdir(parents=True, exist_ok=True)
    (home_dir() / "config.toml").write_text('cloud_url = "http://localhost:8787/"\n')
    assert cloud_settings.api_url() == "http://localhost:8787"
    assert Settings.load().model is None  # config.py accepts the key
    monkeypatch.setenv("ALPINE_CLOUD_URL", "http://127.0.0.1:9999")
    assert cloud_settings.api_url() == "http://127.0.0.1:9999"
    assert cloud_settings.gateway_url() == "http://127.0.0.1:9999/v1/gateway"


# ---------------------------------------------------------------- the browser sign-in


def test_browser_sign_in_goes_through_the_loopback_with_state_and_pkce(cloud):
    tokens = asyncio.run(sign_in_with_browser("github"))
    assert tokens.email == "test@alpine.local" and tokens.api_url == cloud.url and tokens.account_id.startswith("acc_")
    [authorize] = cloud.calls("GET", "/v1/auth/authorize")
    query = authorize["query"]
    assert query["provider"] == "github" and query["code_challenge_method"] == "S256"
    assert query["redirect_uri"].startswith("http://127.0.0.1:") and query["redirect_uri"].endswith("/callback")
    assert len(query["state"]) >= 43  # 32 random bytes, base64url
    [exchange] = cloud.calls("POST", "/v1/auth/token")
    assert exchange["body"]["grant_type"] == "authorization_code" and len(exchange["body"]["code_verifier"]) >= 43
    assert exchange["headers"]["Alpine-Client"].startswith("alpine-code/")


def test_a_callback_with_the_wrong_state_is_refused_and_the_sign_in_keeps_waiting(cloud):
    async def scenario():
        sign_in = await BrowserSignIn.start("google")
        stray = f"{sign_in.redirect_uri}?code=x&state=not-ours"
        with pytest.raises(urllib.error.HTTPError) as refused:
            await asyncio.to_thread(browse, stray)
        assert refused.value.code == 404
        tokens, _ = await asyncio.gather(sign_in.wait(), asyncio.to_thread(browse, sign_in.url))
        return tokens

    assert asyncio.run(scenario()).email == "test@alpine.local"


def test_a_sign_in_times_out_and_can_be_cancelled(cloud):
    async def scenario():
        slow = await BrowserSignIn.start("google", timeout=0.2)
        with pytest.raises(SignInError) as timed_out:
            await slow.wait()
        assert timed_out.value.kind is SignInError.Kind.TIMED_OUT

        waiting = await BrowserSignIn.start("google")
        task = asyncio.create_task(waiting.wait())
        await asyncio.sleep(0.05)
        waiting.cancel()
        with pytest.raises(SignInError) as cancelled:
            await task
        assert cancelled.value.kind is SignInError.Kind.CANCELLED

    asyncio.run(scenario())


def test_saying_no_in_the_browser_is_a_cancelled_sign_in(cloud):
    cloud.consent = "deny"

    async def scenario():
        sign_in = await BrowserSignIn.start("google")
        with pytest.raises(SignInError) as e:
            await asyncio.gather(sign_in.wait(), asyncio.to_thread(browse, sign_in.url))
        return e.value.kind

    assert asyncio.run(scenario()) is SignInError.Kind.CANCELLED


# ---------------------------------------------------------------- the email code


def test_email_code_signs_in_and_a_wrong_code_is_invalid(cloud):
    send_code("haneul@example.com", "ko")
    assert cloud.sent_codes == [{"email": "haneul@example.com", "locale": "ko"}]
    with pytest.raises(CloudError) as wrong:
        verify_code("haneul@example.com", "000000")
    assert wrong.value.code == "invalid" and wrong.value.detail["field"] == "code"
    tokens = verify_code("haneul@example.com", "123456")
    assert tokens.email == "haneul@example.com" and tokens.refresh_token.startswith("rt_")


# ---------------------------------------------------------------- tokens, refresh, sign-out


def test_tokens_are_kept_in_auth_json_under_alpine(cloud):
    tokens = signed_in(cloud)
    record = FileSecrets(home_dir() / "auth.json").get_oauth("alpine")
    assert record["api_url"] == cloud.url and record["access_token"] == tokens.access_token
    assert record["account_id"] == tokens.account_id and record["email"] == "test@alpine.local"
    assert oct((home_dir() / "auth.json").stat().st_mode & 0o777) == "0o600"


def test_a_token_with_less_than_two_minutes_left_is_refreshed_and_rotated(cloud):
    cloud.access_ttl = 60  # inside the 120 s margin
    first = signed_in(cloud)
    second = AlpineTokens().access_token()
    assert second != first.access_token and len(cloud.calls("POST", "/v1/auth/token")) == 2
    saved = AlpineTokens().current()
    assert saved.refresh_token != first.refresh_token and saved.email == "test@alpine.local"


def test_a_401_is_answered_by_one_refresh_and_a_retry(cloud):
    signed_in(cloud)
    cloud.revoke_access_tokens()
    body = CloudClient(AlpineTokens()).get("/v1/me")
    assert body["account"]["email"] == "test@alpine.local"
    assert [r["path"] for r in cloud.requests if r["path"] in ("/v1/me", "/v1/auth/token")] == [
        "/v1/auth/token",  # the sign-in
        "/v1/me",  # 401
        "/v1/auth/token",  # refresh
        "/v1/me",
    ]


def test_a_failed_refresh_signs_out_and_announces_it(cloud):
    signed_in(cloud)
    heard = []
    stop = account.subscribe(heard.append)
    cloud.revoke_access_tokens()
    cloud.fail_refresh = True
    with pytest.raises(SignedOut):
        CloudClient(AlpineTokens()).get("/v1/me")
    stop()
    assert AlpineTokens().current() is None and FileSecrets(home_dir() / "auth.json").get_oauth("alpine") is None
    assert [s.signed_in for s in heard] == [False]
    assert account.status().signed_in is False


def test_a_record_made_for_another_api_address_counts_as_signed_out(cloud):
    signed_in(cloud)
    record = FileSecrets(home_dir() / "auth.json").get_oauth("alpine")
    FileSecrets(home_dir() / "auth.json").set_oauth("alpine", {**record, "api_url": "https://api.alpinecode.app"})
    assert AlpineTokens().current() is None
    assert account.status() == account.CloudStatus(False, cloud.url)
    with pytest.raises(SignedOut):
        AlpineTokens().access_token()


def test_sign_out_tells_the_api_and_forgets_the_tokens(cloud):
    signed_in(cloud)
    assert account.sign_out() is True
    [call] = cloud.calls("POST", "/v1/auth/sign-out")
    assert call["body"]["refresh_token"].startswith("rt_")
    assert AlpineTokens().current() is None
    assert account.sign_out() is True  # nothing to do


# ---------------------------------------------------------------- the account


def test_status_is_cached_for_thirty_seconds_and_carries_plan_limits_and_credits(cloud):
    signed_in(cloud)
    first = account.status()
    assert first.signed_in and first.reachable and first.app_domain == "alpinesite.test"
    assert first.account["email"] == "test@alpine.local"
    assert first.plan["id"] == "free" and first.limits["apps"] == 3
    assert first.credits == {"balance": 300, "monthly": 300, "refills_at": "2026-11-01T00:00:00Z"}
    assert account.status() == first and len(cloud.calls("GET", "/v1/me")) == 1
    account.status(refresh=True)
    assert len(cloud.calls("GET", "/v1/me")) == 2


def test_status_of_an_api_that_does_not_answer_is_the_last_known_one_not_a_sign_out(cloud):
    signed_in(cloud)
    known = account.status()
    cloud.stop()
    down = account.status(refresh=True)
    assert down.signed_in and not down.reachable and down.credits == known.credits


def test_credits_seen_updates_the_balance_and_announces_at_most_once_a_second(cloud):
    signed_in(cloud)
    account.status()
    heard = []
    stop = account.subscribe(heard.append)
    account.credits_seen(250)
    account.credits_seen(249)
    stop()
    assert [s.credits["balance"] for s in heard] == [250]
    assert account.snapshot().credits["balance"] == 249


def test_signing_in_adds_the_alpine_connection_and_signing_out_removes_it(cloud):
    heard = []
    stop = account.subscribe(heard.append)
    tokens = asyncio.run(sign_in_with_browser())
    status = complete_sign_in(tokens)
    stop()
    assert status.signed_in and heard[-1].plan["id"] == "free"
    settings = Settings.load()
    assert settings.connections["alpine"].provider.id == "alpine"
    assert settings.connections["alpine"].url == f"{cloud.url}/v1/gateway"
    assert settings.model == "alpine/alpine-coder"
    account.sign_out()
    settings = Settings.load()
    assert "alpine" not in settings.connections and settings.model is None


def test_signing_in_keeps_the_model_the_person_already_chose(cloud):
    (home_dir()).mkdir(parents=True, exist_ok=True)
    (home_dir() / "config.toml").write_text('default_model = "anthropic/claude-sonnet-5"\n')
    complete_sign_in(asyncio.run(sign_in_with_browser()))
    assert Settings.load().model == "anthropic/claude-sonnet-5"
    account.sign_out()
    assert Settings.load().model == "anthropic/claude-sonnet-5"


# ---------------------------------------------------------------- apps and links


def test_create_app_retries_once_with_the_suggestion_of_a_taken_name(cloud):
    from alpine_core.cloud import create_app

    signed_in(cloud)
    cloud.taken_names = {"craft-booking"}
    created = create_app(CloudClient(AlpineTokens()), "craft-booking", "web-lite")
    assert created.name == "craft-booking-2" and created.address == "craft-booking-2.alpinesite.test"
    assert [r["body"]["name"] for r in cloud.calls("POST", "/v1/apps")] == ["craft-booking", "craft-booking-2"]


def test_links_remember_the_app_the_last_publish_and_the_notice_per_project(cloud, tmp_path):
    project = tmp_path / "shop"
    project.mkdir()
    assert links.get(project) is None
    links.link(project, "app_1")
    assert links.get(project).app_id == "app_1" and links.get(project).published is None
    links.record_published(project, links.Published("abc", "def"))
    assert links.get(project).published == links.Published("abc", "def", None)
    assert links.mark_live_read_notice(project) is True and links.mark_live_read_notice(project) is False
    assert links.link(project, "app_1").live_read_notice is True  # linking again keeps what is known
    assert links.link(project, "app_2").published is None  # another app starts over
    shape = json.loads(links.links_file().read_text())
    assert shape["projects"][str(project.resolve())] == {"app_id": "app_2", "api_url": cloud.url}


def test_a_link_made_for_another_api_address_is_not_used(cloud, tmp_path, monkeypatch):
    links.link(tmp_path, "app_1")
    monkeypatch.setenv("ALPINE_CLOUD_URL", "http://127.0.0.1:1")
    assert links.get(tmp_path) is None
