"""What both readers produce, and how it becomes a saved session.

A reader turns the other app's file into a ``Transcript``: the conversation as alpineagents messages, in order, with a
``Cut`` wherever that app compacted it. The screen shows everything; the model gets what came after the last cut,
which starts with what the cut left in context (a summary, kept messages). Tool calls stay tool calls.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from alpineagents.types import Image, Message, TextBlock, ToolCall, ToolResultBlock

from ..items import AgentMessage, Compaction, Imported, Item, ToolCallItem, UserMessage, new_id

SOURCE_NAMES = {"claude_code": "Claude Code", "codex": "Codex"}

# Provider rules for names and ids in a request (Anthropic and OpenAI agree on these).
_NAME = re.compile(r"[^A-Za-z0-9_-]")
_NAME_LENGTH = 64
_RESULT_LENGTH = 50_000
"""The longest tool result the screen keeps; the model gets the whole result."""

# A text that is only tagged blocks is something the app added for its model (environment, instructions, command
# echoes, reminders), not what the person wrote.
_TAGGED = re.compile(r"\s*(?:<([A-Za-z][\w.-]*)\b[^>]*>.*?</\1>\s*)+", re.DOTALL)
_INSTRUCTIONS = ("# AGENTS.md instructions for ",)
_IMAGE_LABEL = re.compile(r"\s*</?image\b[^>]*>\s*")
_REMINDER = re.compile(r"\s*<system-reminder>.*?</system-reminder>\s*", re.DOTALL)


@dataclass
class Cut:
    """The other app compacted the conversation here. ``context`` is what it kept for its model (a summary, kept
    messages); ``None`` when that cannot be read (an encrypted summary), so the model keeps the history before it."""

    before_tokens: int = 0
    context: list[Message] | None = None


@dataclass
class Transcript:
    entries: list[Message | Cut] = field(default_factory=list)

    def add(self, message: Message) -> None:
        if message.content:
            self.entries.append(message)


def is_added_text(text: str) -> bool:
    """Whether a text is the app's own context rather than the person's words."""
    stripped = text.strip()
    if not stripped:
        return True
    return (
        stripped.startswith(_INSTRUCTIONS)
        or _TAGGED.fullmatch(stripped) is not None
        or bool(_IMAGE_LABEL.fullmatch(stripped))
    )


def clean_text(text: str) -> str:
    """The text without the app's reminders woven into it."""
    return _REMINDER.sub("\n", text).strip()


def image_from_data_url(url: str) -> Image | None:
    """An image given as a ``data:`` URL, or ``None`` (a remote URL, or data that is not an image)."""
    if not url.startswith("data:") or "," not in url:
        return None
    head, data = url.split(",", 1)
    if not head.endswith(";base64"):
        return None
    try:
        return Image.from_base64(data, head[5:].split(";")[0] or None)
    except ValueError:
        return None


def image_from_base64(data: str, media_type: str | None) -> Image | None:
    try:
        return Image.from_base64(data, media_type)
    except ValueError:
        return None


# ------------------------------------------------------------------------------------- shaping for providers


def _merge(messages: list[Message]) -> list[Message]:
    merged: list[Message] = []
    for message in messages:
        if merged and merged[-1].role == message.role:
            merged[-1] = Message(message.role, merged[-1].content + message.content)
        else:
            merged.append(message)
    return merged


def shape(messages: list[Message]) -> list[Message]:
    """The messages as every provider accepts them: roles alternate, the first is the user's, every tool call is
    answered in the next message (an unanswered one is told it has no result), results come first in their message,
    results without their call are dropped, and names and ids use only the characters providers allow, ids unique."""
    renamed: dict[str, str] = {}
    used: set[str] = set()

    def fresh_id(old: str) -> str:
        base = _NAME.sub("_", old)[:_NAME_LENGTH] or "call"
        new, n = base, 1
        while new in used:
            n += 1
            new = f"{base[: _NAME_LENGTH - len(str(n)) - 1]}_{n}"
        used.add(new)
        return new

    out: list[Message] = []
    merged = _merge(messages)
    for message in merged:
        if message.role == "assistant":
            blocks = []
            for block in message.content:
                if isinstance(block, ToolCall):
                    renamed[block.id] = new = fresh_id(block.id)
                    name = _NAME.sub("_", block.name)[:_NAME_LENGTH] or "tool"
                    blocks.append(ToolCall(name, dict(block.args), new))
                else:
                    blocks.append(block)
            out.append(Message("assistant", tuple(blocks)))
            continue
        calls = [b for b in out[-1].content if isinstance(b, ToolCall)] if out and out[-1].role == "assistant" else []
        open_ids = {call.id for call in calls}
        results: list[ToolResultBlock] = []
        rest = []
        for block in message.content:
            if isinstance(block, ToolResultBlock):
                new = renamed.get(block.call_id)
                if new in open_ids:
                    open_ids.discard(new)
                    results.append(ToolResultBlock(new, block.content, block.name, block.is_error))
            else:
                rest.append(block)
        missing = [ToolResultBlock(c.id, "(no result was recorded)", c.name, True) for c in calls if c.id in open_ids]
        if results or missing or rest:
            out.append(Message("user", (*missing, *results, *rest)))
    # An answered call needs its result even when the conversation ends right after it.
    if out and out[-1].role == "assistant" and (calls := out[-1].tool_calls):
        out.append(
            Message("user", tuple(ToolResultBlock(c.id, "(no result was recorded)", c.name, True) for c in calls))
        )
    if out and out[0].role == "assistant":
        out.insert(0, Message.notice("The conversation before this point was not carried over."))
    return out


# ------------------------------------------------------------------------------------------------- the result


def model_messages(transcript: Transcript, source: str) -> list[Message]:
    """What the model continues from: everything after the last readable cut, starting with what it kept, then a
    notice that says where the conversation came from."""
    messages: list[Message] = []
    for entry in transcript.entries:
        if isinstance(entry, Cut):
            if entry.context:  # an unreadable or empty one leaves the history before it to the model
                messages = list(entry.context)
        else:
            messages.append(entry)
    app = SOURCE_NAMES[source]
    messages.append(
        Message.notice(
            f"This conversation was carried over from {app}. The tool calls above used {app}'s tools; from here on "
            "you work with the tools you have now."
        )
    )
    return shape(messages)


def screen_items(transcript: Transcript, source: str) -> list[Item]:
    """The conversation as the session screen draws it: the person's messages, the replies, each tool call with its
    result (a call that never got one shows as interrupted), a divider where the app compacted, and the line that
    says where it was carried over."""
    items: list[Item] = []
    calls: dict[str, int] = {}  # call id -> index in items, while waiting for its result
    ids: set[str] = set()
    for entry in transcript.entries:
        if isinstance(entry, Cut):
            items.append(_divider(entry))
        elif entry.role == "user":
            for block in entry.content:
                if isinstance(block, ToolResultBlock) and (at := calls.pop(block.call_id, None)) is not None:
                    call = items[at]
                    assert isinstance(call, ToolCallItem)
                    text, images = _result_text(block)
                    status = "error" if block.is_error else "done"
                    items[at] = ToolCallItem(call.id, call.name, call.args, status, text, images)
            if _said(entry):
                items.append(UserMessage(new_id(), _user_text(entry)))
        else:
            text = "\n\n".join(b.text for b in entry.content if isinstance(b, TextBlock) and b.text.strip())
            if text:
                items.append(AgentMessage(new_id(), text))
            for call in entry.tool_calls:
                item_id = call.id if call.id and call.id not in ids else new_id()
                ids.add(item_id)
                calls[call.id] = len(items)
                items.append(ToolCallItem(item_id, call.name, dict(call.args), "interrupted"))
    items.append(Imported(new_id(), source))
    return items


def _said(message: Message) -> bool:
    """Whether a user message has something the person wrote (not only tool results, not a notice)."""
    return not message.is_notice and any(isinstance(b, TextBlock | Image) for b in message.content)


def _user_text(message: Message) -> str:
    text = "\n\n".join(b.text for b in message.content if isinstance(b, TextBlock) and b.text.strip())
    images = sum(isinstance(b, Image) for b in message.content)
    return text if not images else (text + "\n\n" if text else "") + "\n".join(["(image)"] * images)


def _result_text(block: ToolResultBlock) -> tuple[str, int]:
    if isinstance(block.content, str):
        text, images = block.content, 0
    else:
        parts = [b.text if isinstance(b, TextBlock) else f"({b.media_type or 'image'})" for b in block.content]
        text, images = "\n".join(parts), sum(isinstance(b, Image) for b in block.content)
    if len(text) > _RESULT_LENGTH:
        text = text[:_RESULT_LENGTH] + "\n…"
    return text, images


def _divider(cut: Cut) -> Compaction:
    after = sum(len(m.text) for m in cut.context or ()) // 4
    return Compaction(new_id(), cut.before_tokens, after)
