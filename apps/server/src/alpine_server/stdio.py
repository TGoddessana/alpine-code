"""JSON-RPC 2.0 over stdin/stdout, one JSON object per line.

stdout carries only protocol messages; logs go to stderr.
"""

from __future__ import annotations

import json
import sys
import traceback
from typing import Any, TextIO

from pydantic import ValidationError

from alpine_protocol import METHODS, ErrorObject, Request, Response

from .methods import HANDLERS, INVALID_PARAMS, MethodError

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603


def handle(request: Request) -> Response | None:
    """The response to ``request``, or ``None`` for a notification."""
    try:
        result = _call(request)
    except _Failure as failure:
        response = Response(id=request.id, error=failure.error)
    else:
        response = Response(id=request.id, result=result)
    return None if request.id is None else response


class _Failure(Exception):
    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(message)
        self.error = ErrorObject(code=code, message=message, data=data)


def _call(request: Request) -> Any:
    """Runs the method and returns its result as JSON data.

    Raises:
        _Failure: With the error object to send back.
    """
    if request.method not in HANDLERS:
        raise _Failure(METHOD_NOT_FOUND, f"Unknown method: {request.method}")
    params_model, _ = METHODS[request.method]
    try:
        params = params_model.model_validate(request.params or {})
    except ValidationError as e:
        raise _Failure(INVALID_PARAMS, str(e)) from e
    try:
        result = HANDLERS[request.method](params)
    except MethodError as e:
        raise _Failure(e.code, str(e), e.data.model_dump(by_alias=True) if e.data else None) from e
    except Exception as e:
        # A bug in one method must not end the server, which every window shares.
        traceback.print_exc(file=sys.stderr)
        raise _Failure(INTERNAL_ERROR, f"{type(e).__name__}: {e}") from e
    return result.model_dump(by_alias=True, mode="json")


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
