from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from pydantic import ValidationError

from alpine_protocol import FlowGetParams, FlowPrepareParams, ProductMap
from alpine_server.flow import DOCUMENT, SCHEMA, get_flow, prepare_flow
from alpine_server.methods import MethodError


def write_map(root: Path, **updates) -> ProductMap:
    value = {
        "nodes": [
            {"id": "order", "title": "Order", "phase": "built", "issue": "Coupon broken"},
            {"id": "pay", "title": "Payment", "phase": "built"},
        ],
        "flows": [
            {"id": "web", "title": "Place an order", "nodeIds": ["order", "pay"]},
            {"id": "sdk", "title": "Order through SDK", "nodeIds": ["pay"]},
        ],
        "edges": [{"source": "order", "target": "pay"}],
    } | updates
    doc = ProductMap.model_validate(value)
    path = root / DOCUMENT
    path.parent.mkdir(exist_ok=True)
    path.write_text(doc.model_dump_json(by_alias=True))
    return doc


def params(root: Path, **changes) -> FlowPrepareParams:
    return FlowPrepareParams.model_validate(
        {
            "cwd": str(root),
            "revision": get_flow(FlowGetParams(cwd=str(root))).revision,
            "action": "extend",
            "request": "Guest orders",
            "sessionId": "s1",
            "nodeId": "order",
            "flowId": "web",
        }
        | changes
    )


def test_discovery_starts_empty_and_writes_schema(tmp_path):
    result = get_flow(FlowGetParams(cwd=str(tmp_path)))
    assert not result.document.nodes
    prepared = prepare_flow(params(tmp_path, action="discover", nodeId=None, flowId=None))
    assert not prepared.board.document.nodes  # no fabricated features
    assert (tmp_path / SCHEMA).exists()
    assert "ALREADY implemented" in prepared.prompt


def test_branch_is_attached_and_existing_shared_feature_and_issue_survive(tmp_path):
    before = write_map(tmp_path)
    result = prepare_flow(params(tmp_path))
    document = result.board.document
    assert document.nodes[:2] == before.nodes
    assert document.flows[1] == before.flows[1]
    branch = document.nodes[-1]
    assert branch.phase == "planned" and branch.session_id == "s1"
    assert document.edges[-1].source == "order" and document.edges[-1].target == branch.id
    assert document.flows[0].node_ids[-1] == branch.id
    assert get_flow(FlowGetParams(cwd=str(tmp_path))).document == document


def test_stale_writer_does_not_overwrite_agent_edit(tmp_path):
    write_map(tmp_path)
    request = params(tmp_path)
    prepare_flow(request)
    latest = (tmp_path / DOCUMENT).read_bytes()
    with pytest.raises(MethodError, match="map changed"):
        prepare_flow(request)
    assert (tmp_path / DOCUMENT).read_bytes() == latest


def test_corrupt_document_is_not_replaced(tmp_path):
    write_map(tmp_path)
    (tmp_path / DOCUMENT).write_text('{"unfinished":')
    with pytest.raises(MethodError):
        prepare_flow(FlowPrepareParams(cwd=str(tmp_path), revision="missing", action="discover", session_id="s"))
    assert (tmp_path / DOCUMENT).read_text() == '{"unfinished":'


@pytest.mark.parametrize(
    "change",
    [
        {"nodes": [{"id": "x", "title": "A"}, {"id": "x", "title": "B"}]},
        {"edges": [{"source": "order", "target": "missing"}]},
        {"flows": [{"id": "a", "title": "A", "nodeIds": ["missing"]}]},
        {"flows": [{"id": "a", "title": "A", "nodeIds": ["order", "order"]}]},
    ],
)
def test_invalid_graph_references_are_rejected(tmp_path, change):
    with pytest.raises(ValidationError):
        write_map(tmp_path, **change)


def test_cyclic_graph_is_valid(tmp_path):
    doc = write_map(tmp_path, edges=[{"source": "order", "target": "pay"}, {"source": "pay", "target": "order"}])
    assert len(doc.edges) == 2


def test_verification_and_change_do_not_clear_issue_or_mark_completed(tmp_path):
    write_map(tmp_path)
    for action in ("change", "verify"):
        result = prepare_flow(params(tmp_path, action=action))
        node = result.board.document.nodes[0]
        assert node.issue == "Coupon broken"
        assert node.phase == "built" and node.checks == []
        assert node.session_id == "s1"


def test_sources_change_invalidates_check(tmp_path):
    (tmp_path / "source.py").write_text("first")
    digest = hashlib.sha256(b"first").hexdigest()
    write_map(
        tmp_path,
        nodes=[
            {
                "id": "order",
                "title": "Order",
                "checks": [
                    {
                        "summary": "Order",
                        "command": "pytest",
                        "result": "passed",
                        "output": "1 passed",
                        "sourceHashes": {"source.py": digest},
                    }
                ],
            },
            {"id": "pay", "title": "Pay"},
        ],
    )
    assert not get_flow(FlowGetParams(cwd=str(tmp_path))).stale_checks
    (tmp_path / "source.py").write_text("changed")
    assert get_flow(FlowGetParams(cwd=str(tmp_path))).stale_checks == ["order"]


def test_external_previews_and_hash_paths_are_not_read(tmp_path):
    write_map(
        tmp_path,
        nodes=[
            {
                "id": "order",
                "title": "Order",
                "preview": "../outside.png",
                "checks": [
                    {
                        "summary": "x",
                        "command": "x",
                        "result": "passed",
                        "output": "x",
                        "sourceHashes": {"../outside.png": "hash"},
                    }
                ],
            },
            {"id": "pay", "title": "Pay", "preview": "https://example.com/x.png"},
        ],
    )
    result = get_flow(FlowGetParams(cwd=str(tmp_path)))
    assert result.previews == {} and result.stale_checks == ["order"]


def test_symlink_cannot_redirect_map_writes(tmp_path):
    project, outside = tmp_path / "project", tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    (project / ".alpine").symlink_to(outside, target_is_directory=True)
    with pytest.raises(MethodError, match="inside"):
        get_flow(FlowGetParams(cwd=str(project)))
    assert not list(outside.iterdir())


def test_missing_preview_does_not_hide_map(tmp_path):
    write_map(
        tmp_path, nodes=[{"id": "order", "title": "Order", "preview": "missing.png"}, {"id": "pay", "title": "Pay"}]
    )
    result = get_flow(FlowGetParams(cwd=str(tmp_path)))
    assert len(result.document.nodes) == 2 and not result.previews


def test_bad_flow_selection_preserves_document(tmp_path):
    write_map(tmp_path)
    before = (tmp_path / DOCUMENT).read_bytes()
    with pytest.raises(MethodError):
        prepare_flow(params(tmp_path, flowId="sdk"))
    assert (tmp_path / DOCUMENT).read_bytes() == before


def test_condition_evidence_invalidates_individually_and_on_requirement_change(tmp_path):
    source = tmp_path / "sdk.py"
    source.write_text("original")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    node = {
        "id": "sdk",
        "title": "Upload",
        "conditions": [
            {"id": "success", "expectation": "Returns ID"},
            {"id": "cancel", "expectation": "Stops transmission"},
        ],
        "checks": [
            {
                "conditionId": "success",
                "expectation": "Returns ID",
                "summary": "success",
                "command": "pytest",
                "result": "passed",
                "output": "ok",
                "sourceHashes": {"sdk.py": digest},
            },
            {
                "conditionId": "cancel",
                "expectation": "Old condition",
                "summary": "cancel",
                "command": "pytest",
                "result": "passed",
                "output": "ok",
                "sourceHashes": {"sdk.py": digest},
            },
        ],
    }
    write_map(tmp_path, nodes=[node], flows=[], edges=[])
    result = get_flow(FlowGetParams(cwd=str(tmp_path)))
    assert result.stale_conditions == {"sdk": ["cancel"]}
    source.write_text("changed")
    assert get_flow(FlowGetParams(cwd=str(tmp_path))).stale_conditions == {"sdk": ["success", "cancel"]}


@pytest.mark.parametrize(
    "conditions,linked",
    [
        ([{"id": "one", "expectation": "Works"}] * 2, []),
        ([], ["unknown"]),
        ([{"id": "one", "expectation": "Works"}], ["one", "one"]),
    ],
)
def test_rejects_ambiguous_condition_evidence(conditions, linked):
    with pytest.raises(ValidationError):
        ProductMap.model_validate(
            {
                "nodes": [
                    {
                        "id": "n",
                        "title": "N",
                        "conditions": conditions,
                        "checks": [
                            {"conditionId": cid, "summary": "", "command": "", "result": "passed", "output": ""}
                            for cid in linked
                        ],
                    }
                ]
            }
        )
