"""Disposable execution process for the toolbox's Try it action."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from alpineagents import State
from alpineagents.tool import format_result

from .toolbox import Toolbox, _as_text


def main() -> None:
    request_file, result_file = map(Path, sys.argv[1:])
    request = json.loads(request_file.read_text("utf-8"))
    toolbox = Toolbox(Path(request["home"]))
    loaded = toolbox._execute(request["source"], "alpine_user_tool_test", "<test>")
    try:
        if loaded.error:
            raise ValueError(loaded.error)
        tool = loaded.tools.get(request["name"])
        if tool is None:
            raise ValueError(f"No tool named {request['name']}")
        value = tool.run(request["args"], State())
        if tool.is_async:
            value = asyncio.run(value)
        result = {"ok": True, "output": _as_text(format_result(value))}
    except BaseException as exc:
        result = {"ok": False, "output": f"{type(exc).__name__}: {exc}"}
    result_file.write_text(json.dumps(result, ensure_ascii=False), "utf-8")


if __name__ == "__main__":
    main()
