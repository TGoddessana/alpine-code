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
        "agent": None,
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
    assert schema["x-notifications"] == {
        "session/event": "SessionEventParams",
        "chatgpt/signInFinished": "ChatGPTSignInFinishedParams",
        "memory/changed": "MemoryChangedParams",
    }
    assert (SESSION_NOT_FOUND, SESSION_RUNNING) == (-32001, -32002)


def test_agent_items_are_picked_by_kind_and_serialise_camel_case():
    from pydantic import TypeAdapter

    from alpine_protocol import AgentChangedItem, AgentSwitchedItem, Item

    adapter = TypeAdapter(Item)
    switched = adapter.validate_python(
        {"id": "i1", "kind": "agent_switched", "agent": "a1", "name": "Writer", "look": "beret", "color": 4}
    )
    assert isinstance(switched, AgentSwitchedItem)
    changed = adapter.validate_python(
        {
            "id": "i2", "kind": "agent_changed", "agent": "a1", "name": "Writer", "look": "beret", "color": 4,
            "added": ["bash"], "removed": [], "instructions": True, "model": None,
        }
    )  # fmt: skip
    assert isinstance(changed, AgentChangedItem)
    dumped = changed.model_dump(by_alias=True, mode="json")
    assert dumped["added"] == ["bash"] and dumped["instructions"] is True and dumped["kind"] == "agent_changed"


def test_agent_info_rejects_a_colour_or_look_outside_the_set():
    import pytest
    from pydantic import ValidationError

    from alpine_protocol import AgentInfo

    base = {
        "id": "", "name": "n", "description": "", "model": None, "instructions": "", "tools": [],
        "look": "antenna", "color": 2,
    }  # fmt: skip
    assert AgentInfo.model_validate(base).color == 2
    with pytest.raises(ValidationError):
        AgentInfo.model_validate({**base, "color": 9})
    with pytest.raises(ValidationError):
        AgentInfo.model_validate({**base, "look": "crown"})
