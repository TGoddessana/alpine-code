"""Claude Code's conversations: ``~/.claude/projects/<folder>/<session id>.jsonl`` (``$CLAUDE_CONFIG_DIR`` instead of
``~/.claude`` when set).

Each line is one record. The conversation is the ``user`` and ``assistant`` records, chained by ``parentUuid`` from
the last one back to the first; other records (titles, attachments, file snapshots, queue operations...) are skipped,
so new kinds do not break reading. A compaction is a ``system`` record with ``subtype: "compact_boundary"`` whose
``logicalParentUuid`` continues the chain, followed by a user record with ``isCompactSummary``. Subagents write their
own files under ``<session id>/subagents/``; the main file has each one's call and report, which is what is read.
The shape has held since Claude Code 2.0.28 (October 2025); older files read as far as they match it.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from alpineagents.types import Message, TextBlock, ToolCall, ToolResultBlock

from ._transcript import Cut, Transcript, clean_text, image_from_base64, is_added_text

_SLUG = re.compile(r"[^A-Za-z0-9]")
_SLUG_LENGTH = 200
_INTERRUPTED = ("[Request interrupted by user",)


def projects_dir() -> Path:
    root = os.environ.get("CLAUDE_CONFIG_DIR")
    return (Path(root).expanduser() if root else Path.home() / ".claude") / "projects"


def folders_for(project: Path, root: Path) -> list[Path]:
    """The folders that may hold conversations started in ``project`` or a folder inside it. Claude Code names a
    folder after the path with every character other than a letter or digit turned into ``-``, and cuts a long
    name to 200 characters plus a hash, so a long path matches by its first 200."""
    slug = _SLUG.sub("-", str(project))
    if not root.is_dir():
        return []
    found = []
    for folder in root.iterdir():
        name = folder.name
        if not folder.is_dir():
            continue
        if (
            name == slug
            or name.startswith(slug + "-")
            or (len(slug) > _SLUG_LENGTH and name[:_SLUG_LENGTH] == slug[:_SLUG_LENGTH])
        ):
            found.append(folder)
    return found


def _records(path: Path) -> Iterator[dict[str, Any]]:
    with path.open("rb") as file:
        for line in file:
            try:
                record = json.loads(line)
            except ValueError:
                continue  # a torn last line
            if isinstance(record, dict):
                yield record


def summary(path: Path) -> tuple[str, str, str] | None:
    """``(cwd, title, first message)`` of a conversation file, or ``None`` when it has nothing the person wrote. The
    title is the one the person gave, else the one Claude Code made, else empty."""
    cwd = custom = made = first = ""
    for record in _records(path):
        kind = record.get("type")
        if kind == "custom-title":
            custom = record.get("customTitle") or custom
        elif kind == "ai-title":
            made = record.get("aiTitle") or made
        elif kind == "user" and not record.get("isSidechain"):
            cwd = cwd or record.get("cwd") or ""
            if not first and not record.get("isMeta") and not record.get("isCompactSummary"):
                first = _first_text(record)
    if not first:
        return None
    return cwd, custom or made, first


def _first_text(record: dict[str, Any]) -> str:
    content = (record.get("message") or {}).get("content")
    texts = (
        [content]
        if isinstance(content, str)
        else [b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text"]
    )
    for text in texts:
        if isinstance(text, str) and not is_added_text(text) and not text.startswith(_INTERRUPTED):
            return clean_text(text)
    return ""


def read(path: Path) -> Transcript:
    """The conversation in a file, along its last branch."""
    by_id: dict[str, dict[str, Any]] = {}
    results: dict[str, ToolResultBlock] = {}
    leaf: str | None = None
    for record in _records(path):
        uid = record.get("uuid")
        if not isinstance(uid, str):
            continue
        by_id[uid] = record
        if record.get("type") in ("user", "assistant") and not record.get("isSidechain"):
            leaf = uid
        if record.get("type") == "user" and not record.get("isSidechain"):
            for block in _user(record).content:
                if isinstance(block, ToolResultBlock):
                    results[block.call_id] = block
    chain: list[dict[str, Any]] = []
    seen: set[str] = set()
    while leaf is not None and leaf not in seen and (record := by_id.get(leaf)) is not None:
        seen.add(leaf)
        chain.append(record)
        leaf = record.get("parentUuid") or record.get("logicalParentUuid")
    chain.reverse()

    transcript = Transcript()
    assistant_id: object = None
    for record in chain:
        kind = record.get("type")
        if kind == "system" and record.get("subtype") == "compact_boundary":
            meta = record.get("compactMetadata") or {}
            transcript.entries.append(Cut(before_tokens=int(meta.get("preTokens") or 0), context=[]))
            assistant_id = None
        elif kind == "user" and record.get("isCompactSummary"):
            summary_message = Message.user(_text_of(record))
            last = transcript.entries[-1] if transcript.entries else None
            if isinstance(last, Cut) and last.context is not None:
                last.context.append(summary_message)
            else:
                transcript.entries.append(Cut(context=[summary_message]))
            assistant_id = None
        elif kind == "user" and not record.get("isMeta"):
            transcript.add(_user(record))
            assistant_id = None
        elif kind == "assistant" and not record.get("isApiErrorMessage"):
            message = _assistant(record)
            this_id = (record.get("message") or {}).get("id")
            # One reply is written as one record per block, sharing the message id.
            last = transcript.entries[-1] if transcript.entries else None
            if (
                this_id is not None
                and this_id == assistant_id
                and isinstance(last, Message)
                and last.role == "assistant"
            ):
                transcript.entries[-1] = Message("assistant", last.content + message.content)
            else:
                transcript.add(message)
            assistant_id = this_id
    _add_sibling_results(transcript, results)
    return transcript


def _add_sibling_results(transcript: Transcript, results: dict[str, ToolResultBlock]) -> None:
    """Calls made together each get their result as a sibling record, and the chain goes on from the last one only,
    so the others' results are found by call id."""
    entries = transcript.entries
    waiting: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, Message):
            continue
        if entry.role == "assistant":
            waiting = [call.id for call in entry.tool_calls]
            continue
        have = {b.call_id for b in entry.content if isinstance(b, ToolResultBlock)}
        found = tuple(results[i] for i in waiting if i not in have and i in results)
        if found:
            entries[index] = Message("user", found + entry.content)
        waiting = []
    if waiting and (found := tuple(results[i] for i in waiting if i in results)):
        entries.append(Message("user", found))


def _text_of(record: dict[str, Any]) -> str:
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content or [] if isinstance(b, dict) and b.get("type") == "text")


def _user(record: dict[str, Any]) -> Message:
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    blocks: list[Any] = []
    for block in content or []:
        if not isinstance(block, dict):
            continue
        match block.get("type"):
            case "text":
                text = block.get("text")
                if isinstance(text, str) and not is_added_text(text) and (text := clean_text(text)):
                    blocks.append(TextBlock(text))
            case "image":
                if (image := _image(block)) is not None:
                    blocks.append(image)
            case "tool_result":
                call_id = block.get("tool_use_id")
                if isinstance(call_id, str):
                    blocks.append(
                        ToolResultBlock(call_id, _result(block.get("content")), is_error=bool(block.get("is_error")))
                    )
    return Message("user", tuple(blocks))


def _assistant(record: dict[str, Any]) -> Message:
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]
    blocks: list[Any] = []
    for block in content or []:
        if not isinstance(block, dict):
            continue
        match block.get("type"):
            case "text":
                if isinstance(text := block.get("text"), str) and text.strip():
                    blocks.append(TextBlock(text))
            case "tool_use":
                name, call_id, args = block.get("name"), block.get("id"), block.get("input")
                if isinstance(name, str) and isinstance(call_id, str):
                    blocks.append(ToolCall(name, args if isinstance(args, dict) else {"input": args}, call_id))
            # Thinking is signed for the model that wrote it (and saved empty since 2.1.112), so it stays behind.
    return Message("assistant", tuple(blocks))


def _image(block: dict[str, Any]) -> Any:
    source = block.get("source") or {}
    if source.get("type") == "base64" and isinstance(data := source.get("data"), str):
        return image_from_base64(data, source.get("media_type"))
    return None


def _result(content: Any) -> Any:
    if isinstance(content, str):
        return content
    parts: list[Any] = []
    for block in content or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text" and isinstance(text := block.get("text"), str):
            parts.append(TextBlock(text))
        elif block.get("type") == "image" and (image := _image(block)) is not None:
            parts.append(image)
    if all(isinstance(p, TextBlock) for p in parts):
        return "\n".join(p.text for p in parts)
    return tuple(parts)
