"""Alpine's own records next to the map: stamps, witness, results, user decisions, computed states, history."""

from __future__ import annotations

import contextlib
import copy
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from alpine_core import SessionInfo, file_storage
from alpine_protocol import (
    CheckStamp,
    FeatureFile,
    FlowChange,
    FlowCheck,
    FlowCondition,
    NodeState,
    ObservationProvenance,
    PromiseState,
    RemovedCard,
    RemovedPromise,
    ReplayState,
)

from . import map_git
from .map_evidence import check_id, current_checks
from .map_files import STATE, Layout
from .map_io import (
    atomic,
    canonical,
    dump,
    file_digest,
    file_lock,
    inside,
    iso,
    local_dir,
    lpath,
    parse_time,
    read_json,
    sha,
)
from .map_replay import command_key
from .methods import APP_ERROR, MethodError

FORMAT = 1
_GRACE = 2.0
_KEEP_RESULTS = 50
_MAX_CHANGES = 200
_LIVE = ("running", "waiting")
_PROJECT = f"{STATE}/project.json"


def _object(value: object) -> dict:
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def load_project(root: Path) -> dict:
    state = {
        "formatVersion": FORMAT,
        "include": [],
        "syncCommit": None,
        "syncSession": None,
        "syncStarted": None,
    }
    state.update(_object(read_json(inside(root, _PROJECT))))
    if not isinstance(state["include"], list):
        state["include"] = []
    state["include"] = [p for p in state["include"] if isinstance(p, str)]
    return state


def save_project(root: Path, state: dict) -> None:
    atomic(lpath(root, _PROJECT), dump(state))


def card_path(root: Path, node_id: str) -> Path:
    return inside(root, f"{STATE}/cards/{node_id}.json")


def load_card(root: Path, node_id: str) -> dict:
    state = {"formatVersion": FORMAT, "plan": {}, "sessionId": None, "promises": {}, "stamps": {}, "texts": {}}
    state.update(_object(read_json(card_path(root, node_id))))
    for key in ("plan", "promises", "stamps", "texts"):
        if not isinstance(state[key], dict):
            state[key] = {}
    return state


def save_card(root: Path, node_id: str, state: dict) -> None:
    atomic(lpath(root, f"{STATE}/cards/{node_id}.json"), dump(state))


def card_ids(root: Path) -> list[str]:
    """Cards Alpine keeps records for, including cards no longer in the map."""
    folder = inside(root, f"{STATE}/cards")
    return sorted(p.stem for p in folder.glob("*.json")) if folder.is_dir() else []


def remember(state: dict, card: FeatureFile) -> None:
    """Keeps the card's title next to the user's decisions, so a card the agent removes can still be named."""
    state["title"] = card.title


def _user_promises(state: dict) -> dict[str, str]:
    """Promise id -> the user's text, for promises the user wrote or confirmed (and Alpine kept the text)."""
    found = {}
    for cid, promise in state["promises"].items():
        confirmed = promise.get("confirmed") if isinstance(promise, dict) else None
        if isinstance(confirmed, dict) and isinstance(confirmed.get("text"), str) and confirmed["text"]:
            found[cid] = confirmed["text"]
    return found


def decided(state: dict) -> bool:
    """The user decided something about this card: a plan, a text, or a call on a promise."""
    return bool(
        state["plan"]
        or state["texts"]
        or any(isinstance(p, dict) and _decisions(p) for p in state["promises"].values())
    )


def removed_cards(root: Path, present: Iterable[str]) -> list[RemovedCard]:
    """Cards the user decided something about that are no longer in the map (decision 16)."""
    here = set(present)
    gone = []
    for card_id in card_ids(root):
        if card_id in here:
            continue
        state = load_card(root, card_id)
        if decided(state):
            title = (state["texts"].get("title") or {}).get("text") or state.get("title") or card_id
            gone.append(RemovedCard(id=card_id, title=str(title)))
    return gone


def rebuilt_card(root: Path, card_id: str) -> FeatureFile:
    """A removed card put back from what the user decided: its title, their sentences and their promises."""
    state = load_card(root, card_id)
    texts = state["texts"]
    title = (texts.get("title") or {}).get("text") or state.get("title") or card_id
    return FeatureFile(
        id=card_id,
        title=str(title)[:120],
        how_to_try=str((texts.get("howToTry") or {}).get("text", ""))[:1000],
        conditions=[FlowCondition(id=cid, expectation=text) for cid, text in _user_promises(state).items()],
    )


def state_files(root: Path) -> dict[str, str]:
    """Project-relative path -> content hash of Alpine's shared state files."""
    found: dict[str, str] = {}
    folder = inside(root, STATE)
    paths = [folder / "project.json", *sorted((folder / "cards").glob("*.json"))] if folder.is_dir() else []
    for path in paths:
        if path.is_file():
            found[path.relative_to(root).as_posix()] = file_digest(path)
    return found


# ---------------------------------------------------------------- witness (this computer only)


def _witness_path(root: Path) -> Path:
    return local_dir(root) / "witness.json"


def load_witness(root: Path) -> dict[str, str]:
    value = _object(read_json(_witness_path(root)))
    return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str)}


def update_witness(root: Path, witness: dict[str, str], updates: dict[str, str], deletes: tuple[str, ...] = ()) -> None:
    """Merges into the stored witness under a lock, so another process's entries are kept."""
    path = _witness_path(root)
    with file_lock(path):
        current = load_witness(root)
        current.update(updates)
        for key in deletes:
            current.pop(key, None)
        atomic(path, dump(current))
    witness.clear()
    witness.update(current)


def stamp_digest(stamp: dict) -> str:
    return sha(canonical(stamp))


def witness_of(witness: dict[str, str], node_id: str, cond_id: str, run: str, stamp: dict) -> str:
    known = witness.get(f"{node_id}/{cond_id}/{run}")
    if known is None:
        return "other"
    return "mine" if known == stamp_digest(stamp) else "mismatch"


def _decisions(promise: dict) -> dict:
    return {k: promise[k] for k in ("confirmed", "plan", "user") if promise.get(k)}


def decision_status(witness: dict[str, str], node_id: str, cond_id: str, promise: dict) -> str:
    """none: nothing decided. mine / other / mismatch: as for stamps, for the user's calls on one promise."""
    decided = _decisions(promise)
    if not decided:
        return "none"
    known = witness.get(f"decision:{node_id}/{cond_id}")
    if known is None:
        return "other"
    return "mine" if known == sha(canonical(decided)) else "mismatch"


def witness_decisions(root: Path, witness: dict[str, str], node_id: str, cond_id: str, promise: dict) -> None:
    key = f"decision:{node_id}/{cond_id}"
    decided = _decisions(promise)
    if decided:
        update_witness(root, witness, {key: sha(canonical(decided))})
    else:
        update_witness(root, witness, {}, (key,))


# ---------------------------------------------------------------- sessions

#: Ids of sessions running in this process. The server sets it; a session shown as running on disk that is not in
#: it died with its process (the same rule as the session list). None: trust the disk.
live_ids: Callable[[], set[str]] | None = None
_SESSION_TTL = 2.0
_listed: dict[str, tuple[float, list[SessionInfo]]] = {}


def is_live(info: SessionInfo) -> bool:
    if info.status not in _LIVE:
        return False
    return live_ids is None or info.id in live_ids()


def project_sessions(root: Path) -> list[SessionInfo]:
    """Stored sessions of this project, most recently updated first."""
    cached = _listed.get(str(root))
    if cached and time.monotonic() - cached[0] < _SESSION_TTL:
        return list(cached[1])
    try:
        infos = file_storage().log.list()
    except (OSError, ValueError, LookupError):
        return []
    found = []
    for info in infos:
        try:
            if Path(info.cwd).resolve() == root:
                found.append(info)
        except (OSError, ValueError):
            continue
    _listed[str(root)] = (time.monotonic(), found)
    return list(found)


def busy(sessions: Iterable[SessionInfo]) -> bool:
    return any(is_live(s) for s in sessions)


def session_at(sessions: Iterable[SessionInfo], when: float) -> str | None:
    """The most recently updated session whose lifetime contains the moment."""
    for info in sessions:
        created, updated = parse_time(info.created_at), parse_time(info.updated_at)
        if created is not None and when < created - _GRACE:
            continue
        if is_live(info) or updated is None or when <= updated + _GRACE:
            return info.id
    return None


# ---------------------------------------------------------------- stamping


def _paths(check: FlowCheck) -> list[str]:
    return list(dict.fromkeys(check.depends_on))


def _newest(root: Path, relative: str) -> float:
    try:
        path = inside(root, relative)
        if path.is_dir():
            return max([path.stat().st_mtime, *(p.stat().st_mtime for p in path.rglob("*") if p.is_file())])
        return path.stat().st_mtime
    except (OSError, MethodError, ValueError):
        return 0.0


def _labels(labels: list[ObservationProvenance]) -> list[dict]:
    return [label.model_dump(mode="json", by_alias=True) for label in labels]


def _trim(results: list[dict]) -> list[dict]:
    kept = results[:_KEEP_RESULTS]
    for wanted in ("passed", "failed"):
        if not any(r.get("result") == wanted for r in kept):
            newest = next((r for r in results[_KEEP_RESULTS:] if r.get("result") == wanted), None)
            if newest:
                kept.append(newest)
    return kept


def stamp_all(
    root: Path,
    layout: Layout,
    cards: dict[str, dict],
    labels: dict[str, list[ObservationProvenance]],
    sessions: list[SessionInfo],
    witness: dict[str, str],
) -> list[FlowChange]:
    """Records Alpine's facts for checks it has not seen, and refreshes labels it witnessed itself. Writes files."""
    changes: list[FlowChange] = []
    commit = map_git.head(root)
    updates: dict[str, str] = {}
    deletes: list[str] = []
    for card_id, card in layout.features.items():
        state = cards[card_id]
        dirty = False
        for cid, check in current_checks(card).items():
            run = check_id(check)
            slot = f"{cid}/{run}"
            stamps = state["stamps"]
            live = _labels(labels.get(f"{card_id}/{cid}", []))
            stamp = stamps.get(slot)
            if stamp is not None:
                if (
                    isinstance(stamp, dict)
                    and witness_of(witness, card_id, cid, run, stamp) == "mine"
                    and stamp.get("provenance") != live
                ):
                    stamp["provenance"] = live
                    updates[f"{card_id}/{slot}"] = stamp_digest(stamp)
                    dirty = True
                continue
            written = layout.mtimes.get(card_id, 0.0)
            found = session_at(sessions, written)
            paths = _paths(check)
            stamp = {
                "at": iso(written) if found else iso(),
                "sessionId": found,
                "firstSeen": found is None,
                "uncertain": any(_newest(root, p) > written + _GRACE for p in paths),
                "hashes": map_git.hashes(root, paths),
                "commit": commit,
                "provenance": live,
            }
            stamps[slot] = stamp
            updates[f"{card_id}/{slot}"] = stamp_digest(stamp)
            promise = state["promises"].setdefault(cid, {})
            results = promise.setdefault("results", [])
            if not any(r.get("checkId") == run for r in results):
                results.insert(0, {"checkId": run, "result": check.result, "at": stamp["at"]})
                promise["results"] = _trim(results)
            if check.result == "passed" and promise.get("user"):
                # A pass ends the user's later / wontfix call. Re-witness it only when it was this computer's.
                before = decision_status(witness, card_id, cid, promise)
                promise["user"] = None
                if before == "mine":
                    key = f"decision:{card_id}/{cid}"
                    decided = _decisions(promise)
                    if decided:
                        updates[key] = sha(canonical(decided))
                    else:
                        deletes.append(key)
            expectation = next((c.expectation for c in card.conditions if c.id == cid), cid)
            changes.append(
                FlowChange(
                    at=stamp["at"],
                    node_id=card_id,
                    title=card.title,
                    kind=f"check_{check.result}",
                    detail=check.plain or expectation,
                )
            )
            dirty = True
        if dirty:
            keep = {f"{c}/{r.get('checkId')}" for c, p in state["promises"].items() for r in p.get("results", [])}
            keep |= {f"{c}/{check_id(k)}" for c, k in current_checks(card).items()}
            state["stamps"] = {k: v for k, v in state["stamps"].items() if k in keep}
            save_card(root, card_id, state)
    if updates or deletes:
        update_witness(root, witness, updates, tuple(deletes))
    return changes


# ---------------------------------------------------------------- states


def _hash_changed(root: Path, before: dict[str, str], paths: Iterable[str]) -> list[str]:
    return [p for p in paths if map_git.path_hash(root, p) != before.get(p, "")]


@dataclass
class Replays:
    """What this computer knows about replays: approvals, last runs and what is running now."""

    approvals: dict[str, str] = field(default_factory=dict)
    records: dict[str, dict] = field(default_factory=dict)
    running: set[str] = field(default_factory=set)


def _streak(results: list[dict], index: int) -> str | None:
    """When the failing run that ends at ``index`` began."""
    start = index
    while start + 1 < len(results) and results[start + 1].get("result") == "failed":
        start += 1
    return results[start].get("at")


def promise_state(
    root: Path,
    card: FeatureFile,
    condition_id: str,
    expectation: str,
    check: FlowCheck | None,
    state: dict,
    witness: dict[str, str],
    replays: Replays,
) -> PromiseState:
    promise = state["promises"].get(condition_id) or {}
    trust = decision_status(witness, card.id, condition_id, promise)
    if trust == "mismatch":  # edited since this computer wrote it: the call is ignored
        promise = {k: v for k, v in promise.items() if k not in ("confirmed", "plan", "user")}
    confirmed = promise.get("confirmed") or {}
    if promise.get("plan"):
        origin = "plan"
    elif confirmed.get("hash") == sha(expectation):
        origin = "confirmed"
    else:
        origin = "inferred"
    reworded = bool(confirmed.get("hash")) and confirmed.get("hash") != sha(expectation)
    user = promise.get("user") if isinstance(promise.get("user"), dict) else None
    results = [r for r in promise.get("results", []) if isinstance(r, dict)]
    run = check_id(check) if check else ""
    stamp = state["stamps"].get(f"{condition_id}/{run}") if check else None
    stamp = stamp if isinstance(stamp, dict) else None
    paths = _paths(check) if check else []
    changed = _hash_changed(root, stamp.get("hashes", {}), paths) if stamp else []
    slot = f"{card.id}/{condition_id}"
    replay = check.replay if check else None
    approved = bool(replay and replays.approvals.get(slot) == command_key(replay))
    record = replays.records.get(slot)
    exempt = bool(
        approved
        and paths
        and record
        and record.get("checkId") == run
        and record.get("same") is True
        and record.get("hashes") == map_git.hashes(root, paths)
    )
    if check is None:
        status = "unconfirmed"
    elif check.expectation != expectation:
        status = "recheck"
    elif stamp is None:
        status = check.result  # nothing recorded yet (a map Alpine may not write): the agent's word
    elif (not paths or changed or stamp.get("uncertain")) and not exempt:
        status = "recheck"
    else:
        status = check.result
    failing = check is not None and (status == "failed" or (status == "recheck" and check.result == "failed"))
    index = next((i for i, r in enumerate(results) if r.get("checkId") == run), -1)
    older = results[index + 1 :] if index >= 0 else results
    issue, since, reason = "", None, ""
    if failing and user and user.get("state") == "wontfix":
        issue, since, reason = "wontfix", user.get("at"), str(user.get("reason", ""))
    elif failing and user and user.get("state") == "later":
        moved = _hash_changed(root, user.get("hashes", {}), list(user.get("hashes", {})))
        issue, since = ("maybe_fixed" if moved else "later"), user.get("at")
    elif failing:
        since = _streak(results, index) if index >= 0 else None
        if origin == "inferred":
            issue = "question"
        else:
            issue = "regressed" if any(r.get("result") == "passed" for r in older) else "open"
            if changed and not exempt:
                issue = "maybe_fixed"
    elif status == "passed" and any(r.get("result") == "failed" for r in older):
        issue = "resolved"
        since = results[index].get("at") if index >= 0 else None
    shown = None
    if stamp:
        shown = CheckStamp(
            at=str(stamp.get("at", "")),
            session_id=stamp.get("sessionId"),
            first_seen=bool(stamp.get("firstSeen")),
            witness=witness_of(witness, card.id, condition_id, run, stamp),
            uncertain=bool(stamp.get("uncertain")),
        )
    shown_replay = None
    if replay:
        shown_replay = ReplayState(
            approved=approved,
            running=slot in replays.running,
            at=record.get("at") if record else None,
            same=record.get("same") if record else None,
            output=str(record.get("output", "")) if record else "",
            key=command_key(replay),
        )
    return PromiseState(
        status=status,
        issue=issue,
        origin=origin,
        reason=reason,
        since=since,
        stamp=shown,
        changed=changed,
        replay=shown_replay,
        reworded=reworded,
        mine=str(confirmed.get("text") or "") if reworded else "",
        written=origin == "confirmed" and bool(confirmed.get("written")),
        decided_elsewhere=trust == "other",
    )


def _missing(root: Path, card: FeatureFile) -> list[str]:
    wanted = list(dict.fromkeys([*card.sources, *(p for c in card.checks for p in c.depends_on)]))
    gone = []
    for relative in wanted:
        try:
            if not inside(root, relative).exists():
                gone.append(relative)
        except (MethodError, OSError):
            gone.append(relative)
    return gone


def node_state(root: Path, card: FeatureFile, state: dict, witness: dict[str, str], replays: Replays) -> NodeState:
    checks = current_checks(card)
    promises = {
        c.id: promise_state(root, card, c.id, c.expectation, checks.get(c.id), state, witness, replays)
        for c in card.conditions
    }
    passed = sum(1 for p in promises.values() if p.status == "passed")
    issues = {p.issue for p in promises.values()}
    current = {"title": card.title, "howToTry": card.how_to_try}
    overridden = {
        name: str(saved.get("text", ""))
        for name, saved in state["texts"].items()
        if name in current and isinstance(saved, dict) and saved.get("text", "") != current[name]
    }
    present = {c.id for c in card.conditions}
    gone = [RemovedPromise(id=cid, text=text) for cid, text in _user_promises(state).items() if cid not in present]
    if issues & {"open", "regressed", "maybe_fixed"}:
        status = "failed"
    elif "question" in issues:
        status = "question"
    elif any(p.status == "recheck" for p in promises.values()):
        status = "recheck"
    elif not promises:
        status = "none"
    elif passed < len(promises):
        status = "unconfirmed"
    else:
        status = "passed"
    return NodeState(
        status=status,
        passed=passed,
        total=len(promises),
        promises=promises,
        changed=any(p.changed for p in promises.values()),
        missing=_missing(root, card),
        overridden=overridden,
        removed_promises=gone,
    )


def compute_states(
    root: Path, layout: Layout, cards: dict[str, dict], witness: dict[str, str], replays: Replays
) -> dict[str, NodeState]:
    return {
        card_id: node_state(root, card, cards[card_id], witness, replays)
        for card_id, card in sorted(layout.features.items())
    }


# ---------------------------------------------------------------- user decisions


def apply_promise(
    root: Path, card: FeatureFile, state: dict, condition_id: str, action: str, reason: str, witness: dict[str, str]
) -> FlowChange | None:
    """Changes the user's call on one promise inside ``state``; returns the history entry, if any."""
    condition = next(c for c in card.conditions if c.id == condition_id)
    promise = state["promises"].setdefault(condition_id, {})
    if decision_status(witness, card.id, condition_id, promise) == "mismatch":
        for key in ("confirmed", "plan", "user"):  # an edited call is not carried along
            promise.pop(key, None)
    at = iso()
    kind, detail = None, condition.expectation
    if action == "confirm":
        promise["confirmed"] = {"hash": sha(condition.expectation), "at": at, "text": condition.expectation}
        kind = "promise_confirmed"
    elif action == "unconfirm":
        promise["confirmed"] = None
    elif action in ("later", "wontfix"):
        if action == "wontfix" and not reason.strip():
            raise MethodError(APP_ERROR, "Say why you will not fix it", "reason_required")
        check = current_checks(card).get(condition_id)
        paths = [*(check.depends_on if check else []), *card.sources]
        promise["user"] = {
            "state": action,
            "reason": reason.strip(),
            "at": at,
            "hashes": map_git.hashes(root, paths),
        }
        kind = f"issue_{action}"
        detail = reason.strip() or condition.expectation
    elif action == "reopen":
        promise["user"] = None
        kind = "issue_reopened"
    if kind is None:
        return None
    return FlowChange(at=at, node_id=card.id, title=card.title, kind=kind, detail=detail)  # type: ignore[arg-type]


def set_plan(state: dict, field_name: str, value: str | None) -> None:
    plan = state["plan"]
    if value in (None, ""):
        plan.pop(field_name, None)
    else:
        plan[field_name] = value


# ---------------------------------------------------------------- history (this computer only)


def _snapshot(layout: Layout) -> dict[str, Any]:
    return {
        "nodes": [
            {
                "id": c.id,
                "title": c.title,
                "phase": c.phase,
                "conditions": [[x.id, x.expectation] for x in c.conditions],
            }
            for c in layout.features.values()
        ],
        "exclude": list(layout.map.exclude),
    }


def _diff(old: dict, new: dict, at: str) -> list[FlowChange]:
    """Plain facts about what changed between two snapshots; the UI words them."""
    changes: list[FlowChange] = []

    def add(node: dict, kind: str, detail: str = "") -> None:
        changes.append(FlowChange(at=at, node_id=node["id"], title=node["title"], kind=kind, detail=detail))  # type: ignore[arg-type]

    before = {n["id"]: n for n in old.get("nodes", [])}
    after = {n["id"] for n in new["nodes"]}
    for node in new["nodes"]:
        previous = before.get(node["id"])
        if previous is None:
            add(node, "added", node["phase"])
            continue
        if node["phase"] != previous["phase"]:
            add(node, "phase", f"{previous['phase']} -> {node['phase']}")
        known = {cid: text for cid, text in previous.get("conditions", [])}
        for cid, text in node["conditions"]:
            if cid not in known:
                add(node, "promise_added", text)
            elif known[cid] != text:
                add(node, "promise_changed", text)
    for node in old.get("nodes", []):
        if node["id"] not in after:
            add(node, "removed", node["phase"])
    if sorted(old.get("exclude", [])) != sorted(new["exclude"]):
        changes.append(
            FlowChange(at=at, node_id="", title="", kind="exclude_changed", detail=", ".join(new["exclude"]))
        )
    return changes


def _history_path(root: Path) -> Path:
    return local_dir(root) / "history.json"


def _stored_history(root: Path) -> tuple[dict | None, list[FlowChange]]:
    value = read_json(_history_path(root), 3 * 2 * 1024 * 1024)
    if not isinstance(value, dict):
        return None, []
    try:
        changes = [FlowChange.model_validate(c) for c in value.get("changes", [])]
        snapshot = value["snapshot"]
        if not isinstance(snapshot, dict):
            raise TypeError
    except (KeyError, TypeError, ValueError):
        return None, []
    return snapshot, changes


def _write_history(root: Path, snapshot: dict, changes: list[FlowChange]) -> None:
    data = {"snapshot": snapshot, "changes": [c.model_dump(mode="json", by_alias=True) for c in changes]}
    try:
        atomic(_history_path(root), dump(data))
    except OSError:
        pass  # History is best effort and never blocks reading.


def history(root: Path, layout: Layout, extra: list[FlowChange], *, write: bool = True) -> list[FlowChange]:
    """Records what changed since the last stored snapshot, plus ``extra``; returns the newest 200."""
    snapshot = _snapshot(layout)
    with file_lock(_history_path(root)) if write else contextlib.nullcontext():
        previous, changes = _stored_history(root)
        fresh = _diff(previous, snapshot, iso()) if previous is not None else []
        new = [*extra, *fresh]
        if write and (new or previous != snapshot):
            changes = [*new, *changes][:_MAX_CHANGES]
            _write_history(root, snapshot, changes)
    return changes[:_MAX_CHANGES]


def add_changes(root: Path, layout: Layout, new: list[FlowChange]) -> None:
    """Adds changes made through the app (decisions, replays) to the history."""
    if not new:
        return
    with file_lock(_history_path(root)):
        snapshot, changes = _stored_history(root)
        _write_history(root, snapshot if snapshot is not None else _snapshot(layout), [*new, *changes][:_MAX_CHANGES])


# ---------------------------------------------------------------- schedule (this computer only)


def load_schedule(root: Path) -> dict:
    value = _object(read_json(local_dir(root) / "schedule.json"))
    limit = value.get("limit")
    return {
        "enabled": bool(value.get("enabled")),
        "limit": limit if isinstance(limit, int) and 1 <= limit <= 500 else 20,
        "lastRun": value.get("lastRun") if isinstance(value.get("lastRun"), str) else None,
    }


def save_schedule(root: Path, value: dict) -> None:
    atomic(local_dir(root) / "schedule.json", dump(value))
