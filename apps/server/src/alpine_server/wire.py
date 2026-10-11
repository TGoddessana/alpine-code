"""Core objects to protocol models. The core speaks dataclasses and snake_case dicts, the wire speaks the models."""

from __future__ import annotations

from typing import Any

from pydantic import TypeAdapter

from alpine_core import InfoChanged, Item, ItemEvent, event_to_dict, item_to_dict
from alpine_core import SessionInfo as CoreInfo
from alpine_protocol import SessionEvent, SessionEventParams, SessionInfo

_EVENT = TypeAdapter(SessionEvent)
_CORE_ONLY = {"last_seq", "agent_applied"}


def to_info(info: CoreInfo | dict[str, Any]) -> SessionInfo:
    """A session's info, without the core's ``last_seq`` and ``agent_applied``."""
    data = info if isinstance(info, dict) else info.to_dict()
    return SessionInfo.model_validate({key: value for key, value in data.items() if key not in _CORE_ONLY})


def to_item(item: Item) -> Any:
    """The protocol model of an item, validated through its ``kind``."""
    return _EVENT.validate_python({"type": "item_completed", "item": item_to_dict(item)}).item


def to_event_params(session_id: str, seq: int, event: ItemEvent) -> SessionEventParams:
    if isinstance(event, InfoChanged):
        data: dict[str, Any] = {"type": "info_changed", "info": to_info(event.info)}
    else:
        data = event_to_dict(event)
        if "item" in data:
            data["item"] = item_to_dict(event.item)
    return SessionEventParams.model_validate({"session_id": session_id, "seq": seq, "event": data})
