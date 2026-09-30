"""JSON-RPC 2.0 over stdin/stdout, one JSON object per line.

stdout carries only protocol messages; logs go to stderr.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import TextIO

from pydantic import ValidationError

from alpine_protocol import METHODS, ErrorObject, Request, Response

from .methods import HANDLERS, INVALID_PARAMS, MethodError

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603


def handle(request: Request) -> Response | None:
    """The response to ``request``, or ``None`` for a notification."""
    if request.method not in HANDLERS:
        error = ErrorObject(code=METHOD_NOT_FOUND, message=f"Unknown method: {request.method}")
        return None if request.id is None else Response(id=request.id, error=error)
    params_model, _ = METHODS[request.method]
    method = HANDLERS[request.method]
    try:
        params = params_model.model_validate(request.params or {})
    except ValidationError as exc:
        error = ErrorObject(code=INVALID_PARAMS, message=str(exc))
        return None if request.id is None else Response(id=request.id, error=error)
    try:
        result = method(params)
    except MethodError as e:
        data = e.data.model_dump(by_alias=True) if e.data else None
        error = ErrorObject(code=e.code, message=str(e), data=data)
        return None if request.id is None else Response(id=request.id, error=error)
    except Exception as e:
        # A bug in one method must not end the server, which every window shares.
        traceback.print_exc(file=sys.stderr)
        error = ErrorObject(code=INTERNAL_ERROR, message=f"{type(e).__name__}: {e}")
        return None if request.id is None else Response(id=request.id, error=error)
    return None if request.id is None else Response(id=request.id, result=result.model_dump(by_alias=True, mode="json"))


def handle_line(line: str) -> Response | None:
    try:
        data = json.loads(line)
    except json.JSONDecodeError as exc:
        return Response(id=None, error=ErrorObject(code=PARSE_ERROR, message=str(exc)))
    try:
        request = Request.model_validate(data)
    except ValidationError as exc:
        request_id = data.get("id") if isinstance(data, dict) else None
        return Response(id=request_id, error=ErrorObject(code=INVALID_REQUEST, message=str(exc)))
    return handle(request)


def serve(stdin: TextIO, stdout: TextIO) -> None:
    for line in stdin:
        if not line.strip():
            continue
        response = handle_line(line)
        if response is not None:
            stdout.write(response.model_dump_json(by_alias=True, exclude_none=True) + "\n")
            stdout.flush()


def main() -> None:
    serve(sys.stdin, sys.stdout)
