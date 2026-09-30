"""Writes the JSON Schema for every message, which the TypeScript types are generated from.

uv run python -m alpine_protocol.schema > packages/protocol/schema/protocol.schema.json
"""

from __future__ import annotations

import json
import sys

from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from . import messages

MODELS: list[type[BaseModel]] = [
    obj
    for obj in vars(messages).values()
    if isinstance(obj, type) and issubclass(obj, messages.Message) and obj is not messages.Message
]


def build() -> dict:
    _, schema = models_json_schema([(model, "serialization") for model in MODELS], by_alias=True)
    # Field titles ("Protocolversion") would become one named type per field in the generated TypeScript.
    for definition in schema["$defs"].values():
        for field in definition.get("properties", {}).values():
            field.pop("title", None)
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "AlpineProtocol",
        "description": f"alpine-code protocol version {messages.PROTOCOL_VERSION}. Generated; do not edit.",
        "x-methods": {
            name: {"params": params.__name__, "result": result.__name__}
            for name, (params, result) in messages.METHODS.items()
        },
        "x-notifications": {name: params.__name__ for name, params in messages.NOTIFICATIONS.items()},
        **schema,
    }


if __name__ == "__main__":
    json.dump(build(), sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
