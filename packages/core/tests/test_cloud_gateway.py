"""A session on the ``alpine`` connection, against the fake gateway."""

import pytest
from alpineagents.types import Message, Request

from alpine_core import Failed, RunFinished, Session, Settings, TextDelta
from alpine_core.cloud import AlpineModel, CreditsExhausted, account, complete_sign_in, verify_code
from alpine_core.models import ModelListError, list_models, make_model


@pytest.fixture
def signed_in(cloud):
    complete_sign_in(verify_code("haneul@example.com", "123456"))
    return cloud


class Approver:
    def approve(self, request):
        raise AssertionError("nothing here asks")


def run(tmp_path, text="hi"):
    events = []
    session = Session(Settings.load(), on_event=events.append, approver=Approver(), cwd=tmp_path)
    return session.send(text), events


def test_a_session_on_alpine_streams_from_the_gateway(signed_in, tmp_path):
    assert isinstance(make_model(Settings.load()), AlpineModel)
    answer, events = run(tmp_path, "hello gateway")
    assert answer == "Hello from Alpine"
    assert "".join(e.text for e in events if isinstance(e, TextDelta)) == "Hello from Alpine"
    assert isinstance(events[-1], RunFinished)

    [request] = signed_in.gateway_requests
    token = request["headers"]["Authorization"].removeprefix("Bearer ")
    assert token.startswith("at_") and request["headers"]["Alpine-Session"]
    assert request["body"]["model"] == "alpine-coder" and request["body"]["stream"] is True
    assert request["body"]["stream_options"] == {"include_usage": True}
    assert request["headers"]["Alpine-Client"].startswith("alpine-code/")


def test_every_request_of_one_conversation_carries_the_same_session_header(signed_in, tmp_path):
    model = make_model(Settings.load())
    ask = Request(messages=[Message.user("a")], system="s")
    model.respond(ask)
    model.respond(ask)
    first, second = signed_in.gateway_requests
    assert first["headers"]["Alpine-Session"] == second["headers"]["Alpine-Session"] == model.session_id
    assert make_model(Settings.load()).session_id != model.session_id


def test_the_credits_left_come_with_each_answer(signed_in, tmp_path):
    account.status(refresh=True)
    heard = []
    stop = account.subscribe(heard.append)
    run(tmp_path)
    stop()
    assert signed_in.credits == 299
    assert account.snapshot().credits["balance"] == 299
    assert [s.credits["balance"] for s in heard] == [299]


def test_no_credits_left_fails_the_run_with_the_refill_date(signed_in, tmp_path):
    signed_in.credits = 0
    answer, events = run(tmp_path)
    failed = events[-1]
    assert answer is None and isinstance(failed, Failed) and failed.reason == "credits_exhausted"
    assert "2026-11-01T00:00:00Z" in failed.message


def test_the_model_raises_a_typed_error_for_402(signed_in):
    signed_in.credits = 0
    with pytest.raises(CreditsExhausted) as e:
        make_model(Settings.load()).respond(Request(messages=[Message.user("a")], system="s"))
    assert e.value.refills_at == "2026-11-01T00:00:00Z"


def test_signed_out_fails_the_run_as_signed_out(signed_in, tmp_path):
    account.sign_out()
    (tmp_path / "config.toml").write_text('default_model = "alpine/alpine-coder"\n')
    # The connection is gone with the sign-in, so the model name has no connection to run on: bring it back signed out.
    from alpine_core import save_connection, set_default_model

    save_connection("alpine", provider="alpine")
    set_default_model("alpine/alpine-coder")
    answer, events = run(tmp_path)
    assert answer is None and isinstance(events[-1], Failed) and events[-1].reason == "signed_out"
    assert signed_in.gateway_requests == []


def test_a_rejected_token_is_refreshed_once_and_the_request_goes_again(signed_in, tmp_path):
    signed_in.revoke_access_tokens()
    answer, _ = run(tmp_path)
    assert answer == "Hello from Alpine"
    assert len(signed_in.gateway_requests) == 1  # the 401 never reached the gateway's record
    assert [r["body"]["grant_type"] for r in signed_in.calls("POST", "/v1/auth/token")] == ["refresh_token"]


def test_a_dead_refresh_token_signs_out_instead_of_looping(signed_in, tmp_path):
    signed_in.revoke_access_tokens()
    signed_in.fail_refresh = True
    answer, events = run(tmp_path)
    assert answer is None and events[-1].reason == "signed_out"


def test_the_gateway_lists_its_models_and_the_window_is_kept(signed_in):
    connection = Settings.load().connections["alpine"]
    assert list_models(connection, None) == ["alpine-coder"]
    from alpine_core.context import reported_window

    assert reported_window("alpine", "alpine-coder") == 200000


def test_listing_models_signed_out_is_an_auth_problem(cloud):
    from alpine_core import save_connection

    connection = save_connection("alpine", provider="alpine")
    with pytest.raises(ModelListError) as e:
        list_models(connection, None)
    assert e.value.kind is ModelListError.Kind.AUTH
