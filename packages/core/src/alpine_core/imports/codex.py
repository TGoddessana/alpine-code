"""Codex's conversations: ``~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`` (``$CODEX_HOME`` instead of
``~/.codex`` when set), sometimes compressed as ``.jsonl.zst``.

Each line is ``{"timestamp", "type", "payload"}`` (since Codex 0.32, September 2025; older files have no such lines and
are not listed). The first line is ``session_meta``. The conversation is read from the ``response_item`` lines, which
are what Codex sends its model; ``event_msg`` lines changed vocabulary in 0.144 and are skipped, as are lines of
kinds this reader does not know. A ``compacted`` line is a compaction, its ``replacement_history`` what Codex kept.
A forked thread's file starts after a prefix of another file (``session_meta.history_base``), which is read first.
Subagent threads (``source`` is an object) are not listed: their parent has their calls and reports.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from alpineagents.types import Message, TextBlock, ToolCall, ToolResultBlock

from ._transcript import Cut, Transcript, clean_text, image_from_data_url, is_added_text

_PATTERNS = ("rollout-*.jsonl", "rollout-*.jsonl.zst")
_MAX_PREFIXES = 16


def codex_home() -> Path:
    root = os.environ.get("CODEX_HOME")
    return Path(root).expanduser() if root else Path.home() / ".codex"


def files(home: Path) -> Iterator[Path]:
    sessions = home / "sessions"
    if sessions.is_dir():
        for pattern in _PATTERNS:
            yield from sessions.rglob(pattern)


def _read_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    if path.name.endswith(".zst"):
        from compression import zstd  # Python 3.14

        data = zstd.decompress(data)
    return data


def _lines(data: bytes) -> Iterator[dict[str, Any]]:
    for line in data.split(b"\n"):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict) and isinstance(record.get("type"), str):
            yield record


def meta(path: Path) -> dict[str, Any] | None:
    """The ``session_meta`` payload of a file, read from its first line; ``None`` for an older or unreadable file."""
    try:
        if path.name.endswith(".zst"):
            first = _read_bytes(path).split(b"\n", 1)[0]
        else:
            with path.open("rb") as file:
                first = file.readline()
        record = json.loads(first)
    except (OSError, ValueError):
        return None
    if (
        not isinstance(record, dict)
        or record.get("type") != "session_meta"
        or not isinstance(record.get("payload"), dict)
    ):
        return None
    return record["payload"]


def titles(home: Path) -> dict[str, str]:
    """The names given to threads (``session_index.jsonl``), by thread id; the last name wins."""
    found: dict[str, str] = {}
    try:
        data = (home / "session_index.jsonl").read_bytes()
    except OSError:
        return found
    for record in _lines_any(data):
        if isinstance(record.get("id"), str) and isinstance(name := record.get("thread_name"), str) and name:
            found[record["id"]] = name
    return found


def _lines_any(data: bytes) -> Iterator[dict[str, Any]]:
    for line in data.split(b"\n"):
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict):
            yield record


def first_message(path: Path) -> str:
    """The first thing the person wrote in a file, or empty."""
    for record in _lines(_read_bytes(path)):
        payload = record.get("payload")
        if record["type"] == "response_item" and isinstance(payload, dict):
            if payload.get("type") == "message" and payload.get("role") == "user":
                message = _user(payload)
                if message.text:
                    return message.text
    return ""


def read(path: Path) -> Transcript:
    """The conversation in a file, with the prefix a fork inherited."""
    transcript = Transcript()
    for record in _records(path):
        payload = record.get("payload")
        if not isinstance(payload, dict):
            continue
        if record["type"] == "compacted":
            transcript.entries.append(_cut(payload))
        elif record["type"] == "response_item":
            if (message := _item(payload)) is not None:
                transcript.add(message)
    return transcript


def _records(path: Path, end: int | None = None, depth: int = 0) -> list[dict[str, Any]]:
    """The lines of a file up to byte ``end``, after the prefix it inherited (which can itself be a fork)."""
    data = _read_bytes(path)
    own = list(_lines(data[:end] if end is not None else data))
    first = own[0] if own else {}
    base = first.get("payload", {}).get("history_base") if first.get("type") == "session_meta" else None
    if not isinstance(base, dict) or depth >= _MAX_PREFIXES:
        return own
    prefix = _find(path, str(base.get("thread_id", "")))
    if prefix is None or prefix == path:
        return own
    cut = base.get("end_byte_offset")
    return _records(prefix, cut if isinstance(cut, int) else None, depth + 1) + own


def _find(near: Path, rollout_id: str) -> Path | None:
    """The file of a rollout id: ``rollout-<time>-<id>.jsonl`` or, for a reverted thread, ``..._<id>.jsonl``."""
    if not rollout_id:
        return None
    sessions = next((p for p in near.parents if p.name == "sessions"), None)
    if sessions is None:
        return None
    for pattern in (f"rollout-*{rollout_id}.jsonl", f"rollout-*{rollout_id}.jsonl.zst"):
        for found in sessions.rglob(pattern):
            return found
    return None


def _cut(payload: dict[str, Any]) -> Cut:
    kept = [m for item in payload.get("replacement_history") or [] if isinstance(item, dict) and (m := _item(item))]
    summary = payload.get("message")
    if isinstance(summary, str) and summary.strip():
        kept.append(Message.user(summary))
    # Only the person's messages kept means the summary itself is encrypted: keep the history before the cut instead.
    readable = any(m.role == "assistant" for m in kept) or (isinstance(summary, str) and summary.strip())
    return Cut(context=kept if readable else None)


def _item(payload: dict[str, Any]) -> Message | None:
    match payload.get("type"):
        case "message":
            role = payload.get("role")
            if role == "user":
                return _user(payload)
            if role == "assistant":
                texts = [c.get("text") for c in payload.get("content") or [] if isinstance(c, dict)]
                return Message("assistant", tuple(TextBlock(t) for t in texts if isinstance(t, str) and t.strip()))
            return None  # developer and system messages are Codex's own instructions
        case "function_call":
            return _call(payload, _arguments(payload.get("arguments")))
        case "custom_tool_call":
            return _call(payload, {"input": payload.get("input", "")})
        case "local_shell_call":
            action = payload.get("action") or {}
            return _call({**payload, "name": "shell"}, {"command": action.get("command")})
        case "function_call_output" | "custom_tool_call_output":
            call_id = payload.get("call_id")
            if isinstance(call_id, str):
                return Message("user", (ToolResultBlock(call_id, _output(payload.get("output"))),))
    # reasoning and compaction are encrypted for OpenAI's models; web searches, images and the rest have no call
    return None


def _call(payload: dict[str, Any], args: dict[str, Any]) -> Message | None:
    name, call_id = payload.get("name"), payload.get("call_id")
    if not isinstance(name, str) or not isinstance(call_id, str):
        return None
    return Message("assistant", (ToolCall(name, args, call_id),))


def _arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else None
    except ValueError:
        parsed = None
    return parsed if isinstance(parsed, dict) else {"input": raw}


def _user(payload: dict[str, Any]) -> Message:
    blocks: list[Any] = []
    for part in payload.get("content") or []:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "input_text" and isinstance(text := part.get("text"), str):
            if not is_added_text(text) and (text := clean_text(text)):
                blocks.append(TextBlock(text))
        elif part.get("type") == "input_image" and isinstance(url := part.get("image_url"), str):
            if (image := image_from_data_url(url)) is not None:
                blocks.append(image)
    return Message("user", tuple(blocks))


def _output(output: Any) -> Any:
    """A call's output: a string, or (since 0.51) a list of text and image parts."""
    if isinstance(output, str):
        return output
    if isinstance(output, dict):  # {"content": ..., "success": ...} in some versions
        return _output(output.get("content", json.dumps(output, ensure_ascii=False)))
    parts: list[Any] = []
    for part in output or []:
        if not isinstance(part, dict):
            continue
        if isinstance(text := part.get("text"), str):
            parts.append(TextBlock(text))
        elif isinstance(url := part.get("image_url"), str) and (image := image_from_data_url(url)) is not None:
            parts.append(image)
    if all(isinstance(p, TextBlock) for p in parts):
        return "\n".join(p.text for p in parts)
    return tuple(parts)
