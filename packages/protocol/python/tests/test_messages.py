from alpine_protocol import InitializeParams, InitializeResult, ServerInfo
from alpine_protocol.schema import build


def test_wire_names_are_camel_case():
    params = InitializeParams.model_validate({"protocolVersion": 1, "clientName": "desktop"})
    assert params.protocol_version == 1
    result = InitializeResult(protocol_version=1, server=ServerInfo(name="alpine-code-server", version="0.1.0"))
    assert result.model_dump(by_alias=True) == {
        "protocolVersion": 1,
        "server": {"name": "alpine-code-server", "version": "0.1.0"},
    }


def test_schema_lists_every_message():
    assert {"Request", "Response", "InitializeParams", "InitializeResult"} <= set(build()["$defs"])


def test_items_and_events_round_trip_by_kind_and_type():
    from alpine_protocol import METHODS, NOTIFICATIONS, SessionEventParams, SessionOpenResult

    info = {
        "id": "s1", "title": "hi", "cwd": "/w", "model": "m", "mode": "default", "status": "idle",
        "createdAt": "2026-09-30T00:00:00Z", "updatedAt": "2026-09-30T00:00:00Z",
        "usage": {
            "inputTokens": 1, "outputTokens": 2, "cacheReadTokens": 0, "cacheWriteTokens": 0,
            "requests": 1, "cost": None,
        },
        "contextUsed": 3, "contextWindow": None, "activity": None, "runStartedAt": None, "runUsage": None,
    }  # fmt: skip
    call = {"id": "c1", "kind": "tool_call", "name": "bash", "args": {"command": "ls"}, "status": "running"}
    snap = SessionOpenResult.model_validate(
        {"info": info, "seq": 4, "items": [{"id": "u", "kind": "user_message", "text": "x"}], "active": [call]}
    )
    assert snap.active[0].kind == "tool_call" and snap.active[0].images == 0
    dumped = snap.model_dump(by_alias=True, mode="json")
    assert dumped["active"][0]["result"] is None and dumped["items"][0]["kind"] == "user_message"

    event = SessionEventParams.model_validate(
        {"sessionId": "s1", "seq": 5, "event": {"type": "item_delta", "itemId": "a", "text": "he"}}
    )
    assert event.event.type == "item_delta" and event.event.item_id == "a"
    assert NOTIFICATIONS["session/event"] is SessionEventParams
    assert {"session/new", "session/open", "session/answer", "session/setMode"} <= set(METHODS)


def test_schema_has_session_types_and_notifications():
    from alpine_protocol import SESSION_NOT_FOUND, SESSION_RUNNING

    schema = build()
    assert {"SessionInfo", "ToolCallItem", "ItemDeltaEvent", "SessionEventParams"} <= set(schema["$defs"])
    assert schema["x-notifications"] == {"session/event": "SessionEventParams"}
    assert (SESSION_NOT_FOUND, SESSION_RUNNING) == (-32001, -32002)
