from alpine_protocol import InitializeParams, InitializeResult, ServerInfo
from alpine_protocol.schema import build


def test_wire_names_are_camel_case():
    params = InitializeParams.model_validate({"protocolVersion": 1, "clientName": "desktop"})
    assert params.protocol_version == 1
    result = InitializeResult(protocol_version=1, server=ServerInfo(name="alpine-code-server", version="0.1.0"))
    assert result.model_dump(by_alias=True) == {
        "protocolVersion": 1,
        "server": {"name": "alpine-code-server", "version": "0.1.0"},
    }


def test_schema_lists_every_message():
    assert {"Request", "Response", "InitializeParams", "InitializeResult"} <= set(build()["$defs"])
