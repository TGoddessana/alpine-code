"""Reading the map layout (.alpine/map/): per-file parsing with problems, newer-format fallback, assembly, overview."""

from __future__ import annotations

import json
import types
import typing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ValidationError

from alpine_protocol import (
    FeatureFile,
    FlowEdge,
    FlowFile,
    FlowNode,
    MapFile,
    MapProblem,
    NodeState,
    ProductFlow,
    ProductMap,
)

from .map_io import MAP_DIR, atomic, guard, inside, lpath, read_bytes, sha
from .methods import MethodError

FORMAT = 1
MAP_FILE = f"{MAP_DIR}/map.json"
FEATURES = f"{MAP_DIR}/features"
FLOWS = f"{MAP_DIR}/flows"
STATE = f"{MAP_DIR}/state"
OVERVIEW = f"{MAP_DIR}/OVERVIEW.md"
OVERVIEW_DIR = f"{MAP_DIR}/overview"
SCHEMA_DIR = f"{MAP_DIR}/schema"


@dataclass
class Layout:
    exists: bool = False
    read_only: bool = False
    map: MapFile = field(default_factory=MapFile)
    features: dict[str, FeatureFile] = field(default_factory=dict)
    """Cards by id, references already cleaned. An old card's area is read as a tag."""
    mtimes: dict[str, float] = field(default_factory=dict)
    """Modification time of each card's file."""
    flows: list[FlowFile] = field(default_factory=list)
    problems: list[MapProblem] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)
    """Project-relative path -> content hash of every agent-owned file."""


# Parsed files: path -> (mtime_ns, size, lenient, digest, model or error text).
_parsed: dict[str, tuple[int, int, bool, str, Any]] = {}


def _prune(annotation: Any, value: Any) -> Any:
    """The value without keys the model does not know (a newer Alpine may have added some)."""
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)
    if origin in (typing.Union, types.UnionType):
        for arg in args:
            if arg is not type(None) and value is not None:
                return _prune(arg, value)
        return value
    if origin is list and isinstance(value, list):
        return [_prune(args[0], v) for v in value]
    if origin is dict and isinstance(value, dict):
        return {k: _prune(args[1], v) for k, v in value.items()}
    if isinstance(annotation, type) and issubclass(annotation, BaseModel) and isinstance(value, dict):
        known: dict[str, Any] = {}
        for name, info in annotation.model_fields.items():
            for key in (info.alias or name, name):
                if key in value:
                    known[key] = _prune(info.annotation, value[key])
                    break
        return known
    return value


def _read(path: Path) -> tuple[str, bytes | None]:
    try:
        return sha(read_bytes(path)), None
    except (OSError, ValueError) as exc:
        return "", str(exc).encode()


def _load(root: Path, relative: str, model: type[BaseModel], lenient: bool) -> tuple[str, Any]:
    """(content hash, parsed model or error text) for one file, cached by modification time and size."""
    try:
        path = inside(root, relative)
        st = path.stat()
    except (OSError, ValueError, MethodError) as exc:
        return "", str(exc)
    cached = _parsed.get(str(path))
    if cached and cached[:3] == (st.st_mtime_ns, st.st_size, lenient) and cached[4] is not None:
        return cached[3], cached[4]
    digest, error = _read(path)
    if error is not None:
        return "", error.decode()
    try:
        data = json.loads(read_bytes(path).decode("utf-8"))
        if lenient and isinstance(data, dict):
            data = _prune(model, data)
            if model is MapFile:
                data["formatVersion"] = FORMAT
        result: Any = model.model_validate(data)
    except (OSError, ValueError, ValidationError) as exc:
        result = _short(exc)
    _parsed[str(path)] = (st.st_mtime_ns, st.st_size, lenient, digest, result)
    return digest, result


def _short(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        first = exc.errors()[0]
        where = ".".join(str(p) for p in first["loc"])
        return f"{where}: {first['msg']}" if where else str(first["msg"])
    return str(exc)


def _names(root: Path, relative: str) -> list[str]:
    folder = inside(root, relative)
    try:
        return sorted(p.name for p in folder.iterdir() if p.suffix == ".json" and not p.name.startswith("."))
    except OSError:
        return []


def read_layout(root: Path) -> Layout:
    """Everything the agent wrote, parsed file by file. A file that fails becomes a problem and is skipped."""
    inside(root, MAP_DIR)  # a link out of the project is refused outright
    layout = Layout()
    map_path = inside(root, MAP_FILE)
    layout.exists = map_path.is_file() or inside(root, FEATURES).is_dir()
    if not layout.exists:
        return layout
    problems = layout.problems
    if map_path.is_file():
        try:
            raw = json.loads(read_bytes(map_path).decode("utf-8"))
            version = raw.get("formatVersion") if isinstance(raw, dict) else None
            layout.read_only = isinstance(version, int) and version > FORMAT
        except (OSError, ValueError):
            pass  # the strict parse below reports it
        digest, parsed = _load(root, MAP_FILE, MapFile, layout.read_only)
        layout.files[MAP_FILE] = digest
        if isinstance(parsed, MapFile):
            layout.map = parsed
        else:
            problems.append(MapProblem(file=MAP_FILE, message=str(parsed)))
    lenient = layout.read_only
    cards: dict[str, FeatureFile] = {}
    for name in _names(root, FEATURES):
        relative = f"{FEATURES}/{name}"
        digest, parsed = _load(root, relative, FeatureFile, lenient)
        layout.files[relative] = digest
        if not isinstance(parsed, FeatureFile):
            problems.append(MapProblem(file=relative, message=str(parsed)))
        elif parsed.id != name.removesuffix(".json"):
            problems.append(MapProblem(file=relative, message=f"The file name must be the card id ({parsed.id})"))
        else:
            cards[parsed.id] = parsed
            try:
                layout.mtimes[parsed.id] = inside(root, relative).stat().st_mtime
            except OSError:
                layout.mtimes[parsed.id] = 0.0
    flows: list[FlowFile] = []
    for name in _names(root, FLOWS):
        relative = f"{FLOWS}/{name}"
        digest, parsed = _load(root, relative, FlowFile, lenient)
        layout.files[relative] = digest
        if not isinstance(parsed, FlowFile):
            problems.append(MapProblem(file=relative, message=str(parsed)))
        elif parsed.id != name.removesuffix(".json"):
            problems.append(MapProblem(file=relative, message=f"The file name must be the flow id ({parsed.id})"))
        else:
            flows.append(parsed)
    # Maps made before tags grouped cards into areas listed in map.json: the area's title becomes a tag.
    titles = {a.get("id"): a.get("title") for a in layout.map.areas if isinstance(a, dict)}
    for card in list(cards.values()):
        if card.area:
            tag = str(titles.get(card.area) or card.area)[:40]
            tags = card.tags if tag in card.tags else [*card.tags, tag][:50]
            cards[card.id] = card.model_copy(update={"area": None, "tags": tags})
    layout.features = cards
    flow_ids = {f.id for f in flows}
    layout.flows = [_clean_flow(f, cards, flow_ids, problems) for f in flows]
    return layout


#: A step of a flow that calls another flow (decision 19): ``flow:<flow id>`` in ``nodeIds`` and in edges.
CALL = "flow:"


def _clean_flow(
    flow: FlowFile, cards: dict[str, FeatureFile], flow_ids: set[str], problems: list[MapProblem]
) -> FlowFile:
    file = f"{FLOWS}/{flow.id}.json"
    node_ids: list[str] = []
    for node_id in flow.node_ids:
        called = node_id.removeprefix(CALL) if node_id.startswith(CALL) else None
        if called is not None and called == flow.id:
            problems.append(MapProblem(file=file, message="A flow cannot call itself"))
        elif called is not None and called not in flow_ids:
            problems.append(MapProblem(file=file, message=f"The flow '{called}' does not exist"))
        elif called is None and node_id not in cards:
            problems.append(MapProblem(file=file, message=f"The card '{node_id}' does not exist"))
        elif node_id not in node_ids:
            node_ids.append(node_id)
    edges: list[FlowEdge] = []
    for edge in flow.edges:
        if edge.source in node_ids and edge.target in node_ids:
            edges.append(edge)
        else:
            problems.append(
                MapProblem(file=file, message=f"The edge {edge.source} -> {edge.target} points outside this flow")
            )
    return flow.model_copy(update={"node_ids": node_ids, "edges": edges})


def assemble(layout: Layout, cards: dict[str, dict]) -> ProductMap:
    """The map the app shows: agent files plus the user's decisions and session links from Alpine's state."""
    nodes: list[FlowNode] = []
    for card_id in sorted(layout.features):
        card = layout.features[card_id]
        state = cards.get(card_id) or {}
        plan = state.get("plan") or {}
        update: dict[str, Any] = {
            "priority": plan.get("priority"),
            "scope": plan.get("scope"),
            "decision": plan.get("decision") or "",
            "session_id": state.get("sessionId"),
        }
        nodes.append(FlowNode.model_construct(**{**card.__dict__, **update}))
    edges: dict[tuple[str, str], FlowEdge] = {}
    for flow in layout.flows:
        for edge in flow.edges:
            edges.setdefault((edge.source, edge.target), edge)
    flows = [ProductFlow.model_construct(**{k: getattr(f, k) for k in ProductFlow.model_fields}) for f in layout.flows]
    return ProductMap(flows=flows, nodes=nodes, edges=list(edges.values()))


def render_overview(document: ProductMap, states: dict[str, NodeState], problems: list) -> dict[str, str]:
    """OVERVIEW.md for agents that read top down: the flows, then every card with its tags and status. Paths are
    relative to the project."""

    def card_line(node: FlowNode) -> str:
        state = states.get(node.id)
        status = f"{state.status}, {state.passed}/{state.total} promises" if state else "none"
        if state and state.unread:
            status += f", {len(state.unread)} sources never opened by its writers"
        mine = [cid for cid, p in state.promises.items() if p.origin == "confirmed"] if state else []
        if mine:
            status += f", written or confirmed by the user: {', '.join(mine)}"
        tags = f" [{', '.join(node.tags)}]" if node.tags else ""
        return f"- `{node.id}` {node.title}{tags}: {node.phase}, {status} (features/{node.id}.json)"

    head = "Generated by Alpine from the files in `.alpine/map/`. Read only: edit the card and flow files instead.\n"
    lines = ["# Product map overview", "", head, f"{len(document.nodes)} cards, {len(document.flows)} flows.\n"]
    lines.append("## Flows")
    for flow in document.flows:
        line = f"- `{flow.id}` {flow.title}"
        lines.append(line + (f": {flow.description}" if flow.description else ""))
        lines.append(f"  cards: {', '.join(flow.node_ids) or 'none'} (flows/{flow.id}.json)")
    if not document.flows:
        lines.append("- none yet")
    lines += ["", "## Cards"]
    ordered = sorted(document.nodes, key=lambda n: (not n.tags, n.tags[0] if n.tags else "", n.id))
    lines += [card_line(n) for n in ordered] or ["- none yet"]
    if problems:
        lines += ["", "## Files Alpine could not read"]
        lines += [f"- {p.file}: {p.message}" for p in problems]
    return {OVERVIEW: "\n".join(lines) + "\n"}


def write_overview(root: Path, files: dict[str, str]) -> None:
    """Writes only what differs and removes area files that no longer belong. Never through a link."""
    for relative, text in files.items():
        path = lpath(root, relative)
        guard(path)
        try:
            if path.read_text(encoding="utf-8") == text:
                continue
        except OSError:
            pass
        atomic(path, text)
    folder = lpath(root, OVERVIEW_DIR)
    guard(folder)
    wanted = {Path(r).name for r in files if r.startswith(OVERVIEW_DIR)}
    if folder.is_dir():
        for stale in folder.glob("*.md"):
            if stale.name not in wanted and not stale.is_symlink():
                stale.unlink(missing_ok=True)
    ignore = lpath(root, f"{MAP_DIR}/.gitignore")
    if not ignore.exists():
        atomic(ignore, "OVERVIEW.md\noverview/\n")
