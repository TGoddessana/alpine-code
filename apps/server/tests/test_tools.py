import io
import json

import pytest

from alpine_server.stdio import serve

SOURCE = '''from alpineagents import tool


@tool(read_only=True, open_world=True)
def fetch(url: str) -> str:
    """Gets a page.

    Args:
        url: The address
    """
    return url
'''


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    return tmp_path / "home"


def call(method: str, **params) -> dict:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    out = io.StringIO()
    serve(io.StringIO(line + "\n"), out)
    return json.loads(out.getvalue())


def test_saving_a_tool_turns_it_on_in_the_profile_being_viewed(tmp_path):
    profile = call(
        "profiles/save", profile={"id": "", "name": "shop", "project": str(tmp_path), "model": None, "tools": ["read"]}
    )["result"]["profile"]
    saved = call("tools/save", name="fetch", source=SOURCE, enableIn=profile["id"])["result"]["file"]
    assert saved["status"] == "ready"
    assert saved["tools"][0]["ask"] == "ask"
    profiles = call("profiles/list")["result"]["profiles"]
    assert [(p["name"], p["tools"]) for p in profiles] == [
        ("", ["read", "glob", "grep", "write", "edit", "bash"]),
        ("shop", ["read", "fetch"]),
    ]
    assert call("profiles/resolve", cwd=str(tmp_path))["result"]["profile"]["id"] == profile["id"]

    listed = call("tools/list")["result"]
    assert [t["name"] for t in listed["builtin"]] == ["read", "glob", "grep", "write", "edit", "bash"]
    assert [f["name"] for f in listed["files"]] == ["fetch"]

    call("tools/delete", name="fetch")
    assert call("profiles/list")["result"]["profiles"][1]["tools"] == ["read"]


def test_errors_carry_a_reason(tmp_path):
    bad = call("tools/save", name="Bad Name", source=SOURCE)
    assert bad["error"]["data"]["reason"] == "invalid_name"
    call("profiles/save", profile={"id": "", "name": "a", "project": None, "model": "x/y", "tools": []})
    clash = call("profiles/save", profile={"id": "", "name": "b", "project": None, "model": "x/y", "tools": []})
    assert clash["error"]["data"]["reason"] == "profile_conflict"


def test_check_and_test_run_unsaved_code():
    check = call("tools/check", source=SOURCE)["result"]
    assert [t["name"] for t in check["tools"]] == ["fetch"]
    result = call("tools/test", source=SOURCE, tool="fetch", args={"url": "https://example.com"})["result"]
    assert result["ok"] and result["output"] == "https://example.com"
