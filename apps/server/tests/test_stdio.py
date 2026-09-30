import io
import json

from alpine_protocol import PROTOCOL_VERSION
from alpine_server.stdio import METHOD_NOT_FOUND, PARSE_ERROR, serve


def run(*lines: str) -> list[dict]:
    out = io.StringIO()
    serve(io.StringIO("".join(line + "\n" for line in lines)), out)
    return [json.loads(line) for line in out.getvalue().splitlines()]


def test_initialize():
    [reply] = run('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientName":"test"}}')
    assert reply["id"] == 1
    assert reply["result"]["protocolVersion"] == PROTOCOL_VERSION
    assert reply["result"]["server"]["name"] == "alpine-code-server"


def test_unknown_method_and_bad_json():
    replies = run('{"jsonrpc":"2.0","id":2,"method":"nope"}', "{not json")
    assert replies[0]["error"]["code"] == METHOD_NOT_FOUND
    assert replies[1]["error"]["code"] == PARSE_ERROR


def test_notifications_get_no_reply():
    assert run('{"jsonrpc":"2.0","method":"nope"}') == []


def test_every_protocol_method_has_a_handler():
    from alpine_protocol import METHODS
    from alpine_server.sessions import SessionManager
    from alpine_server.stdio import HANDLERS

    assert set(HANDLERS) | set(SessionManager(lambda params: None).handlers()) == set(METHODS)


def request(method: str, params: dict | None = None) -> dict:
    [reply] = run(json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}))
    return reply


def test_connections_and_projects(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)

    listed = request("connections/list")["result"]
    assert listed["connections"] == [] and listed["defaultModel"] is None
    assert {"id": "anthropic", "name": "Anthropic", "billing": "usage", "keyEnv": "ANTHROPIC_API_KEY"} in listed[
        "providers"
    ]

    added = request("connections/add", {"provider": "anthropic", "apiKey": "sk-test", "model": "claude-sonnet-5"})
    assert added["result"]["connection"] == {
        "name": "anthropic",
        "provider": "anthropic",
        "baseUrl": None,
        "billing": "usage",
        "hasKey": True,
    }
    assert added["result"]["defaultModel"] == "anthropic/claude-sonnet-5"
    local = request("connections/add", {"baseUrl": "http://localhost:11434/v1", "model": "qwen3", "makeDefault": False})
    assert local["result"]["connection"]["name"] == "local"
    assert request("connections/list")["result"]["defaultModel"] == "anthropic/claude-sonnet-5"

    missing = request("projects/open", {"path": str(tmp_path / "missing")})
    assert missing["error"]["data"] == {"reason": "not_a_folder"}
    opened = request("projects/open", {"path": str(tmp_path)})["result"]["project"]
    assert opened["name"] == tmp_path.name
    listed = request("projects/list")["result"]
    assert [p["path"] for p in listed["projects"]] == [opened["path"]] and listed["cloneParent"]
    assert opened["branch"] is None

    request("projects/archive", {"path": str(tmp_path)})
    assert request("projects/list")["result"]["projects"][0]["archived"] is True
    assert request("connections/setDefault", {"model": "local/qwen3"})["result"] == {"defaultModel": "local/qwen3"}
    assert request("connections/list")["result"]["defaultModel"] == "local/qwen3"

    failed = request("projects/clone", {"address": str(tmp_path / "nope"), "parent": str(tmp_path)})
    assert failed["error"]["data"] == {"reason": "clone_failed"}

    assert request("projects/git", {"path": str(tmp_path)})["result"] == {"git": None}

    request("projects/delete", {"path": str(tmp_path)})
    assert request("projects/list")["result"]["projects"] == []
    assert tmp_path.is_dir()


def test_model_list_errors_say_why(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    reply = request("connections/models", {"baseUrl": "http://127.0.0.1:9/v1"})
    assert reply["error"]["data"] == {"reason": "unreachable"}
