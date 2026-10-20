import io
import json

import pytest

from alpine_server.stdio import serve


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


BUILTINS = [
    "read",
    "glob",
    "grep",
    "write",
    "edit",
    "bash",
    "process_list",
    "process_read",
    "process_write",
    "process_stop",
]


def test_the_list_has_the_built_in_tools_then_the_memorys(tmp_path):
    listed = call("tools/list", cwd=str(tmp_path))["result"]
    assert [(t["tool"]["name"], t["origin"], t["optional"]) for t in listed["tools"]] == [
        *((name, "builtin", True) for name in BUILTINS),
        ("propose_memory", "memory", False),
    ]
    assert listed["tools"][0]["tool"]["ask"] == "never"
    assert [t["tool"]["name"] for t in call("tools/list")["result"]["tools"]] == [*BUILTINS, "propose_memory"]


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


def test_concurrent_agent_saves_lose_nothing():
    from concurrent.futures import ThreadPoolExecutor

    from alpine_core import AgentConfig
    from alpine_server.agents import agents as shared

    def work(n: int) -> None:
        for i in range(15):
            shared().save(AgentConfig("", f"a{n}-{i}"))

    with ThreadPoolExecutor(4) as pool:
        list(pool.map(work, range(4)))
    assert len(shared().list()) == 1 + 60
