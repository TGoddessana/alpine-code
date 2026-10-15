"""Provenance of check observations: Alpine compares what the agent cites with its own records."""

from __future__ import annotations

import hashlib
import json
import os
import re
from collections import OrderedDict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from alpine_core import ToolCallItem, file_storage, home_dir, item_from_dict
from alpine_protocol import FeatureFile, FlowCheck, Observation, ObservationProvenance

from .map_io import LIMIT, atomic, file_lock, image, inside, local_dir, read_bytes
from .methods import MethodError

_MAX_PINS = 2000
_ALNUM = frozenset("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
GRACE = 2.0  # seconds of clock slack around a session's lifetime
_MAX_HASHES = 20000
_MAX_SESSIONS = 128
_hashes: OrderedDict[tuple[str, int, int], str] = OrderedDict()
_excerpts: OrderedDict[tuple[str, str], bool] = OrderedDict()
# Pins file cache: path -> (mtime_ns, size, pins).
_pin_cache: dict[str, tuple[int, int, dict[str, str]]] = {}
# Recently read sessions: id -> (log stamp, parsed session).
_sessions: OrderedDict[str, tuple[tuple, _Session]] = OrderedDict()


def check_id(check: FlowCheck) -> str:
    """The agent's id for this run, or a hash of the check when it gave none."""
    return check.id or hashlib.sha256(check.model_dump_json(by_alias=True).encode()).hexdigest()[:16]


def current_checks(card: FeatureFile) -> dict[str, FlowCheck]:
    """The check recorded for each promise (the file holds one per promise)."""
    found: dict[str, FlowCheck] = {}
    for check in card.checks:
        if check.condition_id and check.condition_id not in found:
            found[check.condition_id] = check
    return found


@lru_cache(maxsize=256)
def _pattern(excerpt: str) -> re.Pattern[str] | None:
    """The excerpt with runs of whitespace collapsed, matched only on token boundaries."""
    tokens = excerpt.split()
    if not tokens:
        return None
    body = r"\s+".join(re.escape(t) for t in tokens)
    text = " ".join(tokens)
    # A boundary only guards an edge that is an ASCII letter or digit: "0 failed" is not in "10 failed", but
    # "180,000원" is in "180,000원이" and "ok." is in "ok.x".
    left = r"(?<![0-9A-Za-z])" if text[0] in _ALNUM else ""
    right = r"(?![0-9A-Za-z])" if text[-1] in _ALNUM else ""
    return re.compile(f"{left}{body}{right}")


def contains(text: str, excerpt: str) -> bool:
    pattern = _pattern(excerpt)
    return bool(pattern and pattern.search(text))


def _mentions_map(value: object) -> bool:
    if isinstance(value, str):
        return ".alpine/" in value.casefold()
    if isinstance(value, dict):
        return any(_mentions_map(v) for v in value.values())
    if isinstance(value, list | tuple):
        return any(_mentions_map(v) for v in value)
    return False


def _is_map_record(args: object, result: str) -> bool:
    """A call that read or wrote Alpine's own map: citing it would be Alpine confirming the agent's words."""
    return _mentions_map(args) or ('"observations"' in result and '"excerpt"' in result) or '"conditionId"' in result


@dataclass(frozen=True)
class _Session:
    cwd: str
    created_at: str
    updated_at: str
    calls: list[tuple[str, str, bool, bool]]  # (call id, result, is a record of the map itself, only read files)
    opened: frozenset[str] = frozenset()
    """Project-relative files the session read, edited, wrote, or saw lines of in search results."""
    commands: tuple[str, ...] = ()
    """Shell commands it ran: a file named in one counts as opened too (cat, sed, head)."""
    cards: frozenset[str] = frozenset()
    """Ids of the map cards it wrote: with the edit or write tool, or a shell command naming the card file."""


# "path:line:" at the start of a search result line, as grep and rg print it.
_HIT = re.compile(r"^([^:\n]+?):\d+[:-]", re.MULTILINE)
_OPENING = {"read", "edit", "write"}
_CARD = re.compile(r"\.alpine/map/features/([A-Za-z0-9_-]+)\.json")
_CD = re.compile(r"(?:^|[;&|]\s*)cd\s+([^\s;&|]+)")


def _relative(cwd: str, raw: object) -> str | None:
    """A tool's path argument as a normalized path relative to the session's folder, or None when outside it."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    path = Path(os.path.expanduser(raw))
    if path.is_absolute():
        # The session may store /tmp/x while a tool names /private/tmp/x (or the other way round).
        bases = list(dict.fromkeys([Path(cwd), _resolved(cwd)]))
        found = next((r for p in (path, _resolved(str(path))) for b in bases if (r := _under(p, b)) is not None), None)
        if found is None:
            return None
        path = found
    text = os.path.normpath(str(path)).replace(os.sep, "/")
    return None if text.startswith("..") or text == "." else text


def _resolved(path: str) -> Path:
    try:
        return Path(path).resolve()
    except (OSError, ValueError):
        return Path(path)


def _under(path: Path, base: Path) -> Path | None:
    try:
        return path.relative_to(base)
    except ValueError:
        return None


# A shell command that changes a file: redirection, tee, mv, cp, in-place edits, or a script.
_WRITES = re.compile(r">|\btee\b|\bmv\b|\bcp\b|\s-i\b|\bpython3?\b|\bnode\b|\bperl\b")


def _opened(cwd: str, item: ToolCallItem) -> tuple[set[str], str | None]:
    """Files one finished call opened, and its shell command if it was one."""
    if item.status != "done":
        return set(), None
    found: set[str] = set()
    if item.name in _OPENING:
        rel = _relative(cwd, item.args.get("path"))
        # A directory read is a listing, not a reading of its files.
        if rel and not (item.name == "read" and isinstance(item.result, str) and _is_listing(cwd, rel)):
            found.add(rel)
    # Searching a single file prints bare "line:text" lines, so the file is the argument itself.
    if item.name == "grep" and isinstance(item.result, str) and not item.result.startswith("No matches"):
        rel = _relative(cwd, item.args.get("path"))
        if rel and not _is_listing(cwd, rel):
            found.add(rel)
    command = item.args.get("command") if item.name == "bash" else None
    command = command if isinstance(command, str) else None
    # Search output from a shell that changed folder is relative to that folder.
    bases = [""] + [b.strip("'\"").rstrip("/") + "/" for b in _CD.findall(command or "")]
    if item.name in ("grep", "bash") and isinstance(item.result, str):
        for match in _HIT.finditer(item.result):
            hit = match.group(1).strip()
            for base in bases if item.name == "bash" else [""]:
                if rel := _relative(cwd, base + hit if not os.path.isabs(hit) else hit):
                    found.add(rel)
    return found, command


def _is_listing(cwd: str, rel: str) -> bool:
    try:
        return (Path(cwd) / rel).is_dir()
    except OSError:
        return False


def _session(session_id: str) -> _Session | None:
    """A session's project folder, creation time and tool call results, or None when it cannot be read.

    Parsed sessions are cached by the log's modification time and size, so polling does not re-read them.
    """
    try:
        if session_id.startswith(".") or any(c in session_id for c in "/\\\0"):
            return None
        folder = home_dir() / "sessions" / session_id
        stats = [os.stat(folder / name) for name in ("info.json", "items.jsonl")]
        stamp = tuple((st.st_mtime_ns, st.st_size) for st in stats)
        cached = _sessions.get(session_id)
        if cached and cached[0] == stamp:
            _sessions.move_to_end(session_id)
            return cached[1]
        info, records = file_storage().log.read(session_id)
        calls = []
        opened: set[str] = set()
        cards: set[str] = set()
        commands: list[str] = []
        for _, data in records:
            try:
                item = item_from_dict(data)
            except (ValueError, KeyError, TypeError):
                continue
            if isinstance(item, ToolCallItem):
                files, command = _opened(info.cwd, item)
                opened |= files
                if command:
                    commands.append(command)
                if item.name in ("edit", "write") and item.status == "done":
                    cards.update(_CARD.findall("\n".join(files)))
                if command and _WRITES.search(command):
                    cards.update(_CARD.findall(command))
            if isinstance(item, ToolCallItem) and isinstance(item.result, str):
                is_map = _is_map_record(item.args, item.result)
                # Lines that mention the map's folder are Alpine's own words (e.g. grep over the project).
                result = item.result
                if not is_map:
                    result = "\n".join(line for line in result.split("\n") if ".alpine" not in line.casefold())
                calls.append((item.id, result, is_map, item.name in _READING))
        session = _Session(
            info.cwd, info.created_at, info.updated_at, calls, frozenset(opened), tuple(commands), frozenset(cards)
        )
        _sessions[session_id] = (stamp, session)
        while len(_sessions) > _MAX_SESSIONS:
            _sessions.popitem(last=False)
        return session
    except (OSError, ValueError, LookupError):
        return None  # An unreadable session is the same as a missing one; it never breaks the map.


#: Tools whose output is a file's content or a search over files: an excerpt found there shows what the code says,
#: not what running it did (decision 14).
_READING = frozenset({"read", "grep", "glob"})


def _mismatch(reason: str) -> ObservationProvenance:
    return ObservationProvenance(label="mismatch", reason=reason)


def _same_project(root: Path, session: _Session) -> bool:
    try:
        return Path(session.cwd).resolve() == root
    except (OSError, ValueError):
        return False


def _check_tool_call(root: Path, observation: Observation) -> ObservationProvenance:
    source = observation.source
    session = _session(source.session_id) if source.session_id else None
    if session is None:
        return _mismatch("session_not_found")
    if not _same_project(root, session):
        return _mismatch("other_project")
    excerpt = " ".join(observation.excerpt.split())
    if not excerpt:
        return _mismatch("no_excerpt")
    if source.ref:
        mine = [call for call in session.calls if call[0] == source.ref]
        if not mine:
            return _mismatch("call_not_found")
        if mine[0][2]:
            return _mismatch("alpine_record")
    else:
        mine = session.calls
    own = False
    read: str | None = None
    for call_id, result, is_map, reading in mine:
        if contains(result, excerpt):
            if is_map:
                own = True
            elif not reading:
                return ObservationProvenance(label="verified", matched=call_id)
            elif read is None:
                read = call_id
    if read is not None:
        # The words were in a file the agent read or searched: real, but what the code says, not what it did.
        return ObservationProvenance(label="read", matched=read)
    return _mismatch("alpine_record" if own else "excerpt_missing")


def _digest(path: Path) -> str:
    """The file's SHA-256, cached by path, modification time and size."""
    st = path.stat()
    key = (str(path), st.st_mtime_ns, st.st_size)
    if key in _hashes:
        _hashes.move_to_end(key)
        return _hashes[key]
    digest = hashlib.sha256(read_bytes(path, 10 * LIMIT)).hexdigest()
    _hashes[key] = digest
    while len(_hashes) > _MAX_HASHES:
        _hashes.popitem(last=False)
    return digest


def _file_has(path: Path, digest: str, excerpt: str) -> bool:
    key = (digest, excerpt)
    if key not in _excerpts:
        text = read_bytes(path, 10 * LIMIT).decode("utf-8", errors="ignore")
        _excerpts[key] = contains(text, excerpt)
        while len(_excerpts) > _MAX_HASHES:
            _excerpts.popitem(last=False)
    return _excerpts[key]


def _in_session(session: _Session, mtime: float) -> bool:
    """Whether a file's modification time falls inside the session's lifetime (a missing end is open)."""
    try:
        created = datetime.fromisoformat(session.created_at).timestamp()
    except ValueError:
        return False
    if mtime < created - GRACE:
        return False
    try:
        return mtime <= datetime.fromisoformat(session.updated_at).timestamp() + GRACE
    except ValueError:
        return True


def _under_alpine(root: Path, path: Path) -> bool:
    try:
        parts = path.relative_to(root).parts
    except ValueError:
        return False
    return bool(parts) and parts[0].casefold() == ".alpine"


def _check_file(
    root: Path, key: str, observation: Observation, pins: dict[str, str], fresh: dict[str, str]
) -> tuple[ObservationProvenance, bool]:
    """Compares a cited project file with the hash pinned when it was first seen. True when verified."""
    source = observation.source
    try:
        path = inside(root, source.ref)
    except MethodError:
        return _mismatch("file_missing"), False
    if _under_alpine(root, path) or _under_alpine(root, root / os.path.normpath(source.ref)):
        return _mismatch("alpine_record"), False
    session = _session(source.session_id) if source.session_id else None
    if session is None:
        return _mismatch("session_not_found"), False
    if not _same_project(root, session):
        return _mismatch("other_project"), False
    try:
        digest = _digest(path)
        mtime = path.stat().st_mtime
    except (OSError, ValueError):
        return _mismatch("file_missing"), False
    pinned = pins.get(key)
    if pinned is None:
        if not _in_session(session, mtime):
            return _mismatch("outside_session"), False
        fresh[key] = digest
    elif pinned != digest:
        return _mismatch("file_changed"), False
    excerpt = " ".join(observation.excerpt.split())
    if not excerpt and observation.show not in ("image", "video"):
        return _mismatch("no_excerpt"), False
    try:
        if excerpt and not _file_has(path, digest, excerpt):
            return _mismatch("excerpt_missing"), False
    except (OSError, ValueError):
        return _mismatch("file_missing"), False
    return ObservationProvenance(label="verified"), True


def _pins_path(root: Path) -> Path:
    return local_dir(root) / "pins.json"


def _read_pins(path: Path) -> dict[str, str]:
    """Pinned file hashes for one project; the file is parsed again only when it changes."""
    try:
        st = path.stat()
    except OSError:
        _pin_cache.pop(str(path), None)
        return {}
    cached = _pin_cache.get(str(path))
    if cached and cached[:2] == (st.st_mtime_ns, st.st_size):
        return cached[2]
    pins: dict[str, str] = {}
    try:
        value = json.loads(read_bytes(path).decode("utf-8"))
        if isinstance(value, dict) and isinstance(value.get("pins"), dict):
            pins = {k: v for k, v in value["pins"].items() if isinstance(k, str) and isinstance(v, str)}
    except (OSError, ValueError):
        pass  # A corrupt pins file starts fresh.
    _pin_cache[str(path)] = (st.st_mtime_ns, st.st_size, pins)
    return pins


def _write_pins(path: Path, fresh: dict[str, str], live: set[str]) -> None:
    """Merges new pins into the file, re-reading it under a lock; over the cap, pins no check uses go first."""
    with file_lock(path):
        pins = {**_read_pins(path), **fresh}
        extra = len(pins) - _MAX_PINS
        if extra > 0:
            dead = [k for k in pins if k not in live]
            drop = set(dead[:extra])
            if len(drop) < extra:
                drop.update([k for k in pins if k not in drop][: extra - len(drop)])
            pins = {k: v for k, v in pins.items() if k not in drop}
        try:
            atomic(path, json.dumps({"pins": pins}, ensure_ascii=False))
            st = path.stat()
            _pin_cache[str(path)] = (st.st_mtime_ns, st.st_size, pins)
        except OSError:
            _pin_cache.pop(str(path), None)  # Pins are best effort; the next read pins again.


def _stat(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
    except (OSError, ValueError):
        return None
    return st.st_mtime_ns, st.st_size


def _signature(root: Path, card: FeatureFile, digest: str, pins: Path) -> tuple:
    """Everything the labels of one card depend on, cheaply: its file, the sessions and files it cites, the pins."""
    cited = []
    for check in card.checks:
        for observation in check.observations:
            source = observation.source
            if source is None:
                continue
            sid = source.session_id or ""
            logs = tuple(_stat(home_dir() / "sessions" / sid / n) for n in ("info.json", "items.jsonl")) if sid else ()
            target = _stat(root / source.ref) if source.kind == "file" and source.ref else None
            cited.append((sid, logs, target))
    return digest, _stat(pins), tuple(cited)


# Labels per card: (root, card id) -> (signature, labels), so an unchanged card is not compared again each poll.
_memo: dict[tuple[str, str], tuple[tuple, dict[str, list[ObservationProvenance]]]] = {}


def evidence(
    root: Path,
    cards: Iterable[FeatureFile],
    *,
    images: bool = False,
    persist: bool = True,
    digests: dict[str, str] | None = None,
) -> tuple[dict[str, list[ObservationProvenance]], dict[str, str]]:
    """Labels for every shown observation keyed ``<nodeId>/<conditionId>``, plus (when asked) image observations
    loaded from verified project files keyed ``<nodeId>/<conditionId>/<index>``."""
    pins_path = _pins_path(root)
    pins = _read_pins(pins_path)
    fresh: dict[str, str] = {}
    live: set[str] = set()
    provenance: dict[str, list[ObservationProvenance]] = {}
    found: dict[str, str] = {}
    budget = 6 * 1024 * 1024
    for card in cards:
        sig = None
        if digests is not None and not images and card.id in digests:
            sig = _signature(root, card, digests[card.id], pins_path)
            hit = _memo.get((str(root), card.id))
            if hit and hit[0] == sig:
                provenance.update(hit[1])
                continue
        before = len(provenance)
        for cid, check in current_checks(card).items():
            labels = []
            run = check_id(check)
            for index, observation in enumerate(check.observations):
                source = observation.source
                verified_file = False
                if source is None:
                    label = ObservationProvenance(label="agent")
                elif source.kind == "tool_call":
                    label = _check_tool_call(root, observation)
                elif source.kind == "file":
                    pin = f"{card.id}/{cid}/{run}/{source.ref}"
                    live.add(pin)
                    label, verified_file = _check_file(root, pin, observation, pins, fresh)
                else:
                    label = _mismatch("surface_not_found")  # Step 5 replaces this with a lookup in the surface log.
                labels.append(label)
                if images and verified_file and observation.show == "image":
                    if loaded := image(root, source.ref, budget):
                        found[f"{card.id}/{cid}/{index}"], size = loaded
                        budget -= size
            provenance[f"{card.id}/{cid}"] = labels
        if sig is not None and not fresh:
            _memo[(str(root), card.id)] = (sig, dict(list(provenance.items())[before:]))
    if fresh and persist:
        _write_pins(pins_path, fresh, live)
    return provenance, found


def verified_excerpts(check: FlowCheck, labels: list[ObservationProvenance]) -> list[str]:
    """Excerpts Alpine verified from the original tool calls of this check."""
    return [
        o.excerpt
        for o, label in zip(check.observations, labels, strict=False)
        if label.label == "verified" and o.source is not None and o.source.kind == "tool_call" and o.excerpt.strip()
    ]


# ---------------------------------------------------------------- sources the writer never opened


def _named(command: str, source: str) -> bool:
    """Whether a shell command names the file, from the project folder or after a plain ``cd``."""
    if source in command:
        return True
    for folder in _CD.findall(command):
        base = folder.strip("'\"").rstrip("/")
        if base and source.startswith(base + "/") and source[len(base) + 1 :] in command:
            return True
    return False


def _seen(source: str, opened: set[str], commands: list[str]) -> bool:
    if source in opened or any(p.startswith(source + "/") for p in opened):
        return True
    return any(_named(c, source) for c in commands)


def unread(
    root: Path, cards: dict[str, FeatureFile], last_writers: dict[str, str | None], session_ids: Iterable[str]
) -> dict[str, list[str]]:
    """Per card, the sources none of its Alpine writers opened, when its last write was one of theirs. Otherwise
    nothing is known (an outside agent or an editor wrote it), and nothing is listed."""
    if not any(card.sources for card in cards.values()):
        return {}
    sessions = [(sid, s) for sid in list(session_ids)[:_MAX_SESSIONS] if (s := _session(sid)) is not None]
    sessions = [(sid, s) for sid, s in sessions if _same_project(root, s)]
    out: dict[str, list[str]] = {}
    for card_id, card in cards.items():
        last = last_writers.get(card_id)
        if not last or not card.sources:
            continue
        ids = {sid for sid, s in sessions if card_id in s.cards}
        if last not in ids:
            continue
        mine = [s for sid, s in sessions if sid in ids]
        opened = set().union(*(s.opened for s in mine))
        commands = [c for s in mine for c in s.commands]
        missed = [
            raw
            for raw in card.sources
            if (source := _relative(str(root), raw) or os.path.normpath(raw).replace(os.sep, "/").strip("/"))
            and not _seen(source, opened, commands)
        ]
        if missed:
            out[card_id] = missed
    return out
