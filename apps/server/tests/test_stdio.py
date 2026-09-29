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
    from alpine_server.stdio import HANDLERS

    assert set(HANDLERS) == set(METHODS)
