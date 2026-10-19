"""The data of a project's web app, for the 데이터 tab (section 4.9 of docs/alpine-cloud-api.md).

Two sources with one shape. ``practice`` is the app's local database the Cloudflare Vite plugin keeps under
``.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite``; it is opened with ``sqlite3`` and can be edited.
``live`` is the published app's database, read through the API and never written from here (changes to live data go
through the AI and its approval: ``tools.py``).

Both hide the platform's own tables and show ``••••`` for the values of secret-looking columns, the same rules as the
API's, so the tab looks the same on either. Everything here blocks; the server runs it on a thread.
"""

from __future__ import annotations

import re
import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from . import auth, links
from .apps import App
from .auth import AlpineTokens, SignedOut
from .client import CloudClient, CloudError

__all__ = [
    "MASK",
    "DataError",
    "Table",
    "delete",
    "is_masked",
    "live_app",
    "practice_file",
    "reads",
    "rows",
    "save",
    "sources",
    "tables",
]

Source = Literal["practice", "live"]

#: What a secret-looking column shows instead of its value.
MASK = "••••"
#: Most rows one page has (the API's limit too).
MAX_ROWS = 500
BUSY_TIMEOUT = 5.0

_PRACTICE_GLOB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite"
_HIDDEN = re.compile(r"^(sqlite_|_cf_|d1_migrations$)")
_SECRET_WORDS = frozenset({"token", "password", "secret", "hash"})
_WORDS = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+")


class DataError(Exception):
    """Why a data call failed. ``code`` is ``read_only``, ``not_found``, ``invalid``, ``not_available`` (the source
    is not there) or the API's own error code for the live source."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class Table:
    name: str
    rows: int
    columns: list[dict[str, Any]]


def is_masked(column: str) -> bool:
    """Whether the column's name has ``token``, ``password``, ``secret`` or ``hash`` as a word (``_``-separated or a
    camelCase part: ``accessToken``, ``password_hash``). ``tokens`` and ``hashtag`` are not."""
    return any(word.lower() in _SECRET_WORDS for word in _WORDS.findall(column))


def is_hidden(table: str) -> bool:
    return _HIDDEN.match(table) is not None


# ---------------------------------------------------------------- sources


def practice_file(folder: Path) -> Path | None:
    """The local database: the one with the most tables of the app's own (the plugin also keeps a file for an empty
    database). ``None`` before the dev server has ever run."""
    files = sorted(folder.glob(_PRACTICE_GLOB))
    if not files:
        return None
    return max(files, key=lambda f: (_own_tables(f), f.stat().st_size))


def live_app(folder: Path, client: CloudClient | None = None) -> App | None:
    """The project's app when it is live, else ``None`` (not linked, signed out, not published, API not answering)."""
    link = links.get(folder)
    if link is None or not auth.signed_in():
        return None
    try:
        app = App.from_api((client or CloudClient(AlpineTokens())).get(f"/v1/apps/{link.app_id}", timeout=10)["app"])
    except (CloudError, SignedOut):
        return None
    return app if app.status == "live" else None


def sources(folder: Path, client: CloudClient | None = None) -> list[dict[str, Any]]:
    return [
        {"kind": "practice", "available": practice_file(folder) is not None},
        {"kind": "live", "available": live_app(folder, client) is not None},
    ]


# ---------------------------------------------------------------- reading


def tables(folder: Path, source: Source, client: CloudClient | None = None) -> list[Table]:
    if source == "live":
        api, app_id = _live(folder, client)
        body = api.get(f"/v1/apps/{app_id}/data/tables")
        return [Table(t["name"], t.get("rows", 0), t.get("columns", [])) for t in body["tables"]]
    with _practice(folder) as db:
        found = []
        for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"):
            if not is_hidden(name):
                (count,) = db.execute(f"SELECT count(*) FROM {_quote(name)}").fetchone()
                found.append(Table(name, count, _columns(db, name)))
        return found


def rows(
    folder: Path,
    source: Source,
    table: str,
    *,
    limit: int = 100,
    offset: int = 0,
    order: str | None = None,
    dir: str = "asc",
    client: CloudClient | None = None,
) -> dict[str, Any]:
    """``{columns, rows, total}``. ``limit`` is at most 500."""
    limit = max(1, min(limit, MAX_ROWS))
    offset = max(0, offset)
    if source == "live":
        query = {"limit": limit, "offset": offset, "order": order, "dir": dir if order else None}
        api, app_id = _live(folder, client)
        return api.get(f"/v1/apps/{app_id}/data/tables/{quote(table, safe='')}/rows", query=query)
    with _practice(folder) as db:
        columns = [c["name"] for c in _known_columns(db, table)]
        sort = ""
        if order is not None:
            if order not in columns:
                raise DataError("invalid", f"{table} has no column {order}.")
            sort = f" ORDER BY {_quote(order)} {'DESC' if dir.lower() == 'desc' else 'ASC'}"
        (total,) = db.execute(f"SELECT count(*) FROM {_quote(table)}").fetchone()
        found = db.execute(f"SELECT * FROM {_quote(table)}{sort} LIMIT ? OFFSET ?", (limit, offset)).fetchall()
        hide = [is_masked(c) for c in columns]
        return {
            "columns": columns,
            "rows": [[_shown(v, h) for v, h in zip(row, hide, strict=True)] for row in found],
            "total": total,
        }


def reads(folder: Path, client: CloudClient | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """What the AI read from the live data, newest first."""
    api, app_id = _live(folder, client)
    body = api.get(f"/v1/apps/{app_id}/data/reads", query={"limit": limit})
    return list(body["reads"])


# ---------------------------------------------------------------- editing (practice only)


def save(
    folder: Path,
    source: Source,
    table: str,
    key: dict[str, Any] | None,
    cells: dict[str, Any],
) -> None:
    """Changes the cells of the row ``key`` names, or adds a row when ``key`` is ``None``. Only the practice data."""
    _editable(source)
    if not cells:
        raise DataError("invalid", "There is nothing to save.")
    with _practice(folder, edit=True) as db:
        columns = {c["name"] for c in _known_columns(db, table)}
        _check_cells(columns, cells)
        if key is None:
            names = ", ".join(_quote(c) for c in cells)
            marks = ", ".join("?" for _ in cells)
            _one_row(db, f"INSERT INTO {_quote(table)} ({names}) VALUES ({marks})", [_value(v) for v in cells.values()])
        else:
            where, args = _where(columns, key)
            sets = ", ".join(f"{_quote(c)} = ?" for c in cells)
            _one_row(
                db, f"UPDATE {_quote(table)} SET {sets} WHERE {where}", [*(_value(v) for v in cells.values()), *args]
            )


def delete(folder: Path, source: Source, table: str, key: dict[str, Any]) -> None:
    """Removes the row ``key`` names. Only the practice data."""
    _editable(source)
    with _practice(folder, edit=True) as db:
        where, args = _where({c["name"] for c in _known_columns(db, table)}, key)
        _one_row(db, f"DELETE FROM {_quote(table)} WHERE {where}", args)


def _editable(source: Source) -> None:
    if source != "practice":
        raise DataError("read_only", "Live data cannot be changed here. Ask the AI, which asks you first.")


def _check_cells(columns: set[str], cells: dict[str, Any]) -> None:
    for name in cells:
        if name not in columns:
            raise DataError("invalid", f"There is no column {name}.")
        if is_masked(name):
            raise DataError("invalid", f"{name} holds a secret and cannot be edited here.")


def _where(columns: set[str], key: dict[str, Any]) -> tuple[str, list[Any]]:
    if not key:
        raise DataError("invalid", "The row's key is missing.")
    unknown = [c for c in key if c not in columns]
    if unknown:
        raise DataError("invalid", f"There is no column {unknown[0]}.")
    return " AND ".join(f"{_quote(c)} IS ?" for c in key), [_value(v) for v in key.values()]


def _one_row(db: sqlite3.Connection, sql: str, args: list[Any]) -> None:
    """Runs a change that must touch exactly one row, or undoes it."""
    try:
        changed = db.execute(sql, args).rowcount
        if changed != 1:
            db.rollback()
            raise DataError(
                "not_found" if changed == 0 else "invalid",
                "No single row has that key." if changed == 0 else f"The key matches {changed} rows.",
            )
        db.commit()
    except sqlite3.Error as e:
        db.rollback()
        raise DataError("invalid", str(e)) from e


def _value(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if value is None or isinstance(value, int | float | str):
        return value
    raise DataError("invalid", "A cell holds text, a number or nothing.")


# ---------------------------------------------------------------- sqlite

_SYSTEM_QUERY = "SELECT name FROM sqlite_master WHERE type = 'table'"


@contextmanager
def _practice(folder: Path, *, edit: bool = False) -> Iterator[sqlite3.Connection]:
    file = practice_file(folder)
    if file is None:
        raise DataError("not_available", "The app has no local data yet. Run the app once first.")
    try:
        with closing(sqlite3.connect(file, timeout=BUSY_TIMEOUT)) as db:
            db.execute(f"PRAGMA busy_timeout = {int(BUSY_TIMEOUT * 1000)}")
            if edit:
                db.execute("PRAGMA foreign_keys = ON")  # as D1 has it, so a bad delete fails here too
            else:
                db.execute("PRAGMA query_only = ON")
            yield db
    except sqlite3.Error as e:
        raise DataError("invalid", str(e)) from e


def _own_tables(file: Path) -> int:
    try:
        with closing(sqlite3.connect(f"file:{file}?mode=ro", uri=True, timeout=BUSY_TIMEOUT)) as db:
            return sum(1 for (name,) in db.execute(_SYSTEM_QUERY) if not is_hidden(name))
    except sqlite3.Error:
        return 0


def _columns(db: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    references = {
        row[3]: f"{row[2]}.{row[4]}" if row[4] else row[2]
        for row in db.execute(f"PRAGMA foreign_key_list({_quote(table)})")
    }
    return [
        {
            "name": name,
            "type": declared,
            "pk": bool(pk),
            "nullable": not (notnull or pk),
            "references": references.get(name),
        }
        for _, name, declared, notnull, _, pk in db.execute(f"PRAGMA table_info({_quote(table)})")
    ]


def _known_columns(db: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    """The columns of a table the tab may show; a hidden or missing table is ``not_found``."""
    exists = db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone()
    if exists is None or is_hidden(table):
        raise DataError("not_found", f"There is no table {table}.")
    return _columns(db, table)


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _shown(value: Any, masked: bool) -> Any:
    if value is None:
        return None
    if masked:
        return MASK
    if isinstance(value, bytes):
        return f"<{len(value)} bytes>"
    return value


# ---------------------------------------------------------------- live


def _live(folder: Path, client: CloudClient | None) -> tuple[CloudClient, str]:
    """The client and the app's id. Whether the app is live is the API's answer to the call itself."""
    link = links.get(folder)
    if link is None:
        raise DataError("not_available", "The app is not published yet.")
    return client or CloudClient(AlpineTokens()), link.app_id
