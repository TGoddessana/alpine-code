"""The conversation as items, and the item events a frontend or the server sends.

A conversation is a list of items (see ``docs/session-protocol.md``). ``ItemRecorder`` turns the core's ``Event``
objects, plus explicit calls for user messages and approvals, into item events; it numbers them with a per-session
``seq`` that only grows and keeps the finished and the active items so a snapshot can be built at any moment.
Items and item events are frozen dataclasses; ``item_to_dict`` and friends turn them into plain JSON data with
snake_case keys, which is what ``SessionLog`` stores.
"""

from __future__ import annotations

import dataclasses
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any, ClassVar, Literal

from .events import (
    AssistantDone,
    ContextCompacted,
    Event,
    Failed,
    Interrupted,
    Notice,
    RunFinished,
    TextDelta,
    ToolFinished,
    ToolResultKind,
    ToolStarted,
    TurnStarted,
)

ToolCallStatus = Literal["running", "done", "error", "input_error", "aborted", "interrupted", "denied", "cancelled"]
RunStopReason = Literal["interrupted", "failed", "limit", "repeating", "permission", "plan_limit", "signed_out"]
ApprovalDecision = Literal["allow", "allow_always", "deny"]
PreviewKind = Literal["diff", "command", "text"]


# ----------------------------------------------------------------------------------------------------- items


@dataclass(frozen=True)
class UserMessage:
    id: str
    text: str
    kind: ClassVar[str] = "user_message"


@dataclass(frozen=True)
class AgentMessage:
    id: str
    text: str
    kind: ClassVar[str] = "agent_message"


@dataclass(frozen=True)
class ToolCallItem:
    """``id`` is the model's call id."""

    id: str
    name: str
    args: dict[str, Any] = field(default_factory=dict)
    status: ToolCallStatus = "running"
    result: str | None = None
    images: int = 0
    kind: ClassVar[str] = "tool_call"


@dataclass(frozen=True)
class ApprovalItem:
    """Active while the app asks (``decision`` is ``None``); finished with the user's decision. ``id`` is the
    request id the app answers with. ``tool`` and ``args`` are the call's, so the app can draw it like the call it
    will become (empty in sessions saved before they were added)."""

    id: str
    call_id: str
    title: str
    preview: str | None = None
    preview_kind: PreviewKind = "text"
    reason: str | None = None
    remember: str | None = None
    decision: ApprovalDecision | None = None
    feedback: str | None = None
    tool: str = ""
    args: dict[str, Any] = field(default_factory=dict)
    kind: ClassVar[str] = "approval"


@dataclass(frozen=True)
class NoticeItem:
    """A message the model reads that the user did not write."""

    id: str
    text: str
    source: str
    kind: ClassVar[str] = "notice"


@dataclass(frozen=True)
class StatusLine:
    """A line only the user reads."""

    id: str
    text: str
    kind: ClassVar[str] = "status_line"


@dataclass(frozen=True)
class MemoryReview:
    """Something the harness noticed about the project's memory during the run, waiting on the memory page. Only
    the user reads it; the model never hears of it."""

    id: str
    source: str
    """The proposer that noticed, which says what it was: ``missing_paths`` (a memory names a path that is gone)."""
    count: int
    """How many suggestions it made."""
    kind: ClassVar[str] = "memory_review"


@dataclass(frozen=True)
class Compaction:
    id: str
    before_tokens: int
    after_tokens: int
    kind: ClassVar[str] = "compaction"


@dataclass(frozen=True)
class RunStopped:
    """Why a run ended other than by answering."""

    id: str
    reason: RunStopReason
    message: str | None = None
    kind: ClassVar[str] = "run_stopped"


Item = (
    UserMessage
    | AgentMessage
    | ToolCallItem
    | ApprovalItem
    | NoticeItem
    | StatusLine
    | MemoryReview
    | Compaction
    | RunStopped
)

ITEM_KINDS: dict[str, type] = {
    cls.kind: cls
    for cls in (
        UserMessage,
        AgentMessage,
        ToolCallItem,
        ApprovalItem,
        NoticeItem,
        StatusLine,
        MemoryReview,
        Compaction,
        RunStopped,
    )
}


# ------------------------------------------------------------------------------------------------ item events


@dataclass(frozen=True)
class InfoChanged:
    """The session's info changed (also announces a new session). ``info`` is the session's info object, a frozen
    dataclass or a dict; this module does not look inside it."""

    info: Any
    type: ClassVar[str] = "info_changed"


@dataclass(frozen=True)
class Deleted:
    type: ClassVar[str] = "deleted"


@dataclass(frozen=True)
class ItemStarted:
    item: Item
    type: ClassVar[str] = "item_started"


@dataclass(frozen=True)
class ItemDelta:
    item_id: str
    text: str
    type: ClassVar[str] = "item_delta"


@dataclass(frozen=True)
class ItemCompleted:
    """The whole item; replaces what the deltas built."""

    item: Item
    type: ClassVar[str] = "item_completed"


@dataclass(frozen=True)
class ItemDiscarded:
    item_id: str
    type: ClassVar[str] = "item_discarded"


ItemEvent = InfoChanged | Deleted | ItemStarted | ItemDelta | ItemCompleted | ItemDiscarded

EVENT_TYPES: dict[str, type] = {
    cls.type: cls for cls in (InfoChanged, Deleted, ItemStarted, ItemDelta, ItemCompleted, ItemDiscarded)
}


# ------------------------------------------------------------------------------------------------------ JSON


def item_to_dict(item: Item) -> dict[str, Any]:
    """Plain JSON data with snake_case keys; ``kind`` comes first."""
    data = {"kind": item.kind}
    data.update({f.name: getattr(item, f.name) for f in dataclasses.fields(item)})
    if isinstance(item, ToolCallItem | ApprovalItem):
        data["args"] = dict(item.args)
    return data


def item_from_dict(data: dict[str, Any]) -> Item:
    """Inverse of ``item_to_dict``. Raises ``ValueError`` on an unknown kind or missing/unknown fields."""
    kind = data.get("kind")
    cls = ITEM_KINDS.get(kind) if isinstance(kind, str) else None
    if cls is None:
        raise ValueError(f"unknown item kind: {kind!r}")
    names = {f.name for f in dataclasses.fields(cls)}
    fields = {k: v for k, v in data.items() if k != "kind"}
    unknown = set(fields) - names
    if unknown:
        raise ValueError(f"unknown fields for {kind}: {sorted(unknown)}")
    try:
        return cls(**fields)
    except TypeError as e:
        raise ValueError(f"bad {kind} item: {e}") from e


def info_to_data(info: Any) -> Any:
    """``info`` as plain data: a dataclass becomes a dict, a dict is copied, anything else is returned as is."""
    if dataclasses.is_dataclass(info) and not isinstance(info, type):
        return dataclasses.asdict(info)
    if isinstance(info, dict):
        return dict(info)
    return info


def event_to_dict(event: ItemEvent) -> dict[str, Any]:
    """Plain JSON data with snake_case keys and a ``type`` key."""
    data: dict[str, Any] = {"type": event.type}
    match event:
        case InfoChanged(info):
            data["info"] = info_to_data(info)
        case ItemStarted(item) | ItemCompleted(item):
            data["item"] = item_to_dict(item)
        case ItemDelta(item_id, text):
            data["item_id"] = item_id
            data["text"] = text
        case ItemDiscarded(item_id):
            data["item_id"] = item_id
    return data


def event_from_dict(data: dict[str, Any]) -> ItemEvent:
    """Inverse of ``event_to_dict``; ``info`` stays plain data."""
    kind = data.get("type")
    try:
        match kind:
            case "info_changed":
                return InfoChanged(data["info"])
            case "deleted":
                return Deleted()
            case "item_started":
                return ItemStarted(item_from_dict(data["item"]))
            case "item_completed":
                return ItemCompleted(item_from_dict(data["item"]))
            case "item_delta":
                return ItemDelta(data["item_id"], data["text"])
            case "item_discarded":
                return ItemDiscarded(data["item_id"])
    except KeyError as e:
        raise ValueError(f"event {kind!r} lacks {e}") from e
    raise ValueError(f"unknown event type: {kind!r}")


# -------------------------------------------------------------------------------------------------- recorder


def new_id() -> str:
    return uuid.uuid4().hex


class ItemRecorder:
    """Builds items from core events and emits item events.

    ``emit(seq, event)`` is called for every item event, in order, with the next ``seq`` (starting after ``seq``:
    pass the last stored seq when resuming). It is not thread safe; call it from one thread or loop.

    Every item is announced with ``ItemStarted`` and closed with ``ItemCompleted`` (or ``ItemDiscarded``), including
    ones that are born finished (a user message, a compaction divider, a call denied before it started).
    ``items`` are the finished ones in order; ``active`` are the unfinished ones (a streaming reply with the text so
    far, running tool calls, an active approval), so a snapshot is ``(seq, items, active)``.
    """

    def __init__(
        self,
        emit: Callable[[int, ItemEvent], None],
        *,
        seq: int = 0,
        items: Iterable[Item] = (),
        id_factory: Callable[[], str] = new_id,
    ) -> None:
        self._emit = emit
        self._seq = seq
        self._new_id = id_factory
        self._items: list[Item] = list(items)
        self._active: dict[str, Item] = {}
        self._text: dict[str, list[str]] = {}  # streamed text of active agent messages
        self._pending = ""  # leading whitespace of a reply that has not shown any text yet
        self._message_id: str | None = None  # the active agent message
        self._stop_asked = False  # the user declined a call and asked to stop the run

    # ------------------------------------------------------------------ state

    @property
    def seq(self) -> int:
        """The ``seq`` of the last event emitted."""
        return self._seq

    @property
    def items(self) -> tuple[Item, ...]:
        return tuple(self._items)

    @property
    def active(self) -> tuple[Item, ...]:
        """Unfinished items in the order they started; a streaming reply carries the text so far."""
        out: list[Item] = []
        for item_id, item in self._active.items():
            if isinstance(item, AgentMessage):
                item = dataclasses.replace(item, text="".join(self._text[item_id]))
            out.append(item)
        return tuple(out)

    @property
    def has_active_approval(self) -> bool:
        return any(isinstance(item, ApprovalItem) for item in self._active.values())

    # ------------------------------------------------------------------ session-level events

    def info_changed(self, info: Any) -> None:
        self._send(InfoChanged(info))

    def deleted(self) -> None:
        self._send(Deleted())

    # ------------------------------------------------------------------ explicit calls

    def add_user_message(self, text: str) -> UserMessage:
        self._stop_asked = False
        return self._born_finished(UserMessage(self._new_id(), text))

    def add_notice(self, text: str, source: str) -> NoticeItem:
        """A message the model reads that the user did not write."""
        return self._born_finished(NoticeItem(self._new_id(), text, source))

    def add_memory_review(self, source: str, count: int) -> MemoryReview:
        """Suggestions about the memory that the harness made during the run."""
        return self._born_finished(MemoryReview(self._new_id(), source, count))

    def start_approval(
        self,
        call_id: str,
        title: str,
        preview: str | None = None,
        preview_kind: PreviewKind = "text",
        reason: str | None = None,
        remember: str | None = None,
        *,
        tool: str = "",
        args: dict[str, Any] | None = None,
    ) -> ApprovalItem:
        """The core asks; the item's ``id`` is the request id."""
        item = ApprovalItem(
            self._new_id(), call_id, title, preview, preview_kind, reason, remember, tool=tool, args=dict(args or {})
        )
        self._start(item)
        return item

    def finish_approval(
        self,
        item_id: str,
        decision: ApprovalDecision,
        feedback: str | None = None,
        *,
        stop: bool = False,
        cancelled: bool = False,
    ) -> ApprovalItem | None:
        """Completes an active approval with the user's decision. ``None`` if it is not active (already answered).
        A ``deny`` with ``stop`` stops the run, which then ends as ``permission`` unless ``cancelled`` (the user
        cancelled the run while it waited: that ends as ``interrupted``)."""
        item = self._active.get(item_id)
        if not isinstance(item, ApprovalItem):
            return None
        done = dataclasses.replace(item, decision=decision, feedback=feedback)
        if decision == "deny" and stop and not cancelled:
            self._stop_asked = True
        self._complete(done)
        return done

    def discard(self, item_id: str) -> bool:
        """Throws away an active item, e.g. a reply whose stream broke and is being asked again."""
        if self._active.pop(item_id, None) is None:
            return False
        self._text.pop(item_id, None)
        if item_id == self._message_id:
            self._message_id = None
            self._pending = ""
        self._send(ItemDiscarded(item_id))
        return True

    def stop_run(self, reason: RunStopReason, message: str | None = None) -> RunStopped:
        """Ends the run's unfinished items (see ``finalize``) and adds a ``run_stopped`` item."""
        self.finalize()
        return self._born_finished(RunStopped(self._new_id(), reason, message))

    def finalize(self) -> None:
        """Closes every unfinished item: a partial reply is completed with its text so far (an empty one is
        discarded), running tool calls become ``interrupted`` and an active approval is denied."""
        for item_id, item in list(self._active.items()):
            match item:
                case AgentMessage():
                    self._finish_message(item_id, "".join(self._text[item_id]))
                case ToolCallItem():
                    self._complete(dataclasses.replace(item, status="interrupted"))
                case ApprovalItem():
                    self._complete(dataclasses.replace(item, decision="deny"))
                case _:
                    self._complete(item)
        self._pending = ""

    # ------------------------------------------------------------------ core events

    def handle(self, event: Event) -> None:
        """Feeds one core event."""
        match event:
            case TurnStarted():
                if self._message_id is not None:  # the last reply never finished: it is being asked again
                    self.discard(self._message_id)
                self._pending = ""
            case TextDelta(text):
                self._on_text(text)
            case AssistantDone(text):
                self._on_assistant_done(text)
            case ToolStarted(id, name, args):
                self._start(ToolCallItem(id, name, dict(args)))
            case ToolFinished():
                self._on_tool_finished(event)
            case ContextCompacted(before, after):
                self._born_finished(Compaction(self._new_id(), before, after))
            case Notice(text):
                self._born_finished(StatusLine(self._new_id(), text))
            case RunFinished(stopped_by):
                self.finalize()
                if stopped_by == "limit":
                    self._born_finished(RunStopped(self._new_id(), "limit"))
            case Interrupted():
                reason: RunStopReason = "permission" if self._stop_asked else "interrupted"
                self._stop_asked = False
                self.stop_run(reason)
            case Failed(message, reason):
                self.stop_run(reason, message)

    # ------------------------------------------------------------------ internals

    def _on_text(self, chunk: str) -> None:
        if not chunk:
            return
        if self._message_id is None:
            self._pending += chunk
            if not self._pending.strip():
                return  # wait for something to show
            item = AgentMessage(self._new_id(), "")
            self._text[item.id] = []
            self._message_id = item.id
            chunk, self._pending = self._pending, ""
            self._start(item)
        self._text[self._message_id].append(chunk)
        self._send(ItemDelta(self._message_id, chunk))

    def _on_assistant_done(self, text: str) -> None:
        self._pending = ""
        if self._message_id is None:
            if text.strip():  # not streamed
                item = AgentMessage(self._new_id(), text)
                self._start(item)
                self._complete(item)
            return
        streamed = "".join(self._text[self._message_id])
        self._finish_message(self._message_id, text if text.strip() else streamed)

    def _finish_message(self, item_id: str, text: str) -> None:
        if not text.strip():
            self.discard(item_id)
            return
        self._message_id = None
        self._text.pop(item_id, None)
        self._complete(AgentMessage(item_id, text))

    def _on_tool_finished(self, event: ToolFinished) -> None:
        active = self._active.get(event.id)
        item = ToolCallItem(event.id, event.name, dict(event.args), event.kind, event.result, event.images)
        if not isinstance(active, ToolCallItem):  # denied or cancelled without starting
            self._start(item)
        self._complete(item)

    def _born_finished(self, item: Any) -> Any:
        self._start(item)
        self._complete(item)
        return item

    def _start(self, item: Item) -> None:
        self._active[item.id] = item
        self._send(ItemStarted(item))

    def _complete(self, item: Item) -> None:
        self._active.pop(item.id, None)
        self._items.append(item)
        self._send(ItemCompleted(item))

    def _send(self, event: ItemEvent) -> None:
        self._seq += 1
        self._emit(self._seq, event)


__all__ = [
    "ToolCallStatus",
    "ToolResultKind",
    "RunStopReason",
    "Item",
    "ITEM_KINDS",
    "UserMessage",
    "AgentMessage",
    "ToolCallItem",
    "ApprovalItem",
    "NoticeItem",
    "StatusLine",
    "MemoryReview",
    "Compaction",
    "RunStopped",
    "ItemEvent",
    "EVENT_TYPES",
    "InfoChanged",
    "Deleted",
    "ItemStarted",
    "ItemDelta",
    "ItemCompleted",
    "ItemDiscarded",
    "ItemRecorder",
    "item_to_dict",
    "item_from_dict",
    "event_to_dict",
    "event_from_dict",
    "info_to_data",
]
