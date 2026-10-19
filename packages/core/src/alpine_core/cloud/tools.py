"""The agent's tools for the live data of a project's published app (section 6.5 of docs/alpine-cloud-api.md).

``app_data_read`` reads and never asks (it only reads the owner's own app through Alpine, and the first read tells the
user that rows go to the model). ``app_data_write`` changes live data: its ``open_world`` hint makes it ``exec`` for
``permissions.kind_of``, so ``default`` and ``accept_edits`` ask, ``auto`` lets the reviewer answer and ``yolo`` never
asks. There is no permission rule of its own. The API takes a restore point before every write.

The tools are only offered for a project whose app is live (``LiveData``, a ``ToolSource``).
"""

from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

from alpineagents import Hints, ToolError, tool
from alpineagents.tool import collect_tools

from ..cancellation import current_notice, current_session
from ..tool_sources import Offered
from . import data, links
from .auth import AlpineTokens, SignedOut
from .client import CloudClient, CloudError

__all__ = ["FIRST_READ_NOTICE", "LiveData", "LiveDataTools", "forget", "write_hints", "write_title_and_preview"]

#: The ``Notice.code`` of a project's first live read; the app words it itself, ``FIRST_READ_TEXT`` is for the rest.
FIRST_READ_NOTICE = "live_data_first_read"
FIRST_READ_TEXT = (
    "The AI read your app's live data. What it read is sent to the AI model. The Data tab lists everything the AI read."
)

#: How long the answer to "is the app live?" is kept, so a list of tools does not ask the API every time.
_CACHE_SECONDS = 10.0
_cache: dict[tuple[str, str], tuple[float, bool]] = {}
_cache_lock = threading.Lock()


def forget(folder: Path | None = None) -> None:
    """Drops what is known about whether apps are live (after a publish, and in tests)."""
    with _cache_lock:
        if folder is None:
            _cache.clear()
        else:
            for key in [k for k in _cache if k[0] == str(folder)]:
                del _cache[key]


class LiveData:
    """A tool source: the live-data tools of a project whose app is live, else nothing."""

    def __init__(self, folder: Path, client: CloudClient | None = None) -> None:
        self.folder = folder
        self._client = client

    def offered(self) -> list[Offered]:
        if not self._is_live():
            return []
        tools = collect_tools([LiveDataTools(self.folder, self._client)])
        return [Offered(t, "builtin", optional=False) for t in tools.values()]

    def _is_live(self) -> bool:
        link = links.get(self.folder)
        if link is None:
            return False
        key = (str(self.folder), link.app_id)
        with _cache_lock:
            found = _cache.get(key)
        if found is not None and time.monotonic() - found[0] < _CACHE_SECONDS:
            return found[1]
        live = data.live_app(self.folder, self._client) is not None
        with _cache_lock:
            _cache[key] = (time.monotonic(), live)
        return live


# ---------------------------------------------------------------- the tools

#: Text only: alpineagents takes no union inside a list. SQLite turns a text value into a number when the column it is
#: compared with or stored in has a number type, so ``?`` values still work for ids and counts.
Params = list[str] | None


class LiveDataTools:
    def __init__(self, folder: Path, client: CloudClient | None = None) -> None:
        self.folder = folder
        self._client = client

    @tool(name="app_data_read", read_only=True, open_world=False)
    def app_data_read(self, sql: str, params: Params = None) -> str:
        """Read the live data of the app this project is published as (real customers' data, not the practice data).
        One SELECT, WITH ... SELECT, EXPLAIN or PRAGMA table_info statement; at most 500 rows come back. Columns that
        hold passwords or tokens show as dots. Use ? for values and give them in params.

        Args:
            sql: One read-only SQL statement
            params: Values for the ? marks, in order, as text
        """
        body = self._call(
            "query", {"sql": sql, "params": params or [], "session": current_session.get(), "purpose": "agent"}
        )
        self._first_read()
        return json.dumps(body, ensure_ascii=False)

    @tool(name="app_data_write", parallel=False, hints_for=lambda args: write_hints(args))
    def app_data_write(self, sql: str, reason: str, params: Params = None) -> str:
        """Change the live data of the app this project is published as. One INSERT, UPDATE or DELETE statement;
        schema changes (CREATE, ALTER, DROP) are refused here, make a migration and publish instead. Alpine takes a
        restore point first, so the owner can go back. The owner is asked before it runs. Use ? for values.

        Args:
            sql: One INSERT, UPDATE or DELETE statement
            reason: Why, in a sentence the owner can read in the approval
            params: Values for the ? marks, in order, as text
        """
        body = self._call(
            "execute",
            {"sql": sql, "params": params or [], "session": current_session.get(), "reason": reason},
        )
        return json.dumps(body, ensure_ascii=False)

    # ---- helpers

    def _call(self, endpoint: str, body: dict[str, Any]) -> Any:
        link = links.get(self.folder)
        if link is None:
            raise ToolError("This project is not published as an Alpine app.")
        client = self._client or CloudClient(AlpineTokens())
        try:
            return client.post(f"/v1/apps/{link.app_id}/data/{endpoint}", body)
        except CloudError as e:
            raise ToolError(f"{e.message} ({e.code})") from e
        except SignedOut as e:
            raise ToolError("Not signed in to Alpine. Ask the owner to sign in.") from e

    def _first_read(self) -> None:
        """Tells the user, once per project, that rows went to the model."""
        notice = current_notice.get()
        if notice is not None and links.mark_live_read_notice(self.folder):
            notice(FIRST_READ_TEXT, FIRST_READ_NOTICE)


# ---------------------------------------------------------------- what a write is

_COMMENTS = re.compile(r"--[^\n]*|/\*.*?\*/", re.S)
_LITERALS = re.compile(r"'(?:[^']|'')*'|\"(?:[^\"]|\"\")*\"")
_TABLE = r"[\"`\[]?([A-Za-z_][\w$]*)[\"`\]]?"
_TARGET = re.compile(
    rf"^\s*(?:DELETE\s+FROM|UPDATE(?:\s+OR\s+\w+)?|INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO)\s+{_TABLE}", re.I
)


def _bare(sql: Any) -> str:
    """The statement without comments and string literals, so a keyword inside a text does not count."""
    return _LITERALS.sub("''", _COMMENTS.sub(" ", str(sql))).strip().rstrip(";").strip()


def hard_to_undo(sql: Any) -> bool:
    """``DELETE``, ``UPDATE`` without ``WHERE``, ``REPLACE`` and ``INSERT ... SELECT``, and any statement not understood
    (the worst case when unsure)."""
    text = _bare(sql)
    first = text.split(None, 1)[0].upper() if text else ""
    if first == "DELETE" or first == "REPLACE":
        return True
    if first == "UPDATE":
        return re.search(r"\bWHERE\b", text, re.I) is None
    if first == "INSERT":
        return (
            re.search(r"\bOR\s+REPLACE\b", text, re.I) is not None or re.search(r"\bSELECT\b", text, re.I) is not None
        )
    return True


def write_hints(args: Any) -> Hints:
    """The hints of one ``app_data_write`` call: it reaches Alpine's API (``open_world``) and changes data; it is
    ``destructive`` when it is hard to undo by hand (a restore point is taken either way)."""
    sql = args.get("sql") if isinstance(args, dict) else None
    return Hints(read_only=False, destructive=hard_to_undo(sql), idempotent=False, open_world=True)


def write_title_and_preview(args: dict[str, Any]) -> tuple[str, str]:
    """The approval of an ``app_data_write``: its title (says when the call is hard to undo, and that a restore point
    is taken first) and its preview (the SQL, the values and the reason)."""
    sql = str(args.get("sql", ""))
    found = _TARGET.match(_bare(sql))
    table = found.group(1) if found else None
    first = (_bare(sql).split(None, 1) or [""])[0].upper()
    verb = {
        "DELETE": "Delete rows in",
        "UPDATE": "Change rows in",
        "INSERT": "Add rows to",
        "REPLACE": "Replace rows in",
    }
    where = verb.get(first, "Change data in")
    title = f"{where} {table}" if table else "Change data"
    title += " (live data; a restore point is taken first)"
    if hard_to_undo(sql):
        title = title.replace("(live data;", "(live data, hard to undo;")
    lines = [sql.strip()]
    if args.get("params"):
        lines.append(f"Values: {json.dumps(args['params'], ensure_ascii=False)}")
    if args.get("reason"):
        lines.append(f"Reason: {args['reason']}")
    return title, "\n".join(lines)
