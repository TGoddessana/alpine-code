from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
from dataclasses import replace
from pathlib import Path

import pytest

from alpine_protocol import (
    FlowActorParams,
    FlowEditParams,
    FlowGetParams,
    FlowNodeParams,
    FlowPrepareParams,
    FlowPromiseParams,
    FlowReviewParams,
    FlowScheduleParams,
    FlowScopeParams,
    FlowSetParams,
)
from alpine_server import flow as flow_module
from alpine_server import map_evidence, map_git, map_replay, map_state
from alpine_server.flow import (
    actor_flow,
    edit_flow,
    get_flow,
    node_flow,
    prepare_flow,
    promise_flow,
    review_flow,
    schedule_flow,
    scope_flow,
    set_flow,
)
from alpine_server.methods import MethodError

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 16
BASE = ".alpine-code/map"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(map_git, "_TTL", 0)
    monkeypatch.setattr(map_state, "_SESSION_TTL", 0)
    monkeypatch.setattr(map_state, "live_ids", None)
    flow_module._seen.clear()
    flow_module._overview_etag.clear()
    return tmp_path / "home"


@pytest.fixture
def proj(tmp_path):
    root = tmp_path / "proj"
    root.mkdir()
    return root


def local(home: Path) -> Path:
    (folder,) = (home / "projects").glob("*/product-map/")
    return folder


def put(root: Path, relative: str, value) -> Path:
    path = root / BASE / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value if isinstance(value, str) else json.dumps(value))
    return path


def write_map(root: Path, features=None, flows=None, **map_fields) -> None:
    """Rewrites the agent's files (never Alpine's state)."""
    for folder in ("features", "flows"):
        shutil.rmtree(root / BASE / folder, ignore_errors=True)
    put(root, "map.json", {"formatVersion": 1} | map_fields)
    features = (
        [{"id": "order", "title": "Order", "phase": "built"}, {"id": "pay", "title": "Pay"}]
        if features is None
        else features
    )
    flows = (
        [
            {
                "id": "web",
                "title": "Place an order",
                "nodeIds": ["order", "pay"],
                "edges": [{"source": "order", "target": "pay"}],
            },
            {"id": "sdk", "title": "Order through SDK", "nodeIds": ["pay"]},
        ]
        if flows is None
        else flows
    )
    for feature in features:
        put(root, f"features/{feature['id']}.json", feature)
    for item in flows:
        put(root, f"flows/{item['id']}.json", item)


def check(cond="a", result="passed", run="r1", **extra) -> dict:
    return {
        "id": run,
        "conditionId": cond,
        "expectation": cond,
        "summary": "s",
        "command": "x",
        "result": result,
        "output": "",
        "dependsOn": ["x.py"],
    } | extra


def order(result="passed", run="r1", checks=None, **extra) -> dict:
    return {
        "id": "order",
        "title": "Order",
        "phase": "built",
        "conditions": [{"id": "a", "expectation": "a"}],
        "checks": [check(result=result, run=run)] if checks is None else checks,
    } | extra


def get(root: Path, **kw):
    return get_flow(FlowGetParams(cwd=str(root), **kw))


def prepare(root: Path, **changes):
    return prepare_flow(
        FlowPrepareParams.model_validate(
            {
                "cwd": str(root),
                "revision": get(root).revision,
                "action": "extend",
                "request": "Guest orders",
                "sessionId": "s1",
                "nodeId": "order",
                "flowId": "web",
            }
            | changes
        )
    )


def act(root: Path, action: str, cond="a", node="order", reason="", key=None):
    if key is None and action == "approve_replay":
        key = get(root).states[node].promises[cond].replay.key
    return promise_flow(
        FlowPromiseParams(cwd=str(root), node_id=node, condition_id=cond, action=action, reason=reason, key=key or "")
    )


def make_session(
    proj,
    sid="s1",
    calls=(("c1", "refund: 180,000 won\nok"),),
    cwd=None,
    created="2000-01-01T00:00:00+00:00",
    updated="",
    status="idle",
):
    from alpine_core import SessionInfo, ToolCallItem, file_storage, item_to_dict

    log = file_storage().log
    log.create(
        SessionInfo(
            id=sid,
            title="t",
            cwd=str(cwd or proj),
            model="m",
            mode="default",
            status=status,
            created_at=created,
            updated_at=updated,
        )
    )
    log.append(
        sid,
        [
            (
                n,
                item_to_dict(
                    ToolCallItem(
                        id=c[0],
                        name=c[3] if len(c) > 3 else "bash",
                        status="done",
                        result=c[1],
                        args=c[2] if len(c) > 2 else {},
                    )
                ),
            )
            for n, c in enumerate(calls)
        ],
    )


def git(root: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@example.com",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@example.com",
    }
    done = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, env=env, check=True)
    return done.stdout.strip()


def git_repo(root: Path) -> str:
    git(root, "init", "-q")
    (root / "README.md").write_text("hi")
    git(root, "add", ".")
    git(root, "commit", "-q", "-m", "first")
    return git(root, "rev-parse", "HEAD")


# ---- reading: layout, problems, compatibility


def test_no_map_reads_empty_and_writes_nothing(proj):
    result = get(proj)
    assert not result.exists and not result.document.nodes and result.revision == "missing"
    assert not (proj / ".alpine-code").exists()


def test_files_assemble_into_one_map(proj):
    write_map(proj, areas=[{"id": "ordering", "title": "Ordering"}], exclude=["*.lock"])
    put(proj, "features/order.json", {"id": "order", "title": "Order", "phase": "built", "area": "ordering"})
    write = put(
        proj,
        "flows/web.json",
        {
            "id": "web",
            "title": "Web",
            "nodeIds": ["order", "pay"],
            "edges": [{"source": "order", "target": "pay", "label": "first"}],
        },
    )
    put(
        proj,
        "flows/web2.json",
        {
            "id": "web2",
            "title": "Web 2",
            "nodeIds": ["order", "pay"],
            "edges": [{"source": "order", "target": "pay", "label": "second"}],
        },
    )
    assert write.exists()
    result = get(proj)
    document = result.document
    assert result.exists and [n.id for n in document.nodes] == ["order", "pay"]
    assert document.nodes[0].tags == ["Ordering"]  # an old area becomes a tag with its title
    assert [f.id for f in document.flows] == ["sdk", "web", "web2"]
    assert [(e.source, e.target, e.label) for e in document.edges] == [("order", "pay", "first")]
    assert result.exclude == ["*.lock"] and not result.problems


def test_files_with_problems_are_skipped_and_the_rest_shows(proj):
    write_map(proj)
    put(proj, "features/broken.json", '{"id": "broken"')
    put(proj, "features/notitle.json", {"id": "notitle"})
    put(proj, "features/other.json", {"id": "different", "title": "x"})
    put(proj, "flows/odd.json", {"id": "odd", "title": "x", "unknown": 1})
    result = get(proj)
    assert [n.id for n in result.document.nodes] == ["order", "pay"]
    bad = {p.file for p in result.problems}
    assert bad == {f"{BASE}/features/{n}.json" for n in ("broken", "notitle", "other")} | {f"{BASE}/flows/odd.json"}


def test_dangling_references_are_dropped_with_a_problem_each(proj):
    write_map(
        proj,
        features=[{"id": "order", "title": "Order"}, {"id": "pay", "title": "Pay"}],
        flows=[
            {
                "id": "web",
                "title": "Web",
                "nodeIds": ["order", "missing", "order"],
                "edges": [{"source": "order", "target": "missing"}],
            }
        ],
    )
    result = get(proj)
    document = result.document
    assert document.flows[0].node_ids == ["order"] and not document.edges
    messages = " | ".join(f"{p.file.rsplit('/', 1)[1]}: {p.message}" for p in result.problems)
    for needle in ("'missing'", "points outside"):
        assert needle in messages


def test_newer_format_is_read_only_and_tolerates_unknown_fields(proj):
    write_map(proj, features=[{"id": "order", "title": "Order", "future": {"x": 1}}], flows=[])
    put(proj, "map.json", {"formatVersion": 2, "areas": [{"id": "a", "title": "A", "color": "red"}], "extra": 1})
    result = get(proj)
    assert result.read_only and [n.id for n in result.document.nodes] == ["order"] and not result.problems
    assert not (proj / BASE / "state").exists() and not (proj / BASE / "OVERVIEW.md").exists()
    before = (proj / BASE / "map.json").read_bytes()
    for call in (
        lambda: set_flow(FlowSetParams(cwd=str(proj), node_id="order", field="priority", value="must")),
        lambda: act(proj, "confirm"),
        lambda: scope_flow(FlowScopeParams(cwd=str(proj), include=["src"])),
        lambda: prepare(proj, action="discover"),
    ):
        with pytest.raises(MethodError) as error:
            call()
        assert error.value.data.reason == "map_read_only"
    assert (proj / BASE / "map.json").read_bytes() == before and not (proj / BASE / "state").exists()


def test_etag_lets_an_unchanged_map_answer_briefly(proj):
    write_map(proj)
    first = get(proj)
    again = get(proj, since=first.etag)
    assert again.unchanged and again.revision == first.revision and not again.document.nodes
    put(proj, "features/pay.json", {"id": "pay", "title": "Payment"})
    changed = get(proj, since=first.etag)
    assert not changed.unchanged and changed.revision != first.revision and changed.etag != first.etag


def test_files_are_parsed_again_only_when_they_change(proj, monkeypatch):
    import alpine_server.map_files as files

    write_map(proj)
    get(proj)
    reads = []
    real = files.read_bytes
    monkeypatch.setattr(files, "read_bytes", lambda *a, **k: reads.append(a[0]) or real(*a, **k))
    get(proj)
    assert not [r for r in reads if r.suffix == ".json" and "features" in str(r)]
    put(proj, "features/pay.json", {"id": "pay", "title": "Payment"})
    assert get(proj).document.nodes[1].title == "Payment"


def test_symlink_cannot_redirect_map_writes(tmp_path):
    project, outside = tmp_path / "project", tmp_path / "outside"
    project.mkdir()
    outside.mkdir()
    (project / ".alpine-code").symlink_to(outside, target_is_directory=True)
    with pytest.raises(MethodError, match="inside"):
        get(project)
    assert not list(outside.iterdir())


def test_missing_preview_does_not_hide_map_and_external_paths_are_not_read(proj, tmp_path):
    (tmp_path / "outside.png").write_bytes(PNG)
    (proj / "shot.png").write_bytes(PNG)
    write_map(
        proj,
        features=[
            {"id": "order", "title": "Order", "preview": "missing.png"},
            {"id": "pay", "title": "Pay", "preview": "../outside.png"},
            {"id": "ship", "title": "Ship", "preview": "https://example.com/x.png"},
            {"id": "ok", "title": "Ok", "preview": "shot.png"},
        ],
        flows=[],
    )
    result = get(proj)
    assert len(result.document.nodes) == 4
    assert list(result.previews) == ["ok"]


def test_a_drawn_sketch_shows_until_a_screenshot_exists_and_only_as_svg(proj):
    (proj / "shot.png").write_bytes(PNG)
    (proj / "drawn.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>')
    (proj / "photo.png").write_bytes(PNG)
    write_map(
        proj,
        features=[
            {"id": "drawn", "title": "Drawn", "sketch": "drawn.svg"},
            {"id": "both", "title": "Both", "preview": "shot.png", "sketch": "drawn.svg"},
            {"id": "notsvg", "title": "Not SVG", "sketch": "photo.png"},
            {"id": "outside", "title": "Outside", "sketch": "../drawn.svg"},
        ],
        flows=[],
    )
    result = get(proj)
    assert list(result.sketches) == ["drawn"]
    assert result.sketches["drawn"].startswith("data:image/svg+xml;base64,")
    assert list(result.previews) == ["both"]


# ---- overview, schema, ignore file


def test_overview_is_written_ignored_and_rewritten_when_edited(proj):
    put(proj, "overview/ordering.md", "an area file from an older map")
    write_map(
        proj,
        features=[
            {"id": "order", "title": "Order", "tags": ["주문"]},
            {"id": "pay", "title": "Pay", "tags": ["결제", "주문"]},
            {"id": "loose", "title": "Loose"},
        ],
    )
    get(proj)
    overview = (proj / BASE / "OVERVIEW.md").read_text()
    assert "3 cards, 2 flows." in overview and "- `pay` Pay [결제, 주문]" in overview
    assert overview.index("`pay`") < overview.index("`order`") < overview.index("`loose`")  # sorted by first tag
    assert not (proj / BASE / "overview/ordering.md").exists()
    assert (proj / BASE / ".gitignore").read_text() == "OVERVIEW.md\noverview/\n"
    (proj / BASE / "OVERVIEW.md").write_text("tampered")
    get(proj)
    assert "`pay`" in (proj / BASE / "OVERVIEW.md").read_text()


def test_parts_not_mapped_yet_are_kept_shown_and_continued(proj):
    part = {"title": "운영자 콘솔에서 사용자 정지하기", "why": "not reached", "paths": ["ops/"]}
    write_map(proj, unmapped=[part])
    result = get(proj)
    assert [(p.title, p.why, p.paths) for p in result.unmapped] == [(part["title"], "not reached", ["ops/"])]
    overview = (proj / BASE / "OVERVIEW.md").read_text()
    assert "## Not mapped yet" in overview and "- 운영자 콘솔에서 사용자 정지하기 (ops/): not reached" in overview
    prompt = prepare(proj, action="discover", nodeId=None, flowId=None, request="").prompt
    assert "If map.json lists `unmapped` parts" in prompt and "Keep `unmapped` in map.json true" in prompt


# ---- stamping and witness


def test_new_checks_are_stamped_with_the_session_that_wrote_them(proj):
    make_session(proj)
    make_session(proj, sid="foreign", cwd=proj.parent)
    (proj / "x.py").write_text("a")
    write_map(proj, features=[order()], flows=[])
    path = proj / BASE / "features/order.json"
    os.utime(path, (1791763200, 1791763200))
    stamp = get(proj).states["order"].promises["a"].stamp
    assert (stamp.session_id, stamp.first_seen, stamp.at, stamp.witness) == (
        "s1",
        False,
        "2026-10-12T00:00:00Z",
        "mine",
    )
    saved = json.loads((proj / BASE / "state/cards/order.json").read_text())
    assert saved["stamps"]["a/r1"]["hashes"] == {"x.py": map_git.file_hash(proj, "x.py")}
    assert saved["promises"]["a"]["results"] == [{"checkId": "r1", "result": "passed", "at": "2026-10-12T00:00:00Z"}]


def test_a_check_no_session_wrote_is_marked_first_seen(proj):
    make_session(proj, created="2026-10-12T00:00:00+00:00", updated="2026-10-12T01:00:00+00:00")
    write_map(proj, features=[order()], flows=[])
    os.utime(proj / BASE / "features/order.json", (1791763200 + 7200, 1791763200 + 7200))
    stamp = get(proj).states["order"].promises["a"].stamp
    assert stamp.first_seen and stamp.session_id is None
    assert stamp.at != "2026-10-12T02:00:00Z"


def test_files_changed_after_the_check_make_the_stamp_uncertain(proj):
    (proj / "x.py").write_text("a")
    os.utime(proj / "x.py", (4_000_000_000, 4_000_000_000))
    write_map(proj, features=[order()], flows=[])
    promise = get(proj).states["order"].promises["a"]
    assert promise.stamp.uncertain and promise.status == "recheck"


def test_witness_tells_own_records_from_other_computers_and_edited_ones(proj, home):
    (proj / "x.py").write_text("a")
    write_map(proj, features=[order()], flows=[])
    assert get(proj).states["order"].promises["a"].stamp.witness == "mine"
    (local(home) / "witness.json").unlink()
    assert get(proj).states["order"].promises["a"].stamp.witness == "other"
    write_map(proj, features=[order(run="r2")], flows=[])
    get(proj)
    state_file = proj / BASE / "state/cards/order.json"
    saved = json.loads(state_file.read_text())
    saved["stamps"]["a/r2"]["at"] = "2020-01-01T00:00:00Z"
    state_file.write_text(json.dumps(saved))
    assert get(proj).states["order"].promises["a"].stamp.witness == "mismatch"


def test_labels_recorded_elsewhere_show_when_they_cannot_be_checked_here(proj, home):
    obs = [{"label": "x", "excerpt": "ok", "source": {"kind": "tool_call", "sessionId": "gone"}}]
    write_map(proj, features=[order(checks=[check(observations=obs)])], flows=[])
    (proj / "x.py").write_text("a")
    get(proj)
    state_file = proj / BASE / "state/cards/order.json"
    saved = json.loads(state_file.read_text())
    saved["stamps"]["a/r1"]["provenance"] = [{"label": "verified", "reason": "", "matched": "c1", "elsewhere": False}]
    state_file.write_text(json.dumps(saved))
    (local(home) / "witness.json").unlink()
    (shown,) = get(proj).provenance["order/a"]
    assert (shown.label, shown.matched, shown.elsewhere) == ("verified", "c1", True)


def test_labels_are_refreshed_for_records_this_computer_witnessed(proj):
    (proj / "x.py").write_text("a")
    make_session(proj)
    obs = [{"label": "x", "excerpt": "later", "source": {"kind": "tool_call", "sessionId": "s1"}}]
    write_map(proj, features=[order(checks=[check(observations=obs)])], flows=[])
    assert get(proj).provenance["order/a"][0].label == "mismatch"
    from alpine_core import ToolCallItem, file_storage, item_to_dict

    file_storage().log.append(
        "s1", [(9, item_to_dict(ToolCallItem(id="c9", name="bash", status="done", result="later")))]
    )
    assert get(proj).states["order"].promises["a"].stamp.witness == "mine"
    saved = json.loads((proj / BASE / "state/cards/order.json").read_text())
    assert saved["stamps"]["a/r1"]["provenance"][0]["label"] == "verified"


# ---- promise states, issues, origin


def failing_card(proj, *runs):
    (proj / "x.py").write_text("a")
    for run, result in runs:
        write_map(proj, features=[order(result, run)], flows=[])
        get(proj)


def promise(root):
    return get(root).states["order"].promises["a"]


def test_a_failed_confirmed_promise_is_an_open_issue(proj):
    failing_card(proj, ("r1", "failed"))
    assert promise(proj).issue == "question"
    act(proj, "confirm")
    state = get(proj).states["order"]
    assert (state.status, state.promises["a"].issue, state.promises["a"].origin) == ("failed", "open", "confirmed")
    assert state.promises["a"].since == state.promises["a"].stamp.at


def test_a_failed_guess_is_a_question_not_a_failure(proj):
    failing_card(proj, ("r1", "failed"))
    state = get(proj).states["order"]
    assert (state.status, state.promises["a"].issue, state.promises["a"].origin) == ("question", "question", "inferred")


def test_resolved_regressed_and_open_follow_the_result_history(proj):
    failing_card(proj, ("r1", "failed"))
    act(proj, "confirm")
    write_map(proj, features=[order("passed", "r2")], flows=[])
    resolved = promise(proj)
    assert (resolved.status, resolved.issue) == ("passed", "resolved")
    assert resolved.since == resolved.stamp.at
    write_map(proj, features=[order("failed", "r3")], flows=[])
    assert promise(proj).issue == "regressed"
    write_map(proj, features=[order("failed", "r4")], flows=[])
    assert promise(proj).issue == "regressed"
    results = json.loads((proj / BASE / "state/cards/order.json").read_text())["promises"]["a"]["results"]
    assert [r["checkId"] for r in results] == ["r4", "r3", "r2", "r1"]


def test_changed_files_make_an_open_issue_maybe_fixed_and_a_pass_recheck(proj):
    failing_card(proj, ("r1", "failed"))
    act(proj, "confirm")
    (proj / "x.py").write_text("fixed")
    state = get(proj).states["order"]
    shown = state.promises["a"]
    assert (shown.status, shown.issue, shown.changed) == ("recheck", "maybe_fixed", ["x.py"])
    assert state.status == "failed" and state.changed


def test_later_wakes_when_files_change_and_wontfix_needs_a_reason(proj):
    failing_card(proj, ("r1", "failed"))
    act(proj, "confirm")
    shown = act(proj, "later").states["order"].promises["a"]
    assert (shown.issue, get(proj).states["order"].status) == ("later", "unconfirmed")
    (proj / "x.py").write_text("edited")
    assert promise(proj).issue == "maybe_fixed"
    with pytest.raises(MethodError) as error:
        act(proj, "wontfix", reason="  ")
    assert error.value.data.reason == "reason_required"
    wont = act(proj, "wontfix", reason="이메일 영수증으로 충분").states["order"].promises["a"]
    assert (wont.issue, wont.reason) == ("wontfix", "이메일 영수증으로 충분")
    assert act(proj, "reopen").states["order"].promises["a"].issue == "maybe_fixed"
    kinds = [c.kind for c in get(proj).changes]
    assert {"issue_later", "issue_wontfix", "issue_reopened", "promise_confirmed"} <= set(kinds)


def test_confirmation_holds_for_the_exact_promise_text_and_plan_origin_comes_from_alpine(proj, home):
    failing_card(proj, ("r1", "passed"))
    assert promise(proj).origin == "inferred"
    assert act(proj, "confirm").states["order"].promises["a"].origin == "confirmed"
    reworded = order(checks=[check(expectation="b")])
    reworded["conditions"] = [{"id": "a", "expectation": "b"}]
    write_map(proj, features=[reworded], flows=[])
    assert promise(proj).origin == "inferred"
    state_file = proj / BASE / "state/cards/order.json"
    saved = json.loads(state_file.read_text())
    saved["promises"]["a"]["plan"] = True
    state_file.write_text(json.dumps(saved))
    assert promise(proj).origin == "inferred"  # edited after this computer wrote it: ignored
    (local(home) / "witness.json").unlink()
    shown = promise(proj)  # written elsewhere: trusted, and said so
    assert (shown.origin, shown.decided_elsewhere) == ("plan", True)
    assert act(proj, "unconfirm").states["order"].promises["a"].origin == "plan"


def test_node_status_is_the_worst_promise(proj):
    (proj / "x.py").write_text("a")

    def card(card_id, conditions, checks):
        return {"id": card_id, "title": card_id, "conditions": conditions, "checks": checks}

    one = [{"id": "a", "expectation": "a"}]
    two = [*one, {"id": "b", "expectation": "b"}]
    write_map(
        proj,
        features=[
            card("none", [], []),
            card("fine", one, [check()]),
            card("part", two, [check()]),
            card("stale", one, [check(expectation="old")]),
            card("fail", one, [check(result="failed")]),
            card("guess", one, [check(result="failed")]),
        ],
        flows=[],
    )
    get(proj)
    act(proj, "confirm", node="fail")
    states = get(proj).states
    assert {k: v.status for k, v in states.items()} == {
        "none": "none",
        "fine": "passed",
        "part": "unconfirmed",
        "stale": "recheck",
        "fail": "failed",
        "guess": "question",
    }
    assert (states["part"].passed, states["part"].total) == (1, 2)
    assert states["fine"].missing == []


def test_files_the_card_points_to_that_are_gone_are_listed(proj):
    write_map(proj, features=[order(sources=["gone.py"], checks=[])], flows=[])
    assert get(proj).states["order"].missing == ["gone.py"]


# ---- coverage


def test_changes_no_card_covers_are_counted_from_the_sync_commit(proj):
    first = git_repo(proj)
    (proj / "src").mkdir()
    (proj / "src/a.py").write_text("a")
    write_map(proj, features=[order(sources=["src"], checks=[])], flows=[], exclude=["*.lock"])
    zero = get(proj).coverage
    assert zero.git and zero.since == first and zero.uncovered_count == 0
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "work")
    (proj / "src/b.py").write_text("b")  # covered: under a card source
    (proj / "new.py").write_text("n")  # uncovered
    (proj / "deps.lock").write_text("x")  # excluded
    (proj / "docs").mkdir()
    (proj / "docs/readme.md").write_text("d")  # uncovered
    result = scope_flow(FlowScopeParams(cwd=str(proj), include=["src", "new.py", "deps.lock"]))
    cov = result.coverage
    assert (cov.uncovered, cov.excluded, cov.out_of_scope) == (["new.py"], 1, 1)
    assert result.include == ["src", "new.py", "deps.lock"]
    cleared = scope_flow(FlowScopeParams(cwd=str(proj), include=[]))
    assert cleared.coverage.uncovered == ["docs/readme.md", "new.py"] and cleared.coverage.uncovered_count == 2


def test_committed_changes_count_and_a_new_map_starts_at_zero(proj):
    git_repo(proj)
    (proj / "old.py").write_text("o")
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "before the map")
    write_map(proj)
    assert get(proj).coverage.uncovered_count == 0
    (proj / "later.py").write_text("l")
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "after the map")
    assert get(proj).coverage.uncovered == ["later.py"]


def test_check_dependencies_cover_files_and_a_project_without_git_says_so(proj):
    git_repo(proj)
    write_map(proj, features=[order()], flows=[])
    get(proj)
    (proj / "x.py").write_text("x")
    (proj / "y.py").write_text("y")
    assert get(proj).coverage.uncovered == ["y.py"]


def test_no_git_means_no_coverage(proj):
    write_map(proj)
    assert get(proj).coverage.git is False


def test_sync_session_moves_the_sync_commit_after_it_ends(proj):
    first = git_repo(proj)
    write_map(proj)
    get(proj)
    (proj / "new.py").write_text("n")
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "work")
    make_session(proj, created="2026-10-01T00:00:00+00:00", updated="2026-10-01T00:00:00+00:00", status="running")
    prepared = prepare(proj, action="sync", nodeId=None, flowId=None, request="")
    assert "new.py" in prepared.prompt and "Do not run checks" in prepared.prompt
    assert prepared.board.coverage.since == first
    assert get(proj).coverage.since == first  # the session is still running
    from alpine_core import file_storage

    info, _ = file_storage().log.read("s1")
    file_storage().log.update(replace(info, status="idle", updated_at="2099-01-01T00:00:00+00:00"))
    done = get(proj)
    assert done.coverage.since == git(proj, "rev-parse", "HEAD") and done.coverage.uncovered_count == 0
    project = json.loads((proj / BASE / "state/project.json").read_text())
    assert project["syncSession"] is None and project["syncCommit"] == done.coverage.since


def test_sync_sees_every_change_with_the_cards_that_cite_it(proj):
    git_repo(proj)
    (proj / "src").mkdir()
    (proj / "src/refund.py").write_text("RATE = 1.0\n")
    write_map(proj, features=[order(sources=["src/refund.py"], checks=[])], flows=[], exclude=["*.lock"])
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "start")
    get(proj)
    (proj / "src/refund.py").write_text("RATE = 0.6\n")  # covered: the behaviour behind a card changed
    (proj / "coupon.py").write_text("c")  # no card
    (proj / "deps.lock").write_text("x")  # excluded
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "Refunds keep 40% after three uses")
    prompt = prepare(proj, action="sync", nodeId=None, flowId=None, request="").prompt
    assert "Refunds keep 40% after three uses" in prompt
    assert "- src/refund.py — cards: order" in prompt and "- coupon.py — no card" in prompt
    assert "deps.lock" not in prompt
    assert "-RATE = 1.0" in prompt and "+RATE = 0.6" in prompt
    assert "rewrite or add its promises" in prompt


def test_a_sync_session_created_just_before_prepare_is_not_over_yet(proj):
    first = git_repo(proj)
    write_map(proj)
    get(proj)
    (proj / "new.py").write_text("n")
    git(proj, "add", ".")
    git(proj, "commit", "-q", "-m", "work")
    from datetime import UTC, datetime

    # The app creates the session, then prepares the map turn: the session is idle and was updated this second.
    now = datetime.now(UTC).isoformat(timespec="milliseconds")
    make_session(proj, created=now, updated=now, status="idle")
    prepared = prepare(proj, action="sync", nodeId=None, flowId=None, request="")
    assert "new.py" in prepared.prompt
    assert prepared.board.coverage.since == first and prepared.board.coverage.uncovered_count == 1
    assert get(proj).coverage.since == first


# ---- replays


def replay_card(command="echo ok", expect=("ok",), **replay):
    return order(
        checks=[check(replay={"command": command, "cwd": ".", "expect": list(expect), **replay})],
    )


def replay_setup(proj, **kw):
    (proj / "x.py").write_text("a")
    write_map(proj, features=[replay_card(**kw)], flows=[])
    assert get(proj).states["order"].promises["a"].replay.approved is False
    approved = act(proj, "approve_replay").states["order"].promises["a"]
    assert approved.replay.approved and approved.status == "passed"


def run_replays(proj):
    flow_module._seen.clear()  # as if the map was just opened
    get(proj)
    map_replay.join(proj)
    return get(proj).states["order"].promises["a"]


def test_an_approved_replay_that_gives_the_same_result_keeps_the_pass(proj):
    replay_setup(proj)
    (proj / "x.py").write_text("changed")
    assert promise(proj).status == "recheck"
    shown = run_replays(proj)
    assert (shown.status, shown.replay.same, shown.replay.running) == ("passed", True, False)
    assert "ok" in shown.replay.output and shown.changed == ["x.py"]
    assert "replay_same" in [c.kind for c in get(proj).changes]
    assert (local := list((proj.parent / "home" / "projects").glob("*/product-map/replays.json")))
    assert json.loads(local[0].read_text())["order/a"]["same"] is True


def test_a_replay_with_a_different_result_leaves_the_recheck(proj):
    replay_setup(proj, command="echo nope")
    (proj / "x.py").write_text("changed")
    shown = run_replays(proj)
    assert (shown.status, shown.replay.same) == ("recheck", False)
    assert "replay_different" in [c.kind for c in get(proj).changes]
    again = get(proj)  # the same files are not replayed twice
    assert again.states["order"].promises["a"].replay.same is False


def test_replays_wait_while_a_session_of_the_project_runs_and_need_the_same_command(proj):
    replay_setup(proj)
    (proj / "x.py").write_text("changed")
    make_session(proj, created="2026-10-01T00:00:00+00:00", updated="", status="running")
    flow_module._seen.clear()
    get(proj)
    assert not map_replay.busy(proj)
    assert promise(proj).replay.same is None
    reworded = replay_card(command="echo ok && true")
    write_map(proj, features=[reworded], flows=[])
    assert promise(proj).replay.approved is False
    with pytest.raises(MethodError):
        act(proj, "approve_replay", node="order", cond="nope", key="x")
    revoked = act(proj, "revoke_replay").states["order"].promises["a"]
    assert revoked.replay.approved is False


def test_a_failing_check_is_replayed_to_the_same_failure(proj):
    (proj / "x.py").write_text("a")
    card = order(checks=[check(result="failed", replay={"command": "echo boom; exit 3", "expect": ["boom"]})])
    write_map(proj, features=[card], flows=[])
    get(proj)
    act(proj, "confirm")
    act(proj, "approve_replay")
    (proj / "x.py").write_text("changed")
    shown = run_replays(proj)
    assert shown.replay.same is True and shown.status == "failed" and shown.issue == "open"


# ---- user decisions: set, scope, schedule


@pytest.mark.parametrize(
    "field,value",
    [
        ("priority", "must"),
        ("priority", "later"),
        ("scope", "next"),
        ("scope", "out"),
        ("decision", "Ship after the pilot"),
    ],
)
def test_set_writes_one_decision_into_alpines_state_only(proj, field, value):
    write_map(proj)
    before = (proj / BASE / "features/order.json").read_bytes()
    result = set_flow(FlowSetParams(cwd=str(proj), node_id="order", field=field, value=value))
    assert getattr(result.document.nodes[0], field) == value
    assert (proj / BASE / "features/order.json").read_bytes() == before
    assert result.document.nodes[1].priority is None


def test_set_clears_values_and_rejects_bad_input(proj):
    write_map(proj)
    for field, value in [("priority", "should"), ("scope", "now"), ("decision", "memo")]:
        set_flow(FlowSetParams(cwd=str(proj), node_id="order", field=field, value=value))
    for field in ("priority", "scope", "decision"):
        result = set_flow(FlowSetParams(cwd=str(proj), node_id="order", field=field, value=None))
    node = result.document.nodes[0]
    assert node.priority is None and node.scope is None and node.decision == ""
    for bad in (
        {"node_id": "ghost"},
        {"field": "priority", "value": "urgent"},
        {"field": "decision", "value": "x" * 501},
    ):
        with pytest.raises(MethodError) as error:
            set_flow(
                FlowSetParams.model_validate(
                    {"cwd": str(proj), "node_id": "order", "field": "priority", "value": "must"} | bad
                )
            )
        assert error.value.data.reason == "invalid_flow"


def test_actor_groups_journeys_in_their_files_and_clears(proj):
    write_map(proj)
    result = actor_flow(FlowActorParams(cwd=str(proj), flow_ids=["web", "sdk"], actor="  손님  "))
    assert {flow.id: flow.actor for flow in result.document.flows} == {"web": "손님", "sdk": "손님"}
    assert json.loads((proj / BASE / "flows/web.json").read_text())["actor"] == "손님"
    result = actor_flow(FlowActorParams(cwd=str(proj), flow_ids=["sdk"], actor=""))
    assert "actor" not in json.loads((proj / BASE / "flows/sdk.json").read_text())
    assert {flow.id: flow.actor for flow in result.document.flows} == {"web": "손님", "sdk": ""}
    with pytest.raises(MethodError) as error:
        actor_flow(FlowActorParams(cwd=str(proj), flow_ids=["ghost"], actor="x"))
    assert error.value.data.reason == "invalid_flow"


def test_scope_keeps_project_relative_paths_inside_the_project(proj):
    scope_flow(FlowScopeParams(cwd=str(proj), include=["./web/", "api", "web", "", "."]))  # before any map exists
    assert get(proj).include == ["web", "api"]
    with pytest.raises(MethodError) as error:
        scope_flow(FlowScopeParams(cwd=str(proj), include=["../elsewhere"]))
    assert error.value.data.reason == "invalid_flow_path"
    assert json.loads((proj / BASE / "state/project.json").read_text())["include"] == ["web", "api"]


def test_schedule_lives_on_this_computer(proj, home):
    off = get(proj).schedule
    assert (off.enabled, off.limit, off.last_run) == (False, 20, None)
    on = schedule_flow(FlowScheduleParams(cwd=str(proj), enabled=True, limit=5)).schedule
    assert (on.enabled, on.limit, on.last_run) == (True, 5, None)
    ran = schedule_flow(FlowScheduleParams(cwd=str(proj), enabled=True, limit=5, ran=True)).schedule
    assert ran.last_run and ran.last_run.endswith("Z")
    with pytest.raises(MethodError) as error:  # only one claim a day
        schedule_flow(FlowScheduleParams(cwd=str(proj), enabled=True, limit=5, ran=True))
    assert error.value.data.reason == "flow_conflict"
    assert get(proj).schedule.last_run == ran.last_run
    assert json.loads((local(home) / "schedule.json").read_text())["limit"] == 5
    assert not (proj / ".alpine-code").exists()


# ---- flow/node images


def test_check_screenshots_and_verified_images_load_with_the_card(proj):
    make_session(proj)
    (proj / "shot.png").write_bytes(PNG)
    (proj / "fake.png").write_bytes(b"not an image")
    (proj / "other.png").write_bytes(PNG)
    file_obs = {"label": "f", "show": "image", "source": {"kind": "file", "ref": "other.png", "sessionId": "s1"}}
    card = order(
        checks=[
            check("a", screenshot="shot.png", observations=[{"label": "own", "show": "image"}, file_obs]),
            check("b", screenshot="fake.png"),
            check("c", screenshot="../outside.png"),
        ],
        conditions=[{"id": c, "expectation": c} for c in ("a", "b", "c")],
    )
    write_map(proj, features=[card], flows=[])
    result = node_flow(FlowNodeParams(cwd=str(proj), node_id="order"))
    url = "data:image/png;base64," + base64.b64encode(PNG).decode()
    assert result.check_screenshots == {"a": url}
    assert result.observation_images == {"a/1": url}
    board = get(proj)
    assert not hasattr(board, "check_screenshots")
    with pytest.raises(MethodError):
        node_flow(FlowNodeParams(cwd=str(proj), node_id="ghost"))


# ---- flow/prepare


def files_under(root: Path) -> dict[str, bytes]:
    derived = ("OVERVIEW.md", "overview", ".gitignore")
    return {
        str(p.relative_to(root)): p.read_bytes()
        for p in (root / BASE).rglob("*")
        if p.is_file() and p.relative_to(root / BASE).parts[0] not in derived
    }


def test_discovery_starts_empty_creates_the_map_and_writes_schemas(proj):
    prepared = prepare(proj, action="discover", nodeId=None, flowId=None)
    assert not prepared.board.document.nodes and prepared.board.exists
    assert json.loads((proj / BASE / "map.json").read_text()) == {"formatVersion": 1, "exclude": [], "unmapped": []}
    for name in ("map", "feature", "flow"):
        assert json.loads((proj / BASE / f"schema/{name}.json").read_text())["type"] == "object"
    assert "ALREADY implemented" in prepared.prompt and "proposedInclude" not in prepared.prompt
    assert "the whole project" in prepared.prompt and "You decide how to explore" in prepared.prompt
    assert "Give each card a few `tags`" in prepared.prompt and "Keep `unmapped` in map.json true" in prepared.prompt
    assert "new unique `id`" in prepared.prompt  # discovery may record checks (decision 14)
    assert "how we know it holds" in prepared.prompt and "Do not record checks" not in prepared.prompt
    # Decision 18: a flow is a journey through one door, and every card sits where its user meets it.
    assert "through one door of the product" in prepared.prompt and "Upkeep features" not in prepared.prompt
    assert json.loads((proj / BASE / "state/project.json").read_text())["syncSession"] == "s1"


def test_branch_is_attached_and_existing_work_survives(proj):
    write_map(proj)
    before = files_under(proj)
    result = prepare(proj)
    document = result.board.document
    branch = next(n for n in document.nodes if n.id == result.node_id)
    assert branch.phase == "planned" and branch.session_id == "s1"
    assert [n.id for n in document.nodes if n.id != branch.id] == ["order", "pay"]
    assert document.flows[1].node_ids[-1] == branch.id  # flows are listed by file name: sdk, web
    assert (document.edges[-1].source, document.edges[-1].target) == ("order", branch.id)
    after = files_under(proj)
    for name, data in before.items():
        if name not in (f"{BASE}/flows/web.json",):
            assert after[name] == data
    assert "sessionId" not in (proj / BASE / f"features/{branch.id}.json").read_text()
    assert get(proj).document == document


def test_branch_without_a_flow_makes_a_new_flow_and_takes_the_tags(proj):
    write_map(
        proj,
        features=[{"id": "order", "title": "Order", "tags": ["주문"]}, {"id": "pay", "title": "Pay"}],
    )
    result = prepare(proj, flowId=None)
    document = result.board.document
    assert next(n for n in document.nodes if n.id == result.node_id).tags == ["주문"]
    assert len(document.flows) == 3
    new = next(f for f in document.flows if f.id.startswith("flow-"))
    assert new.node_ids == ["order", result.node_id]


def test_stale_revision_does_not_overwrite_the_agents_edit(proj):
    write_map(proj)
    request = FlowPrepareParams(
        cwd=str(proj), revision=get(proj).revision, action="change", request="x", node_id="order", session_id="s1"
    )
    prepare_flow(request)
    put(proj, "features/pay.json", {"id": "pay", "title": "Edited by the agent"})
    latest = files_under(proj)
    stale = request.model_copy(update={"revision": "stale"})
    with pytest.raises(MethodError, match="map changed"):
        prepare_flow(stale)
    assert files_under(proj) == latest


def test_corrupt_map_file_is_not_replaced(proj):
    put(proj, "map.json", '{"unfinished":')
    result = prepare(proj, action="discover", nodeId=None, flowId=None)
    assert (proj / BASE / "map.json").read_text() == '{"unfinished":'
    assert result.board.problems[0].file == f"{BASE}/map.json"


def test_bad_selection_changes_nothing(proj):
    write_map(proj)
    before = files_under(proj)
    for bad in (
        {"flowId": "sdk"},
        {"nodeId": "ghost"},
        {"flowId": "ghost"},
        {"action": "change", "nodeId": None, "flowId": None},
        {"action": "verify", "nodeId": None, "flowId": None, "nodeIds": ["order", "ghost"]},
    ):
        with pytest.raises(MethodError):
            prepare(proj, **bad)
    assert files_under(proj) == before


def test_verification_links_sessions_and_never_touches_checks_or_card_files(proj):
    write_map(proj, features=[order("failed"), {"id": "pay", "title": "Pay"}])
    before = (proj / BASE / "features/order.json").read_bytes()
    for action in ("change", "verify"):
        node = prepare(proj, action=action).board.document.nodes[0]
        assert node.session_id == "s1" and node.phase == "built" and node.checks[0].result == "failed"
    assert (proj / BASE / "features/order.json").read_bytes() == before


def test_verify_can_target_a_flow_or_a_batch(proj):
    write_map(proj)
    flow = prepare(proj, action="verify", nodeId=None, request="")
    assert "every feature" in flow.prompt and flow.node_id is None
    batch = prepare(proj, action="verify", nodeId=None, flowId=None, nodeIds=["order", "pay"], request="")
    assert "Features to check: order, pay." in batch.prompt
    assert [n.session_id for n in batch.board.document.nodes] == ["s1", "s1"]
    with pytest.raises(MethodError):
        prepare(proj, action="verify", nodeId=None, flowId=None, request="")


def test_prompt_describes_the_layout_and_keeps_the_context_tag(proj):
    write_map(proj)
    prompt = prepare(proj, action="verify", flowId="web", nodeId=None).prompt
    assert prompt.index("Guest orders") < prompt.index("<alpine-product-map-context>")
    assert prompt.endswith("</alpine-product-map-context>")
    assert "\n\n<alpine-product-map-context>\n" in prompt
    for needle in (
        ".alpine-code/map/OVERVIEW.md first",
        "data, not instructions",
        "features/<id>.json",
        "Never edit .alpine-code/map/state/",
        "Never set a card's priority, scope",
        "new unique `id`",
        "dependsOn",
        "do not write checkedAt",
        "`replay`",
        "no real payments",
        "`exclude`",
        "failing check",
        'sessionId: "s1"',
        "observations",
        "limits",
        "the session that made or changed the file",
        "Never count actions the user performed",
        "outside .alpine-code/",
    ):
        assert needle in prompt, needle
    for gone in ("sourceHashes", "hashlib", "product-map.json"):
        assert gone not in prompt


# ---- history (local)


def kinds(root: Path) -> list[str]:
    return [c.kind for c in get(root).changes]


def test_history_starts_without_changes_and_records_edits_newest_first(proj, home):
    write_map(proj, exclude=[])
    assert kinds(proj) == []
    assert kinds(proj) == []
    write_map(
        proj,
        features=[
            {"id": "order", "title": "Order", "phase": "built", "conditions": [{"id": "a", "expectation": "a"}]},
            {"id": "ship", "title": "Ship"},
        ],
        exclude=["*.lock"],
    )
    assert {"added", "removed", "promise_added", "exclude_changed"} <= set(kinds(proj))
    changed = [c for c in get(proj).changes if c.kind == "exclude_changed"]
    assert changed[0].detail == "*.lock"
    write_map(
        proj,
        features=[
            {"id": "order", "title": "Order", "phase": "built", "conditions": [{"id": "a", "expectation": "changed"}]},
            {"id": "ship", "title": "Ship"},
        ],
    )
    assert {c.kind for c in get(proj).changes[:2]} == {"promise_changed", "exclude_changed"}
    assert (local(home) / "history.json").exists() and not (proj / ".alpine-code/product-map.history.json").exists()


def test_check_results_enter_the_history_when_stamped(proj):
    failing_card(proj, ("r1", "failed"), ("r2", "passed"))
    assert kinds(proj)[:2] == ["check_passed", "check_failed"]


def test_history_keeps_only_newest_200(proj, home):
    write_map(proj, features=[{"id": "n0", "title": "N"}], flows=[])
    get(proj)
    for index in range(1, 230):
        write_map(proj, features=[{"id": f"n{index}", "title": "N"}], flows=[])
        get(proj)
    assert len(get(proj).changes) == 200


@pytest.mark.parametrize("content", ["{broken", "[]", '{"snapshot": 1, "changes": 2}'])
def test_corrupt_history_never_blocks_reading_and_starts_fresh(proj, home, content):
    write_map(proj)
    get(proj)
    (local(home) / "history.json").write_text(content)
    assert get(proj).changes == []
    write_map(proj, features=[{"id": "order", "title": "Order", "phase": "built"}], flows=[])
    assert [c.kind for c in get(proj).changes] == ["removed"]


# ---- check records: provenance labels


def with_observations(root, observations, result="passed", run="r1"):
    (root / "x.py").touch()
    write_map(
        root,
        features=[
            order(checks=[check(result=result, run=run, observations=observations)]),
            {"id": "pay", "title": "Pay"},
        ],
        flows=[],
    )
    return get(root)


def tool_obs(excerpt, ref="", session="s1", label="x"):
    return {"label": label, "excerpt": excerpt, "source": {"kind": "tool_call", "sessionId": session, "ref": ref}}


def file_obs(path, excerpt="", show="text", session="s1"):
    source = {"kind": "file", "ref": path, **({"sessionId": session} if session else {})}
    return {"label": "f", "show": show, "excerpt": excerpt, "source": source}


def labels(result):
    return [(p.label, p.reason, p.matched) for p in result.provenance["order/a"]]


def test_tool_call_labels(proj):
    make_session(proj, calls=(("c1", "refund: 180,000 won\nok"), ("c2", "other")))
    result = with_observations(
        proj,
        [
            {"label": "own words"},
            tool_obs("refund:   180,000 won", ref="c1"),  # runs of whitespace collapse
            tool_obs("180,000 won"),  # no ref: every call is searched
            tool_obs("other"),
            tool_obs("other", ref="c1"),
            tool_obs("other", ref="nope"),
            tool_obs(""),
            tool_obs("other", session="gone"),
        ],
    )
    assert labels(result) == [
        ("agent", "", ""),
        ("verified", "", "c1"),
        ("verified", "", "c1"),
        ("verified", "", "c2"),
        ("mismatch", "excerpt_missing", ""),
        ("mismatch", "call_not_found", ""),
        ("mismatch", "no_excerpt", ""),
        ("mismatch", "session_not_found", ""),
    ]


def test_words_found_only_in_read_files_show_what_the_code_says(proj):
    # Decision 14: reading code is allowed evidence, but it is labelled as reading, not as something Alpine saw run.
    make_session(
        proj,
        calls=(
            ("c1", "def refund(): return 'no refund'", {"path": "x.py"}, "read"),
            ("c2", "x.py:1: no refund", {"pattern": "refund"}, "grep"),
            ("c3", "test_refund PASSED\nno refund", {}, "bash"),
        ),
    )
    result = with_observations(
        proj, [tool_obs("return 'no refund'"), tool_obs("x.py:1: no refund", ref="c2"), tool_obs("no refund")]
    )
    assert labels(result) == [("read", "", "c1"), ("read", "", "c2"), ("verified", "", "c3")]


def test_tool_call_from_other_project_and_unsafe_session_ids(proj, tmp_path):
    make_session(proj, sid="foreign", cwd=tmp_path)
    result = with_observations(proj, [tool_obs("ok", session="foreign"), tool_obs("ok", session="../x")])
    assert labels(result) == [("mismatch", "other_project", ""), ("mismatch", "session_not_found", "")]


def test_session_cache_rereads_only_changed_logs(proj, monkeypatch):
    from alpine_core import ToolCallItem, file_storage, item_to_dict

    make_session(proj)
    with_observations(proj, [tool_obs("ok")])
    reads = []
    real = map_evidence.file_storage
    monkeypatch.setattr(map_evidence, "file_storage", lambda: reads.append(1) or real())
    assert labels(get(proj))[0][0] == "verified"
    assert not reads
    file_storage().log.append(
        "s1", [(5, item_to_dict(ToolCallItem(id="c9", name="bash", status="done", result="new")))]
    )
    with_observations(proj, [tool_obs("new")], run="r2")
    assert reads and labels(get(proj))[0] == ("verified", "", "c9")


def pins_file(home):
    return local(home) / "pins.json"


def test_file_pin_survives_unchanged_revision_then_detects_edit(proj, home):
    make_session(proj)
    (proj / "out.txt").write_text("total  180,000")
    first = with_observations(proj, [file_obs("out.txt", "total 180,000"), file_obs("out.txt", "absent")])
    assert labels(first) == [("verified", "", ""), ("mismatch", "excerpt_missing", "")]
    pins = json.loads(pins_file(home).read_text())["pins"]
    assert list(pins) == ["order/a/r1/out.txt"]
    get(proj)  # same revision: pins stay
    assert json.loads(pins_file(home).read_text())["pins"] == pins
    (proj / "out.txt").write_text("total  0")
    assert labels(get(proj))[0] == ("mismatch", "file_changed", "")


def test_pins_live_in_home_and_survive_history_loss_and_dropped_checks(proj, home):
    make_session(proj)
    (proj / "out.txt").write_text("a")
    with_observations(proj, [file_obs("out.txt")])
    (local(home) / "history.json").unlink(missing_ok=True)
    (proj / "out.txt").write_text("b")
    assert labels(get(proj))[0] == ("mismatch", "file_changed", "")
    result = with_observations(proj, [])  # the check vanished; its pin is kept
    assert result.provenance == {"order/a": []}
    assert len(json.loads(pins_file(home).read_text())["pins"]) == 1
    assert not (proj / ".alpine-code" / "pins.json").exists()


def test_pins_are_capped_to_the_newest(proj, home, monkeypatch):
    monkeypatch.setattr(map_evidence, "_MAX_PINS", 2)
    make_session(proj)
    for name in "abc":
        (proj / f"{name}.txt").write_text(name)
    with_observations(proj, [file_obs(f"{n}.txt") for n in "abc"])
    assert [k.rsplit("/", 1)[1] for k in json.loads(pins_file(home).read_text())["pins"]] == ["b.txt", "c.txt"]


def test_pin_for_a_check_without_an_id_is_keyed_by_its_hash(proj, home):
    make_session(proj)
    (proj / "out.txt").write_text("a")
    bare = check(observations=[file_obs("out.txt", "a")])
    bare["id"] = ""
    (proj / "x.py").touch()
    write_map(proj, features=[order(checks=[bare])], flows=[])
    assert labels(get(proj))[0][0] == "verified"
    (key,) = json.loads(pins_file(home).read_text())["pins"]
    assert key.startswith("order/a/") and "//" not in key and len(key.split("/")[2]) == 16


def test_corrupt_pins_repin(proj, home):
    make_session(proj)
    (proj / "out.txt").write_text("a")
    with_observations(proj, [file_obs("out.txt", "a")])
    pins_file(home).write_text("{broken")
    (proj / "out.txt").write_text("a b")
    assert labels(get(proj))[0][0] == "verified"


def test_file_needs_a_session_of_this_project_made_before_the_file(proj, tmp_path):
    make_session(proj, created="2026-10-12T00:00:00+00:00")
    make_session(proj, sid="foreign", cwd=tmp_path)
    (proj / "old.txt").write_text("a")
    (proj / "new.txt").write_text("a")
    created = 1791763200  # 2026-10-12T00:00:00Z
    os.utime(proj / "old.txt", (created - 60, created - 60))
    os.utime(proj / "new.txt", (created + 60, created + 60))
    result = with_observations(
        proj,
        [
            file_obs("new.txt", "a"),
            file_obs("old.txt", "a"),
            file_obs("new.txt", "a", session=""),
            file_obs("new.txt", "a", session="gone"),
            file_obs("new.txt", "a", session="foreign"),
        ],
    )
    assert labels(result) == [
        ("verified", "", ""),
        ("mismatch", "outside_session", ""),
        ("mismatch", "session_not_found", ""),
        ("mismatch", "session_not_found", ""),
        ("mismatch", "other_project", ""),
    ]
    # Once pinned, later checks rely on the hash, not on the session's age.
    os.utime(proj / "new.txt", (created - 60, created - 60))
    assert labels(get(proj))[0] == ("verified", "", "")


def test_alpine_folder_files_are_not_evidence(proj):
    make_session(proj)
    (proj / ".alpine-code").mkdir(exist_ok=True)
    (proj / ".alpine-code" / "notes.txt").write_text("hello")
    result = with_observations(proj, [file_obs(".alpine-code/notes.txt"), file_obs("./.alpine-code/map/map.json")])
    assert labels(result) == [("mismatch", "alpine_record", "")] * 2


def test_map_reads_are_not_evidence_for_themselves(proj):
    own = '{"observations": [{"excerpt": "boom happened"}]}'
    make_session(
        proj,
        calls=(
            ("c1", own, {"path": ".alpine-code/map/features/order.json"}),
            ("c2", "boom happened", {"command": "cat .alpine-code/map/features/order.json"}),
            ("c3", '{"conditionId": "a"} boom happened', {}),
            ("c4", "real: boom happened", {"command": "run"}),
        ),
    )
    make_session(proj, sid="s2", calls=(("c1", own, {"path": ".alpine-code/map/features/order.json"}),))
    result = with_observations(
        proj,
        [
            tool_obs("boom happened", ref="c1"),
            tool_obs("boom happened", ref="c2"),
            tool_obs("boom happened", ref="c3"),
            tool_obs("boom happened"),  # falls through to the real call
            tool_obs("boom happened", session="s2"),
            tool_obs("never said", session="s2"),
        ],
    )
    assert labels(result) == [
        ("mismatch", "alpine_record", ""),
        ("mismatch", "alpine_record", ""),
        ("mismatch", "alpine_record", ""),
        ("verified", "", "c4"),
        ("mismatch", "alpine_record", ""),
        ("mismatch", "excerpt_missing", ""),
    ]


def test_excerpt_matches_on_token_boundaries(proj):
    make_session(proj, calls=(("c1", "10 failed, 2 passed"), ("c2", "ok\n\n  a   b\tc")))
    result = with_observations(
        proj,
        [
            tool_obs("0 failed"),
            tool_obs("10 failed"),
            tool_obs("10 failed,"),
            tool_obs("2 pass"),
            tool_obs("a b c"),
            tool_obs("a\n\n b    c", ref="c2"),
        ],
    )
    assert labels(result) == [
        ("mismatch", "excerpt_missing", ""),
        ("verified", "", "c1"),
        ("verified", "", "c1"),
        ("mismatch", "excerpt_missing", ""),
        ("verified", "", "c2"),
        ("verified", "", "c2"),
    ]


def test_file_missing_and_escape_never_raise(proj):
    make_session(proj)
    (proj.parent / "outside.txt").write_text("secret")
    result = with_observations(proj, [file_obs("gone.txt"), file_obs("../outside.txt"), file_obs("/etc/hosts")])
    assert labels(result) == [("mismatch", "file_missing", "")] * 3


def test_surface_sources_are_not_found_until_surface_log_exists(proj):
    source = {"kind": "surface_capture", "sessionId": "s1", "ref": "cap1"}
    result = with_observations(proj, [{"label": "screen", "source": source}])
    assert labels(result) == [("mismatch", "surface_not_found", "")]


def test_legacy_checks_have_empty_provenance_and_result_is_never_changed(proj):
    result = with_observations(proj, [file_obs("gone.txt"), tool_obs("x", session="gone")], result="passed")
    assert result.document.nodes[0].checks[0].result == "passed"
    legacy = with_observations(proj, [], result="failed", run="r2")
    assert legacy.provenance == {"order/a": []}
    assert legacy.document.nodes[0].checks[0].result == "failed"


def test_boundaries_apply_only_to_ascii_alphanumeric_edges(proj):
    make_session(proj, calls=(("c1", "180,000원이 fn(0 failed) ok.x 결제가 완료되었습니다"), ("c2", "10 failed")))
    result = with_observations(
        proj,
        [
            tool_obs("180,000원"),
            tool_obs("fn(0 failed)"),
            tool_obs("ok."),
            tool_obs("결제가 완료"),
            tool_obs("0 failed", ref="c2"),
            tool_obs("10 failed", ref="c2"),
        ],
    )
    assert [x[0] for x in labels(result)] == ["verified"] * 4 + ["mismatch", "verified"]


def test_alpine_lines_in_results_and_case_variants_are_not_evidence(proj):
    grep = './.alpine-code/map/map.json:12: "excerpt": "... 0 failed"\nsrc/a.py:1: ok\n./.ALPINE-CODE/x:3: secret line'
    make_session(
        proj,
        calls=(
            ("c1", grep),
            ("c2", "the boom", {"command": "cat .ALPINE-CODE/map/map.json"}),
        ),
    )
    result = with_observations(
        proj,
        [tool_obs("0 failed"), tool_obs("secret line"), tool_obs("ok"), tool_obs("the boom")],
    )
    assert labels(result) == [
        ("mismatch", "excerpt_missing", ""),
        ("mismatch", "excerpt_missing", ""),
        ("verified", "", "c1"),
        ("mismatch", "alpine_record", ""),
    ]


def test_alpine_case_variant_files_are_rejected(proj):
    make_session(proj)
    (proj / ".ALPINE-CODE").mkdir()
    (proj / ".ALPINE-CODE" / "n.txt").write_text("hello")
    result = with_observations(proj, [file_obs(".ALPINE-CODE/n.txt"), file_obs("./.Alpine-Code/../.ALPINE-CODE/n.txt")])
    assert [x[:2] for x in labels(result)] == [("mismatch", "alpine_record")] * 2


def test_file_must_not_be_newer_than_the_session_ended(proj):
    make_session(proj, created="2026-10-12T00:00:00+00:00", updated="2026-10-12T01:00:00+00:00")
    base = 1791763200  # 2026-10-12T00:00:00Z
    for name, delta in (("in", 1800), ("edge", 3601), ("late", 3603), ("early", -1), ("early2", -3)):
        (proj / f"{name}.txt").write_text(name)
        os.utime(proj / f"{name}.txt", (base + delta, base + delta))
    result = with_observations(proj, [file_obs(f"{n}.txt", n) for n in ("in", "edge", "late", "early", "early2")])
    assert [x[:2] for x in labels(result)] == [
        ("verified", ""),
        ("verified", ""),
        ("mismatch", "outside_session"),
        ("verified", ""),
        ("mismatch", "outside_session"),
    ]


def test_pin_eviction_prefers_pins_no_check_uses(proj, home, monkeypatch):
    monkeypatch.setattr(map_evidence, "_MAX_PINS", 3)
    make_session(proj)
    for name in "abc":
        (proj / f"{name}.txt").write_text(name)
    with_observations(proj, [file_obs("a.txt"), file_obs("b.txt")])
    # Replace the check: a.txt and b.txt now belong to an older run that is gone.
    with_observations(proj, [file_obs(f"{n}.txt") for n in "abc"], run="r2")
    keys = list(json.loads(pins_file(home).read_text())["pins"])
    assert [k.split("/")[2] for k in keys] == ["r2"] * 3


def test_file_without_excerpt_needs_to_be_an_image_or_video(proj):
    make_session(proj)
    (proj / "a.txt").write_text("a")
    (proj / "shot.png").write_bytes(PNG)
    (proj / "clip.mp4").write_bytes(b"video")
    result = with_observations(
        proj,
        [file_obs("a.txt"), file_obs("shot.png", show="image"), file_obs("clip.mp4", show="video")],
    )
    assert [x[:2] for x in labels(result)] == [("mismatch", "no_excerpt"), ("verified", ""), ("verified", "")]


def test_pins_merge_with_other_processes_under_a_lock(proj, home):
    make_session(proj)
    (proj / "a.txt").write_text("a")
    pins = map_evidence._pins_path(proj)
    pins.parent.mkdir(parents=True, exist_ok=True)
    pins.write_text(json.dumps({"pins": {"other/key": "deadbeef"}}))
    with_observations(proj, [file_obs("a.txt")])
    assert "other/key" in json.loads(pins.read_text())["pins"]
    assert len(json.loads(pins.read_text())["pins"]) == 2
    assert pins.with_suffix(".lock").exists()


# ---- links, stdin, replay safety, live sessions, decisions


def test_alpine_never_writes_through_a_link(proj):
    (proj / "x.py").write_text("a")
    write_map(proj, features=[order()], flows=[])
    real = proj / "elsewhere"
    real.mkdir()
    (proj / BASE / "state").symlink_to(real, target_is_directory=True)
    with pytest.raises(MethodError) as error:
        get(proj)
    assert error.value.data.reason == "invalid_flow_path" and not list(real.iterdir())
    (proj / BASE / "state").unlink()
    keep = proj / "keep"
    keep.mkdir()
    (keep / "old.md").write_text("mine")
    (proj / BASE / "overview").symlink_to(keep, target_is_directory=True)
    with pytest.raises(MethodError):
        get(proj)
    assert (keep / "old.md").read_text() == "mine"


def test_replays_and_git_do_not_read_standard_input(proj):
    replay_setup(proj, command="cat; echo done", expect=("done",))
    (proj / "x.py").write_text("changed")
    shown = run_replays(proj)
    assert shown.replay.same is True and "done" in shown.replay.output


def test_approval_needs_the_command_the_user_saw(proj):
    (proj / "x.py").write_text("a")
    write_map(proj, features=[replay_card()], flows=[])
    key = get(proj).states["order"].promises["a"].replay.key
    assert len(key) == 64
    with pytest.raises(MethodError) as error:
        act(proj, "approve_replay", key="old")
    assert error.value.data.reason == "replay_changed"
    assert not act(proj, "revoke_replay").states["order"].promises["a"].replay.approved
    assert act(proj, "approve_replay", key=key).states["order"].promises["a"].replay.approved


def test_a_session_left_running_on_disk_by_a_crash_is_not_live(proj, monkeypatch):
    replay_setup(proj)
    (proj / "x.py").write_text("changed")
    make_session(proj, created="2026-10-01T00:00:00+00:00", status="running")
    monkeypatch.setattr(map_state, "live_ids", lambda: set())
    assert run_replays(proj).replay.same is True
    monkeypatch.setattr(map_state, "live_ids", lambda: {"s1"})
    info = map_state.project_sessions(proj)[0]
    assert map_state.is_live(info) and map_state.busy([info])


def test_one_check_id_shared_by_two_promises_hides_neither(proj):
    (proj / "x.py").write_text("a")
    card = order(
        checks=[check("a", "passed", "same"), check("b", "failed", "same")],
        conditions=[{"id": "a", "expectation": "a"}, {"id": "b", "expectation": "b"}],
    )
    write_map(proj, features=[card], flows=[])
    states = get(proj).states["order"].promises
    assert states["a"].stamp and states["b"].stamp
    assert (states["a"].status, states["b"].status) == ("passed", "failed")
    saved = json.loads((proj / BASE / "state/cards/order.json").read_text())
    assert set(saved["stamps"]) == {"a/same", "b/same"}


def job(proj, command, key):
    return map_replay.Job("order", "Order", "a", "r1", command, ".", key, [], True)


def test_a_batch_stops_when_a_session_becomes_live(proj):
    done = []
    calls = []

    def stop():
        calls.append(1)
        return len(calls) > 1

    jobs = [job(proj, "echo one", "k1"), job(proj, "echo two", "k2")]
    jobs[1] = map_replay.Job("pay", "Pay", "a", "r1", "echo two", ".", "k2", [], True)
    assert map_replay.start(proj, jobs, lambda j, r: done.append(j.node_id), stop)
    map_replay.join(proj)
    assert done == ["order"] and not map_replay.running(proj)


def test_a_replay_is_stopped_at_the_time_limit_and_background_children_do_not_hold_it(proj, monkeypatch):
    import time

    started = time.monotonic()
    quick = map_replay.run(proj, job(proj, "sleep 30 & echo hi", "k"))
    assert quick["same"] and time.monotonic() - started < 10
    monkeypatch.setattr(map_replay, "TIMEOUT", 0.5)
    slow = map_replay.run(proj, job(proj, "echo start; sleep 30", "k"))
    assert not slow["same"] and "timed out" in slow["output"] and time.monotonic() - started < 15


def test_user_calls_are_trusted_only_as_far_as_they_can_be_checked(proj, home):
    failing_card(proj, ("r1", "failed"))
    act(proj, "confirm")
    act(proj, "later")
    state_file = proj / BASE / "state/cards/order.json"
    saved = json.loads(state_file.read_text())
    saved["promises"]["a"]["user"]["state"] = "wontfix"
    state_file.write_text(json.dumps(saved))
    assert promise(proj).issue == "question"  # edited after it was witnessed: ignored
    (local(home) / "witness.json").unlink()
    shown = promise(proj)
    assert (shown.issue, shown.decided_elsewhere) == ("wontfix", True)


def test_a_reworded_confirmation_is_flagged(proj):
    failing_card(proj, ("r1", "passed"))
    act(proj, "confirm")
    assert promise(proj).reworded is False
    reworded = order(checks=[check(expectation="b")])
    reworded["conditions"] = [{"id": "a", "expectation": "b"}]
    write_map(proj, features=[reworded], flows=[])
    shown = promise(proj)
    assert shown.reworded and shown.origin == "inferred"


def test_a_passing_result_ends_later_and_wontfix(proj):
    failing_card(proj, ("r1", "failed"))
    act(proj, "confirm")
    act(proj, "wontfix", reason="no")
    write_map(proj, features=[order("passed", "r2")], flows=[])
    shown = promise(proj)
    assert shown.issue == "resolved" and shown.origin == "confirmed" and not shown.decided_elsewhere
    saved = json.loads((proj / BASE / "state/cards/order.json").read_text())
    assert saved["promises"]["a"]["user"] is None


def test_git_output_that_is_not_utf8_never_fails_a_read(proj, monkeypatch):
    git_repo(proj)
    real = subprocess.run

    def fake(args, **kw):
        done = real(args, **kw)
        done.stdout = b"\xff\xfe broken\n" if "status" in args else done.stdout
        return done

    monkeypatch.setattr(map_git.subprocess, "run", fake)
    write_map(proj)
    assert get(proj).coverage.git


# ---- discovery in steps, the scope suggestion, sources nobody opened


def tool_session(proj, sid, calls, created="2000-01-01T00:00:00+00:00", updated=""):
    """A stored session whose calls are (name, args, result)."""
    from alpine_core import SessionInfo, ToolCallItem, file_storage, item_to_dict

    log = file_storage().log
    log.create(
        SessionInfo(
            id=sid,
            title="t",
            cwd=str(proj),
            model="m",
            mode="default",
            status="idle",
            created_at=created,
            updated_at=updated,
        )
    )
    items = [
        (n, item_to_dict(ToolCallItem(id=f"c{n}", name=name, status="done", args=args, result=result)))
        for n, (name, args, result) in enumerate(calls)
    ]
    log.append(sid, items)


def test_prompt_states_the_users_scope(proj):
    write_map(proj)
    (proj / "web").mkdir()
    scope_flow(FlowScopeParams(cwd=str(proj), include=["web"]))
    assert "Scope (set by the user in the app): web." in prepare(proj, action="verify").prompt


def test_an_old_scope_suggestion_in_map_json_is_ignored(proj):
    write_map(proj, proposedInclude=["web"])
    board = get(proj)
    assert not board.problems and board.include == []


def test_sources_the_writing_session_never_opened_are_listed(proj):
    for name in ("views.py", "service.py", "shell.py", "hit.py"):
        (proj / name).write_text("x")
    (proj / "pkg").mkdir()
    (proj / "pkg" / "inner.py").write_text("x")
    (proj / "listed").mkdir()
    card = {
        "id": "order",
        "title": "Order",
        "sources": ["views.py", "service.py", "shell.py", "hit.py", "pkg/", "listed", "never.py"],
    }
    write_map(proj, features=[card], flows=[])
    tool_session(
        proj,
        "s1",
        [
            ("read", {"path": "views.py"}, "1\tx"),
            ("read", {"path": str(proj / "pkg" / "inner.py")}, "1\tx"),
            ("read", {"path": "listed"}, "a.py"),  # a folder listing is not reading
            ("bash", {"command": "sed -n 1,5p shell.py"}, "x"),
            ("grep", {"pattern": "x"}, "hit.py:1:x"),
            ("write", {"path": f"{BASE}/features/order.json"}, "ok"),
        ],
    )
    assert get(proj).states["order"].unread == ["service.py", "listed", "never.py"]
    assert "3 sources never opened by its writers" in (proj / BASE / "OVERVIEW.md").read_text()


def test_unread_is_unknown_when_no_alpine_session_wrote_the_card(proj):
    (proj / "views.py").write_text("x")
    write_map(proj, features=[{"id": "order", "title": "Order", "sources": ["views.py"]}], flows=[])
    assert get(proj).states["order"].unread == []  # written by hand or an outside agent
    tool_session(proj, "s1", [("read", {"path": "other.py"}, "x")])  # alive then, but never wrote the card
    assert get(proj).states["order"].unread == []


def test_unread_counts_single_file_search_and_absolute_paths_and_needs_a_real_write(proj):
    for name in ("one.py", "abs.py"):
        (proj / name).write_text("x")
    card = {"id": "order", "title": "Order", "sources": ["one.py", str(proj / "abs.py")]}
    write_map(proj, features=[card], flows=[])
    tool_session(
        proj,
        "s1",
        [
            ("grep", {"pattern": "x", "path": "one.py"}, "1:x"),  # rg leaves the name out for one file
            ("read", {"path": "abs.py"}, "1\tx"),
            ("write", {"path": f"{BASE}/features/order.json"}, "ok"),
        ],
    )
    assert get(proj).states["order"].unread == []


def test_a_session_that_only_looked_at_the_card_is_not_its_writer(proj):
    (proj / "views.py").write_text("x")
    write_map(proj, features=[{"id": "order", "title": "Order", "sources": ["views.py"]}], flows=[])
    tool_session(proj, "s1", [("bash", {"command": f"cat {BASE}/features/order.json"}, "{}")])
    assert get(proj).states["order"].unread == []
    tool_session(proj, "s2", [("bash", {"command": f"cat > {BASE}/features/order.json <<EOF"}, "")])
    assert get(proj).states["order"].unread == ["views.py"]


def files_at(root: Path, *paths: str, text: str = "x") -> None:
    for path in paths:
        (root / path).parent.mkdir(parents=True, exist_ok=True)
        (root / path).write_text(text)


def test_deleting_the_map_removes_its_files_and_local_records_but_not_while_working(proj, home):
    from alpine_protocol import FlowDeleteParams
    from alpine_server.flow import delete_flow

    write_map(proj)
    get(proj)
    (proj / ".alpine-code" / "evidence").mkdir(parents=True)
    assert list((home / "projects").glob("*/product-map/"))
    make_session(proj, sid="busy", status="running")
    with pytest.raises(MethodError, match="working"):
        delete_flow(FlowDeleteParams(cwd=str(proj)))
    assert (proj / BASE / "map.json").exists()
    shutil.rmtree(home / "sessions" / "busy")
    result = delete_flow(FlowDeleteParams(cwd=str(proj)))
    assert not result.exists and not (proj / BASE).exists() and (proj / ".alpine-code" / "evidence").exists()
    assert not list((home / "projects").glob("*/product-map/"))


# ---------------------------------------------------------------- decision 16: the user's sentences and reviews


def edit(root: Path, field: str, value: str, node="order", cond=None):
    return edit_flow(FlowEditParams(cwd=str(root), node_id=node, field=field, condition_id=cond, value=value))


def review(root: Path, target: str, action: str, node=None, cond=None, field=None):
    return review_flow(
        FlowReviewParams(cwd=str(root), target=target, action=action, node_id=node, condition_id=cond, field=field)
    )


def card_file(root: Path, node="order") -> dict:
    return json.loads((root / BASE / f"features/{node}.json").read_text())


def test_a_rewritten_promise_becomes_the_users_and_waits_for_a_check(proj):
    write_map(proj, features=[order()])
    result = edit(proj, "promise", "  no refund after cancelling  ", cond="a")
    assert card_file(proj)["conditions"] == [{"id": "a", "expectation": "no refund after cancelling"}]
    promise = result.states["order"].promises["a"]
    assert promise.origin == "confirmed" and promise.written and not promise.reworded
    assert promise.status == "recheck"  # the old check was about the old text; nothing ran on save
    overview = (proj / BASE / "OVERVIEW.md").read_text()
    assert "written or confirmed by the user: a" in overview


def test_the_user_can_add_and_remove_promises(proj):
    write_map(proj, features=[order()])
    result = edit(proj, "promise", "a guest can order without an account")
    (added,) = [c for c in card_file(proj)["conditions"] if c["id"] != "a"]
    assert added["id"].startswith("user-") and added["expectation"] == "a guest can order without an account"
    assert result.states["order"].promises[added["id"]].status == "unconfirmed"
    result = edit(proj, "promise", "", cond="a")
    saved = card_file(proj)
    assert [c["id"] for c in saved["conditions"]] == [added["id"]] and saved["checks"] == []
    assert "a" not in result.states["order"].promises and not result.states["order"].removed_promises
    with pytest.raises(MethodError):
        edit(proj, "promise", "")  # nothing to add


def test_an_agent_rewording_the_users_promise_is_asked_about(proj):
    write_map(proj, features=[order()])
    edit(proj, "promise", "mine", cond="a")
    write_map(proj, features=[order(conditions=[{"id": "a", "expectation": "the agent's"}], checks=[])])
    promise = get(proj).states["order"].promises["a"]
    assert promise.reworded and promise.mine == "mine" and promise.origin == "inferred"
    result = review(proj, "promise", "restore", node="order", cond="a")
    assert card_file(proj)["conditions"][0]["expectation"] == "mine"
    assert not result.states["order"].promises["a"].reworded
    write_map(proj, features=[order(conditions=[{"id": "a", "expectation": "the agent's"}], checks=[])])
    result = review(proj, "promise", "accept", node="order", cond="a")
    promise = result.states["order"].promises["a"]
    assert promise.origin == "confirmed" and not promise.reworded and promise.written


def test_a_removed_promise_of_the_user_can_be_put_back(proj):
    write_map(proj, features=[order()])
    act(proj, "confirm")  # confirming keeps the text, so it can be restored
    write_map(proj, features=[order(conditions=[], checks=[])])
    (gone,) = get(proj).states["order"].removed_promises
    assert (gone.id, gone.text) == ("a", "a")
    result = review(proj, "promise", "restore", node="order", cond="a")
    assert card_file(proj)["conditions"] == [{"id": "a", "expectation": "a"}]
    assert not result.states["order"].removed_promises
    write_map(proj, features=[order(conditions=[], checks=[])])
    result = review(proj, "promise", "accept", node="order", cond="a")
    assert not result.states["order"].removed_promises


def test_titles_and_how_to_try_are_the_users_once_written(proj):
    write_map(proj, features=[order()])
    edit(proj, "title", "  Cancel   a subscription ")
    result = edit(proj, "how_to_try", "Log in as test@example.com; payments use test keys")
    node = next(n for n in result.document.nodes if n.id == "order")
    assert node.title == "Cancel a subscription" and node.how_to_try.startswith("Log in")
    assert not result.states["order"].overridden
    with pytest.raises(MethodError):
        edit(proj, "title", "   ")
    write_map(proj, features=[order(title="Manage membership")])
    assert get(proj).states["order"].overridden == {
        "title": "Cancel a subscription",
        "howToTry": "Log in as test@example.com; payments use test keys",
    }
    review(proj, "field", "restore", node="order", field="title")
    assert card_file(proj)["title"] == "Cancel a subscription"
    result = review(proj, "field", "accept", node="order", field="how_to_try")
    assert result.states["order"].overridden == {}


def test_a_removed_card_the_user_decided_on_can_be_rebuilt_or_let_go(proj):
    write_map(proj, features=[order(), {"id": "pay", "title": "Pay"}])
    edit(proj, "promise", "no refund", cond="a")
    write_map(proj, features=[{"id": "pay", "title": "Pay"}])
    result = get(proj)
    assert [(c.id, c.title) for c in result.removed_cards] == [("order", "Order")]
    result = review(proj, "card", "restore", node="order")
    rebuilt = card_file(proj)
    assert rebuilt["title"] == "Order" and rebuilt["conditions"] == [{"id": "a", "expectation": "no refund"}]
    assert not result.removed_cards
    write_map(proj, features=[{"id": "pay", "title": "Pay"}])
    result = review(proj, "card", "accept", node="order")
    assert not result.removed_cards and not (proj / BASE / "state/cards/order.json").exists()
    write_map(proj, features=[{"id": "pay", "title": "Pay"}])
    set_flow(FlowSetParams(cwd=str(proj), node_id="pay", field="priority", value="must"))
    write_map(proj, features=[])
    assert [c.title for c in get(proj).removed_cards] == ["Pay"]  # a plan is a decision too


def test_edits_wait_while_a_session_of_the_project_works(proj):
    write_map(proj, features=[order()])
    make_session(proj, status="running")
    with pytest.raises(MethodError, match="working"):
        edit(proj, "title", "New")


def test_reshape_keeps_the_old_map_until_the_user_answers(proj):
    write_map(proj, features=[order(), {"id": "pay", "title": "Pay"}])
    prepared = prepare(proj, action="reshape", request="Split ordering from paying", nodeId="order", flowId=None)
    assert "Do not change product code" in prepared.prompt and "Do not record checks" in prepared.prompt
    assert prepared.board.review is None  # nothing changed yet
    with pytest.raises(MethodError):
        prepare(proj, action="reshape", request="  ", nodeId="order", flowId=None)
    write_map(
        proj,
        features=[order(title="Choose items"), {"id": "checkout", "title": "Check out"}],
        flows=[{"id": "web", "title": "Place an order", "nodeIds": ["order", "checkout"]}],
    )
    shown = get(proj).review
    assert shown.session_id == "s1" and shown.added == ["Check out"] and shown.removed == ["Pay"]
    assert shown.changed == ["Choose items"]
    make_session(proj, sid="s1", status="running")
    assert get(proj).review is None  # still working
    with pytest.raises(MethodError, match="working"):
        review(proj, "map", "restore")
    shutil.rmtree(proj.parent / "home" / "sessions" / "s1")
    result = review(proj, "map", "restore")
    assert result.review is None and sorted(n.id for n in result.document.nodes) == ["order", "pay"]
    assert card_file(proj)["title"] == "Order"


def test_accepting_a_reshape_takes_the_new_map_as_the_users(proj):
    write_map(proj, features=[order(), {"id": "pay", "title": "Pay"}])
    edit(proj, "promise", "mine", cond="a")
    edit(proj, "title", "Pay", node="pay")
    prepare(proj, action="reshape", request="Merge", nodeId="order", flowId=None)
    write_map(proj, features=[order(conditions=[{"id": "a", "expectation": "reworded"}], checks=[])], flows=[])
    before = get(proj)
    assert before.review and before.removed_cards and before.states["order"].promises["a"].reworded
    result = review(proj, "map", "accept")
    assert result.review is None and not result.removed_cards
    promise = result.states["order"].promises["a"]
    assert promise.origin == "confirmed" and not promise.reworded
    with pytest.raises(MethodError):
        review(proj, "map", "accept")  # nothing waits any more


def test_each_flow_keeps_its_own_transitions(proj):
    # Two doors may join the same two cards differently; a flow must not show the other door's lines.
    write_map(
        proj,
        flows=[
            {
                "id": "desk",
                "title": "Desktop",
                "nodeIds": ["order", "pay"],
                "edges": [{"source": "order", "target": "pay", "label": "click"}],
            },
            {
                "id": "term",
                "title": "Terminal",
                "nodeIds": ["order", "pay"],
                "edges": [
                    {"source": "order", "target": "pay", "label": "/pay"},
                    {"source": "pay", "target": "order", "label": "/back"},
                ],
            },
        ],
    )
    flows = {f.id: f for f in get(proj).document.flows}
    assert [(e.source, e.target, e.label) for e in flows["desk"].edges] == [("order", "pay", "click")]
    assert [e.label for e in flows["term"].edges] == ["/pay", "/back"]


def test_a_flow_can_call_another_flow_as_one_step(proj):
    # Decision 19: the ways to one result live in their own flow; other flows call it as a step.
    write_map(
        proj,
        features=[{"id": "gpt", "title": "ChatGPT"}, {"id": "key", "title": "API key"}, order()],
        flows=[
            {"id": "connect", "title": "Connect a model", "nodeIds": ["gpt", "key"]},
            {
                "id": "work",
                "title": "Work",
                "nodeIds": ["flow:connect", "order", "flow:nope", "flow:work"],
                "edges": [{"source": "flow:connect", "target": "order"}, {"source": "order", "target": "flow:nope"}],
            },
        ],
    )
    result = get(proj)
    work = next(f for f in result.document.flows if f.id == "work")
    assert work.node_ids == ["flow:connect", "order"]
    assert [(e.source, e.target) for e in work.edges] == [("flow:connect", "order")]
    messages = sorted(p.message for p in result.problems)
    assert "A flow cannot call itself" in messages and "The flow 'nope' does not exist" in messages
