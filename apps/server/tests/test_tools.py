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


def agent(**fields) -> dict:
    return {
        "id": "",
        "name": "shop",
        "description": "",
        "model": None,
        "instructions": "",
        "tools": ["read"],
        "look": "antenna",
        "color": 2,
    } | fields


def test_saving_a_tool_turns_it_on_in_the_agent_being_viewed():
    shop = call("agents/save", agent=agent())["result"]["agent"]
    saved = call("tools/save", name="fetch", source=SOURCE, enableIn=shop["id"])["result"]["file"]
    assert saved["status"] == "ready"
    assert saved["tools"][0]["ask"] == "ask"
    agents = call("agents/list")["result"]["agents"]
    assert [(a["name"], a["tools"]) for a in agents] == [
        ("", ["read", "glob", "grep", "write", "edit", "bash"]),
        ("shop", ["read", "fetch"]),
    ]

    listed = call("tools/list")["result"]
    assert [t["name"] for t in listed["builtin"]] == ["read", "glob", "grep", "write", "edit", "bash"]
    assert [f["name"] for f in listed["files"]] == ["fetch"]

    call("tools/delete", name="fetch")
    assert call("agents/list")["result"]["agents"][1]["tools"] == ["read"]


def test_deleting_a_tool_forgets_it_in_every_agent():
    first = call("agents/save", agent=agent(name="a"))["result"]["agent"]
    second = call("agents/save", agent=agent(name="b", look="glasses", color=3))["result"]["agent"]
    call("tools/save", name="fetch", source=SOURCE, enableIn=first["id"])
    call("agents/save", agent=second | {"tools": ["fetch", "read"]})
    call("tools/delete", name="fetch")
    assert [a["tools"] for a in call("agents/list")["result"]["agents"][1:]] == [["read"], ["read"]]


def test_the_default_agent_cannot_be_deleted():
    assert call("agents/delete", id="default")["result"] == {}
    assert [a["id"] for a in call("agents/list")["result"]["agents"]] == ["default"]


def test_a_new_agent_gets_an_id_and_a_free_character():
    first = call("agents/save", agent=agent(name="a", look="hardhat", color=1))["result"]["agent"]
    second = call("agents/save", agent=agent(name="b", look="hardhat", color=1))["result"]["agent"]
    assert first["id"] and second["id"] and first["id"] != second["id"]
    assert (first["look"], first["color"]) == ("hardhat", 1)
    assert (second["look"], second["color"]) != ("hardhat", 1)
    assert call("agents/delete", id=first["id"])["result"] == {}
    assert [a["id"] for a in call("agents/list")["result"]["agents"]] == ["default", second["id"]]


def test_errors_carry_a_reason():
    bad = call("tools/save", name="Bad Name", source=SOURCE)
    assert bad["error"]["data"]["reason"] == "invalid_name"


def test_check_and_test_run_unsaved_code():
    check = call("tools/check", source=SOURCE)["result"]
    assert [t["name"] for t in check["tools"]] == ["fetch"]
    result = call("tools/test", source=SOURCE, tool="fetch", args={"url": "https://example.com"})["result"]
    assert result["ok"] and result["output"] == "https://example.com"
