import asyncio
import json
import time
import urllib.parse
from types import SimpleNamespace

import pytest
from alpineagents.types import (
    INVALID_ARGS_KEY,
    Message,
    RawBlock,
    Request,
    TextBlock,
    ToolCall,
    ToolResultBlock,
    ToolSpec,
)

from alpine_core import FileSecrets, Settings, config_file
from alpine_core.chatgpt import (
    Account,
    ChatGPTModel,
    ChatGPTTokens,
    PlanUsageOff,
    SignIn,
    SignInError,
    SignInNeeded,
    UsageLimitError,
    host_id,
    save_account,
)
from alpine_core.chatgpt.model import _Collected
from alpine_core.chatgpt.oauth import PLAN_SCOPE, SCOPES
from alpine_core.models import list_models, make_model

ALL_SCOPES = " ".join(SCOPES)


def token_response(access="at-1", refresh="rt-1", scope=ALL_SCOPES):
    return {"access_token": access, "refresh_token": refresh, "id_token": "idt", "expires_in": 3600, "scope": scope}


def signed_in(client_id="oaiapp_1", subject="user-1", **tokens) -> Account:
    return Account(client_id=client_id, subject=subject, email="a@example.com").with_tokens(token_response(**tokens))


class FakeAuth:
    """The token endpoint and ID-token check, recording what was sent."""

    def __init__(self, status=200, body=None, subject="user-1"):
        self.status, self.body, self.subject = status, body or token_response(), subject
        self.posts: list[tuple[str, dict]] = []
        self.verified: list[tuple[str, str, str]] = []

    def post(self, url, fields):
        self.posts.append((url, fields))
        return self.status, self.body

    def verify(self, id_token, client_id, nonce):
        self.verified.append((id_token, client_id, nonce))
        return {"sub": self.subject, "email": "a@example.com"}


async def browser_returns(sign_in: SignIn, **query) -> int:
    """What the browser does at the end of signing in: GET the callback with ``query``. Returns the status."""
    target = urllib.parse.urlparse(sign_in.redirect_uri)
    reader, writer = await asyncio.open_connection(target.hostname, target.port)
    writer.write(f"GET {target.path}?{urllib.parse.urlencode(query)} HTTP/1.1\r\nHost: x\r\n\r\n".encode())
    await writer.drain()
    status = int((await reader.readline()).split()[1])
    writer.close()
    return status


def params(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(url).query).items()}


# ---------------------------------------------------------------- signing in


def test_first_sign_in_registers_and_exchanges(home):
    auth = FakeAuth()

    async def run():
        sign_in = await SignIn.start(host_id(home), port=0, post=auth.post, verify=auth.verify)
        sent = params(sign_in.url)
        assert await browser_returns(sign_in, code="c1", state=sent["state"], client_id="oaiapp_1") == 200
        return sent, await sign_in.wait()

    sent, account = asyncio.run(run())
    assert sent["client_id"] == "dynamic_agent_client" and sent["agent_name_hint"] == "alpine-code"
    assert sent["ext_agent_host_id"].startswith("urn:uuid:") and sent["ext_agent_host_id"] == host_id(home)
    assert sent["scope"] == ALL_SCOPES and sent["resource"] == "https://api.openai.com/v1"
    assert sent["code_challenge_method"] == "S256" and sent["redirect_uri"].startswith("http://127.0.0.1:")
    url, fields = auth.posts[0]
    assert (
        fields["client_id"] == "oaiapp_1" and fields["code"] == "c1" and fields["redirect_uri"] == sent["redirect_uri"]
    )
    assert auth.verified[0][1:] == ("oaiapp_1", sent["nonce"])
    assert (account.client_id, account.subject, account.email) == ("oaiapp_1", "user-1", "a@example.com")
    assert account.signed_in and account.plan_usage


def test_sign_in_ignores_other_requests_until_its_own_callback(home):
    auth = FakeAuth()

    async def run():
        sign_in = await SignIn.start("urn:uuid:h", port=0, post=auth.post, verify=auth.verify)
        state = params(sign_in.url)["state"]
        assert await browser_returns(sign_in, code="old", state="someone-else", client_id="oaiapp_1") == 404
        await browser_returns(sign_in, code="c2", state=state, client_id="oaiapp_1")
        return await sign_in.wait()

    asyncio.run(run())
    assert auth.posts[0][1]["code"] == "c2"


def test_declined_and_cancelled_sign_ins(home):
    async def declined():
        sign_in = await SignIn.start("urn:uuid:h", port=0, post=FakeAuth().post, verify=FakeAuth().verify)
        await browser_returns(sign_in, error="access_denied", state=params(sign_in.url)["state"])
        await sign_in.wait()

    with pytest.raises(SignInError) as e:
        asyncio.run(declined())
    assert e.value.kind is SignInError.Kind.DECLINED

    async def cancelled():
        sign_in = await SignIn.start("urn:uuid:h", port=0, post=FakeAuth().post, verify=FakeAuth().verify)
        waiting = asyncio.ensure_future(sign_in.wait())
        await asyncio.sleep(0)
        sign_in.cancel()
        await waiting

    with pytest.raises(SignInError) as e:
        asyncio.run(cancelled())
    assert e.value.kind is SignInError.Kind.CANCELLED


def test_signing_in_again_reuses_the_registration(home):
    previous = signed_in()
    auth = FakeAuth()

    async def run(subject_seen):
        auth.subject = subject_seen
        sign_in = await SignIn.start("urn:uuid:h", previous=previous, port=0, post=auth.post, verify=auth.verify)
        sent = params(sign_in.url)
        await browser_returns(sign_in, code="c", state=sent["state"])  # a reauthorization may omit client_id
        return sent, await sign_in.wait()

    sent, account = asyncio.run(run("user-1"))
    assert sent["client_id"] == "oaiapp_1" and "agent_name_hint" not in sent
    assert sent["id_token_hint"] == "idt" and sent["login_hint"] == "a@example.com"
    assert auth.posts[-1][1]["client_id"] == "oaiapp_1" and account.signed_in
    with pytest.raises(SignInError, match="different ChatGPT account"):
        asyncio.run(run("someone-else"))


def test_a_sign_in_without_plan_permission_is_kept_but_marked(home):
    auth = FakeAuth(body=token_response(scope="openid profile email offline_access"))

    async def run():
        sign_in = await SignIn.start("urn:uuid:h", port=0, post=auth.post, verify=auth.verify)
        await browser_returns(sign_in, code="c", state=params(sign_in.url)["state"], client_id="oaiapp_1")
        return await sign_in.wait()

    account = asyncio.run(run())
    assert account.signed_in and not account.plan_usage
    store = FileSecrets(home / "auth.json")
    store.set_oauth("chatgpt", account.to_record())
    with pytest.raises(PlanUsageOff):
        ChatGPTTokens(store, "chatgpt").access_token()


# ---------------------------------------------------------------- tokens


def test_refresh_is_due_before_expiry_but_not_before_openai_allows_it():
    account = signed_in()
    now = time.time()
    assert not account.needs_refresh(now)
    assert account.needs_refresh(account.expires_at - 60)
    early = Account.from_record({**account.to_record(), "earliest_refresh_at": account.expires_at - 30})
    assert not early.needs_refresh(early.expires_at - 60) and early.needs_refresh(early.expires_at + 1)
    assert Account.from_record(json.loads(json.dumps(account.to_record()))) == account


def test_tokens_refresh_rotate_and_save(home):
    store = FileSecrets(home / "auth.json")
    stale = Account.from_record({**signed_in().to_record(), "expires_at": time.time() - 1})
    store.set_oauth("chatgpt", stale.to_record())
    auth = FakeAuth(body=token_response(access="at-2", refresh="rt-2"))
    tokens = ChatGPTTokens(store, "chatgpt", post=auth.post)
    assert tokens.access_token() == "at-2"
    fields = auth.posts[0][1]
    assert (
        fields["grant_type"] == "refresh_token"
        and fields["client_id"] == "oaiapp_1"
        and fields["refresh_token"] == "rt-1"
    )
    assert tokens.account().refresh_token == "rt-2"
    assert tokens.access_token() == "at-2" and len(auth.posts) == 1  # fresh now: no second refresh
    # After a 401, a token another process already replaced is used as is.
    assert tokens.refresh_after_rejection("at-1") == "at-2" and len(auth.posts) == 1


def test_a_dead_refresh_token_signs_the_connection_out(home):
    store = FileSecrets(home / "auth.json")
    store.set_oauth("chatgpt", Account.from_record({**signed_in().to_record(), "expires_at": 0}).to_record())
    tokens = ChatGPTTokens(store, "chatgpt", post=FakeAuth(400, {"error": "refresh_token_reused"}).post)
    with pytest.raises(SignInNeeded, match="Sign in again"):
        tokens.access_token()
    kept = tokens.account()
    assert not kept.signed_in and kept.client_id == "oaiapp_1" and kept.id_token == "idt"
    with pytest.raises(SignInNeeded):
        ChatGPTTokens(store, "other").access_token()


def test_a_temporary_refresh_failure_keeps_the_tokens(home):
    store = FileSecrets(home / "auth.json")
    store.set_oauth("chatgpt", Account.from_record({**signed_in().to_record(), "expires_at": 0}).to_record())
    tokens = ChatGPTTokens(store, "chatgpt", post=FakeAuth(503, {"detail": "busy"}).post)
    with pytest.raises(Exception, match="503") as e:
        tokens.access_token()
    assert not isinstance(e.value, SignInNeeded) and tokens.account().signed_in


# ---------------------------------------------------------------- connections


def test_accounts_become_connections(home):
    store = FileSecrets(home / "auth.json")
    assert save_account(signed_in(), store, Settings.load().connections) == "chatgpt"
    assert save_account(signed_in(client_id="oaiapp_2"), store, Settings.load().connections) == "chatgpt-2"
    renewed = signed_in(access="at-9")
    assert save_account(renewed, store, Settings.load().connections) == "chatgpt"
    assert store.get_oauth("chatgpt")["access_token"] == "at-9"
    assert '[connections.chatgpt-2]\nprovider = "chatgpt"' in config_file().read_text()
    settings = Settings.load(model="chatgpt-2/gpt-5.5")
    model = make_model(settings)
    assert isinstance(model, ChatGPTModel) and model.name == "gpt-5.5" and model.tokens.name == "chatgpt-2"
    with pytest.raises(Exception, match="needs its ChatGPT sign-in"):
        list_models(settings.connections["chatgpt"], None)


# ---------------------------------------------------------------- the model


def ev(type, **fields):
    return SimpleNamespace(type=type, **fields)


def item(**data):
    return SimpleNamespace(model_dump=lambda exclude_none=True: data)


def completed(**usage):
    return ev("response.completed", response=SimpleNamespace(model="gpt-5.5", usage=item(**usage)))


def test_request_body_follows_the_plan_route():
    model = ChatGPTModel("gpt-5.5", tokens=None, reasoning_effort="low")
    reasoning = {"type": "reasoning", "summary": [], "encrypted_content": "enc"}
    request = Request(
        system="Be brief.",
        messages=(
            Message.user("read it"),
            Message(
                "assistant",
                (
                    RawBlock("chatgpt", reasoning),
                    RawBlock("anthropic", {"x": 1}),
                    TextBlock("Reading."),
                    ToolCall("read", {"path": "a"}, "call_1"),
                ),
            ),
            Message("user", (ToolResultBlock("call_1", "no such file", "read", is_error=True),)),
        ),
        tools=(ToolSpec("read", "Reads a file", {"type": "object", "properties": {}}),),
    )
    body = model._request_body(request)
    assert body["store"] is False and body["stream"] is True and body["instructions"] == "Be brief."
    assert body["include"] == ["reasoning.encrypted_content"] and body["reasoning"] == {"effort": "low"}
    assert "temperature" not in body and "max_output_tokens" not in body
    assert body["tools"] == [
        {
            "type": "function",
            "name": "read",
            "description": "Reads a file",
            "parameters": {"type": "object", "properties": {}},
        }
    ]
    assert body["input"] == [
        {"role": "user", "content": "read it"},
        reasoning,
        {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "Reading."}]},
        {"type": "function_call", "call_id": "call_1", "name": "read", "arguments": '{"path": "a"}'},
        {"type": "function_call_output", "call_id": "call_1", "output": "Error: no such file"},
    ]


def test_reply_is_built_from_output_item_events():
    model = ChatGPTModel("gpt-5.5", tokens=None)
    texts: list[str] = []
    collected = _Collected(texts.append)
    for event in [
        ev("response.output_item.done", item=item(type="reasoning", id="rs_1", summary=[], encrypted_content="enc")),
        ev("response.output_text.delta", delta="Hi"),
        ev(
            "response.output_item.done",
            item=item(type="message", id="msg_1", status="completed", content=[{"type": "output_text", "text": "Hi"}]),
        ),
        ev(
            "response.output_item.done",
            item=item(type="function_call", call_id="c1", name="read", arguments='{"path":"a"}'),
        ),
        ev("response.output_item.done", item=item(type="function_call", call_id="c2", name="read", arguments="{bad")),
        completed(
            input_tokens=100, output_tokens=7, input_tokens_details={"cached_tokens": 60, "cache_write_tokens": 10}
        ),
    ]:
        collected.add(event)
    reply = model._to_reply(collected)
    reasoning, text, call, bad = reply.message.content
    assert reasoning == RawBlock("chatgpt", {"type": "reasoning", "summary": [], "encrypted_content": "enc"})
    assert text == TextBlock("Hi") and texts == ["Hi"]
    assert call == ToolCall("read", {"path": "a"}, "c1") and INVALID_ARGS_KEY in bad.args
    u = reply.usage
    assert (u.input_tokens, u.cache_read_tokens, u.cache_write_tokens, u.output_tokens) == (30, 60, 10, 7)
    assert reply.context_tokens == 107 and reply.model == "gpt-5.5"


class FakeStream:
    def __init__(self, events):
        self.events = events

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(self.events)


class FakeTokens:
    def __init__(self):
        self.refreshed = []

    def access_token(self):
        return "at-2" if self.refreshed else "at-1"

    def refresh_after_rejection(self, token):
        self.refreshed.append(token)
        return "at-2"


def fake_openai(monkeypatch, outcomes):
    """``openai.OpenAI`` whose ``responses.create`` returns (or raises) ``outcomes`` in order."""
    import openai

    calls = []

    def create(**body):
        calls.append(body)
        outcome = outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return FakeStream(outcome)

    class Client:
        def __init__(self, api_key, **_):
            calls.append(api_key)
            self.responses = SimpleNamespace(create=create)

    monkeypatch.setattr(openai, "OpenAI", Client)
    return calls


def status_error(status, body):
    import httpx2 as httpx
    import openai

    response = httpx.Response(status, request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
    return openai.APIStatusError("boom", response=response, body=body)


def test_respond_refreshes_once_after_a_401_and_stops_on_a_used_up_plan(monkeypatch):
    model = ChatGPTModel("gpt-5.5", tokens=FakeTokens(), context_window=1000)
    ok = [
        ev("response.output_item.done", item=item(type="message", content=[{"type": "output_text", "text": "ok"}])),
        completed(input_tokens=1, output_tokens=1),
    ]
    calls = fake_openai(monkeypatch, [status_error(401, {"detail": "no"}), ok])
    reply = model.respond(Request(system=None, messages=(Message.user("hi"),)))
    assert reply.text == "ok" and model.tokens.refreshed == ["at-1"]
    assert [c for c in calls if isinstance(c, str)] == ["at-1", "at-2"]

    limit = {"error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "limit"}}
    fake_openai(monkeypatch, [status_error(429, limit)])
    with pytest.raises(UsageLimitError, match="ChatGPT settings"):
        model.respond(Request(system=None, messages=(Message.user("hi"),)))

    failed = ev(
        "response.failed",
        response=SimpleNamespace(
            error=SimpleNamespace(code="subscription_sharing_usage_limit_exceeded", message="limit")
        ),
    )
    fake_openai(monkeypatch, [[failed]])
    with pytest.raises(UsageLimitError):
        model.respond(Request(system=None, messages=(Message.user("hi"),)))


def test_plan_scope_is_what_allows_plan_usage():
    assert PLAN_SCOPE == "chatgpt.tokens.use.direct" and PLAN_SCOPE in SCOPES


def test_a_used_up_plan_or_an_ended_sign_in_stops_the_run_with_its_own_reason():
    from alpine_core.session import _failed

    assert _failed(UsageLimitError("used up", "subscription_sharing_usage_limit_exceeded")).reason == "plan_limit"
    assert _failed(SignInNeeded("ended")).reason == "signed_out"
    assert _failed(PlanUsageOff("off")).reason == "signed_out"
    other = _failed(RuntimeError("boom"))
    assert other.reason == "failed" and other.message == "RuntimeError: boom"
