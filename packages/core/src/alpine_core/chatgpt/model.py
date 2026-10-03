"""A Model that runs on the user's ChatGPT plan: OpenAI's Responses API with the signed-in account's token.

What this route requires (developers.openai.com/siwc/token-sharing-open-source/preview-limitations, and what the
spike found, docs/chatgpt-sign-in.md):

- ``store: false`` and ``stream: true``; the whole conversation goes in ``input`` every time.
- The system prompt goes in ``instructions``. No ``temperature``, ``max_output_tokens`` and similar fields.
- Output items arrive only as ``response.output_item.done`` events: ``response.completed`` has an empty ``output``.
- Reasoning carries to the next request as the ``reasoning`` item with its ``encrypted_content``, kept here as a
  ``RawBlock`` and sent back without ``id`` or ``status`` (nothing is stored on OpenAI's side).
- Errors never switch to another way of paying: a used-up plan stops the run.

The generic part (Responses API, a token that is looked up per request) is meant to move into alpineagents.
"""

from __future__ import annotations

import asyncio
import json
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

from alpineagents import ContextTooLongError, Model
from alpineagents.models.base import OnEvent, OnText
from alpineagents.types import (
    INVALID_ARGS_KEY,
    TRUNCATED_ARGS_MESSAGE,
    Image,
    Message,
    ModelEvent,
    RawBlock,
    Reply,
    Request,
    TextBlock,
    ToolCall,
    ToolResultBlock,
    Usage,
)

from .oauth import RESOURCE
from .tokens import ChatGPTError, ChatGPTTokens, SignInNeeded, UsageLimitError

#: Used until the model catalog has been read.
DEFAULT_CONTEXT_WINDOW = 272_000
_ERROR_PREFIX = "Error: "
_IMAGES_MOVED = "({} in the next user message, inside <tool_result> tags)"
#: Errors that say "try again shortly", and how long to wait before each retry.
_TEMPORARY = {"subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable"}
_RETRY_DELAYS = (1.0, 4.0)
#: Sent as ``client_version`` when listing models. Without it ChatGPT answers with an old catalog that lacks newer
#: models; a version above any real Codex release gets the current one.
_CATALOG_CLIENT_VERSION = "1.0.0"


@dataclass(frozen=True)
class ModelInfo:
    """One entry of the signed-in account's model catalog."""

    slug: str
    display_name: str
    context_window: int | None = None


def fetch_models(token: str, timeout: float = 15) -> list[ModelInfo]:
    """The models this account may use, in OpenAI's order, without the hidden ones.

    Raises:
        SignInNeeded: The token was rejected.
        ChatGPTError: Anything else went wrong.
    """
    request = urllib.request.Request(
        f"{RESOURCE}/models?client_version={_CATALOG_CLIENT_VERSION}", headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise SignInNeeded("ChatGPT did not accept the sign-in. Sign in again.") from e
        raise ChatGPTError(f"Listing ChatGPT models failed ({e.code}).") from e
    except (OSError, ValueError) as e:
        raise ChatGPTError(f"Could not reach ChatGPT to list models: {e}") from e
    return [
        ModelInfo(m["slug"], m.get("display_name") or m["slug"], m.get("context_window"))
        for m in body.get("models", [])
        if m.get("slug") and m.get("visibility", "list") == "list"
    ]


class ChatGPTModel(Model):
    """A model on the user's ChatGPT plan, through connection ``tokens``.

    Args:
        name: The model's slug, e.g. ``"gpt-5.5"``.
        tokens: The connection's tokens; each request asks it for a current one.
        context_window: Overrides the catalog's size.
        reasoning_effort: ``"low"``, ``"medium"``, ``"high"``... ``None`` leaves the model's default.
        timeout: Request timeout in seconds.
    """

    provider = "chatgpt"

    def __init__(
        self,
        name: str,
        tokens: ChatGPTTokens,
        *,
        context_window: int | None = None,
        reasoning_effort: str | None = None,
        timeout: float | None = None,
    ) -> None:
        self.name = name
        self.tokens = tokens
        self.reasoning_effort = reasoning_effort
        self.timeout = timeout
        self.retries = len(_RETRY_DELAYS)
        self._context_window = context_window
        self._catalog_read = context_window is not None

    @property
    def context_window(self) -> int:
        """The explicit size, else the catalog's (read on the first request), else ``DEFAULT_CONTEXT_WINDOW``."""
        return self._context_window or DEFAULT_CONTEXT_WINDOW

    # ------------------------------------------------------------ requests

    def respond(self, request: Request, on_text: OnText | None = None, on_event: OnEvent | None = None) -> Reply:
        """Streams one request. See the module docstring for the route's rules.

        Raises:
            UsageLimitError: The plan or this app's limit is used up.
            SignInNeeded: The sign-in has ended.
            ContextTooLongError: The conversation is too big for the model.
            ChatGPTError: Anything else.
        """
        import openai

        self._read_catalog()
        body = self._request_body(request)
        for attempt in range(len(_RETRY_DELAYS) + 1):
            token = self.tokens.access_token()
            client = openai.OpenAI(api_key=token, base_url=RESOURCE, max_retries=0, timeout=self.timeout)
            collected = _Collected(on_text)
            try:
                with client.responses.create(**body) as stream:
                    for event in stream:
                        collected.add(event)
                return self._to_reply(collected)
            except openai.APIStatusError as e:
                delay = self._recover(e, token, attempt, collected, on_event)
            except openai.APIConnectionError as e:
                delay = self._recover_unreachable(e, attempt, collected, on_event)
            except _Failed as e:
                delay = self._recover_failed(e, attempt, collected, on_event)
            time.sleep(delay)
        raise AssertionError("unreachable")  # the last attempt raises in _recover

    async def arespond(self, request: Request, on_text: OnText | None = None, on_event: OnEvent | None = None) -> Reply:
        """The async version of ``respond``. Cancelling it closes the stream."""
        import openai

        await asyncio.to_thread(self._read_catalog)
        body = self._request_body(request)
        for attempt in range(len(_RETRY_DELAYS) + 1):
            token = await asyncio.to_thread(self.tokens.access_token)
            client = openai.AsyncOpenAI(api_key=token, base_url=RESOURCE, max_retries=0, timeout=self.timeout)
            collected = _Collected(on_text)
            try:
                async with await client.responses.create(**body) as stream:
                    async for event in stream:
                        collected.add(event)
                return self._to_reply(collected)
            except openai.APIStatusError as e:
                delay = await asyncio.to_thread(self._recover, e, token, attempt, collected, on_event)
            except openai.APIConnectionError as e:
                delay = self._recover_unreachable(e, attempt, collected, on_event)
            except _Failed as e:
                delay = self._recover_failed(e, attempt, collected, on_event)
            finally:
                await client.close()
            await asyncio.sleep(delay)
        raise AssertionError("unreachable")

    def _read_catalog(self) -> None:
        """Takes the context window from the account's catalog, once. A failure keeps the default."""
        if self._catalog_read:
            return
        self._catalog_read = True
        try:
            for info in fetch_models(self.tokens.access_token()):
                if info.slug == self.name and info.context_window:
                    self._context_window = info.context_window
        except ChatGPTError:
            pass

    # ------------------------------------------------------------ errors

    def _recover(self, error: Any, token: str, attempt: int, collected: _Collected, on_event: OnEvent | None) -> float:
        """Seconds to wait before retrying ``error`` (an HTTP error before or while streaming), or raises."""
        status, code, message = error.status_code, _code(error.body), _message(error.body, str(error))
        can_retry = attempt < len(_RETRY_DELAYS) and not collected.streamed
        if status == 401 or code == "subscription_sharing_invalid_user":
            if attempt == 0 and not collected.streamed:
                self.tokens.refresh_after_rejection(token)
                return 0.0
            raise SignInNeeded(f"ChatGPT did not accept the sign-in: {message}", code) from error
        if code == "subscription_sharing_usage_limit_exceeded":
            raise UsageLimitError(_LIMIT_MESSAGE, code) from error
        if code == "context_length_exceeded":
            raise ContextTooLongError(message) from error
        if can_retry and (code in _TEMPORARY or status == 503 or status >= 500):
            return self._retrying(attempt, message, on_event)
        raise ChatGPTError(_explain(status, code, message), code) from error

    def _recover_unreachable(
        self, error: Exception, attempt: int, collected: _Collected, on_event: OnEvent | None
    ) -> float:
        if attempt < len(_RETRY_DELAYS) and not collected.streamed:
            return self._retrying(attempt, "no answer", on_event)
        raise ChatGPTError(f"Could not reach ChatGPT: {error}") from error

    def _recover_failed(self, failed: _Failed, attempt: int, collected: _Collected, on_event: OnEvent | None) -> float:
        """Like ``_recover``, for a ``response.failed`` event (an error after streaming began)."""
        if failed.code == "subscription_sharing_usage_limit_exceeded":
            raise UsageLimitError(_LIMIT_MESSAGE, failed.code)
        if failed.code == "context_length_exceeded":
            raise ContextTooLongError(failed.message)
        if failed.code in _TEMPORARY and attempt < len(_RETRY_DELAYS) and not collected.streamed:
            return self._retrying(attempt, failed.message, on_event)
        raise ChatGPTError(_explain(None, failed.code, failed.message), failed.code)

    def _retrying(self, attempt: int, message: str, on_event: OnEvent | None) -> float:
        delay = _RETRY_DELAYS[attempt]
        if on_event is not None:
            on_event(ModelEvent("retry", f"ChatGPT is busy ({message}); trying again in {delay:g}s.", {}))
        return delay

    # ------------------------------------------------------------ conversion

    def _request_body(self, request: Request) -> dict[str, Any]:
        body: dict[str, Any] = {
            "model": self.name,
            "input": self._to_input(request),
            "store": False,
            "stream": True,
            "include": ["reasoning.encrypted_content"],
        }
        if request.system:
            body["instructions"] = request.system
        if request.tools:
            body["tools"] = [
                {"type": "function", "name": t.name, "description": t.description, "parameters": t.input_schema}
                for t in request.tools
            ]
            if request.tool_choice == "none":
                body["tool_choice"] = "none"
        if self.reasoning_effort:
            body["reasoning"] = {"effort": self.reasoning_effort}
        return body

    def _to_input(self, request: Request) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for message in self._merge_same_role(request.messages):
            if message.role == "assistant":
                items.extend(self._assistant_items(message))
            else:
                items.extend(self._user_items(message))
        return items

    def _assistant_items(self, message: Message) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for block in message.content:
            if isinstance(block, RawBlock):
                if block.provider == self.provider:
                    items.append(dict(block.data))
            elif isinstance(block, TextBlock):
                if block.text:
                    items.append(
                        {
                            "type": "message",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": block.text}],
                        }
                    )
            elif isinstance(block, ToolCall):
                items.append(
                    {
                        "type": "function_call",
                        "call_id": block.id,
                        "name": block.name,
                        "arguments": json.dumps(block.args, ensure_ascii=False),
                    }
                )
        return items

    def _user_items(self, message: Message) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        images: list[dict[str, Any]] = []
        text: list[str] = []
        for block in message.content:
            if isinstance(block, ToolResultBlock):
                output = _result_text(block)
                items.append(
                    {
                        "type": "function_call_output",
                        "call_id": block.call_id,
                        "output": _ERROR_PREFIX + output if block.is_error else output,
                    }
                )
                images.extend(_result_images(block))
            elif isinstance(block, TextBlock):
                text.append(block.text)
            elif isinstance(block, Image):  # one the user attached
                images.append(_input_image(block))
        joined = "".join(text)
        if images:
            parts = images + ([{"type": "input_text", "text": joined}] if joined else [])
            items.append({"role": "user", "content": parts})
        elif joined:
            items.append({"role": "user", "content": joined})
        return items

    def _to_reply(self, collected: _Collected) -> Reply:
        if not collected.finished:
            raise ChatGPTError("The ChatGPT stream ended before the reply was complete.")
        blocks: list[Any] = []
        for item in collected.items:
            kind = item.get("type")
            if kind == "reasoning":
                kept = {k: v for k, v in item.items() if k not in ("id", "status")}
                blocks.append(RawBlock(self.provider, kept))
            elif kind == "message":
                text = "".join(p.get("text", "") for p in item.get("content", []) if p.get("type") == "output_text")
                if text:
                    blocks.append(TextBlock(text))
            elif kind == "function_call":
                blocks.append(ToolCall(item.get("name", ""), _args(item.get("arguments", "")), item["call_id"]))
        if collected.incomplete:
            calls = [i for i, b in enumerate(blocks) if isinstance(b, ToolCall)]
            if calls:  # cut off by the output limit: the last call may be partial even if it parses
                last = blocks[calls[-1]]
                blocks[calls[-1]] = replace(last, args={INVALID_ARGS_KEY: TRUNCATED_ARGS_MESSAGE})
        usage, context_tokens = _usage(collected.usage)
        return Reply(
            message=Message("assistant", tuple(blocks)),
            usage=replace(usage, cost=self._cost(usage)),
            context_tokens=context_tokens,
            stop_reason="incomplete" if collected.incomplete else "completed",
            model=collected.model or self.name,
        )


# ---------------------------------------------------------------- the stream


class _Failed(Exception):
    """A ``response.failed`` or ``error`` event."""

    def __init__(self, code: str | None, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class _Collected:
    """What one stream delivered, event by event."""

    def __init__(self, on_text: Callable[[str], None] | None) -> None:
        self.on_text = on_text
        self.items: list[dict[str, Any]] = []
        self.usage: dict[str, Any] | None = None
        self.model: str | None = None
        self.incomplete = False
        self.finished = False
        self.streamed = False
        """Whether text already reached ``on_text``: after that, a retry would show it twice."""

    def add(self, event: Any) -> None:
        kind = event.type
        if kind == "response.output_text.delta":
            if event.delta and self.on_text is not None:
                self.streamed = True
                self.on_text(event.delta)
        elif kind == "response.output_item.done":
            self.items.append(event.item.model_dump(exclude_none=True))
        elif kind in ("response.completed", "response.incomplete"):
            response = event.response
            self.finished = True
            self.incomplete = kind == "response.incomplete"
            self.model = getattr(response, "model", None)
            usage = getattr(response, "usage", None)
            self.usage = usage.model_dump(exclude_none=True) if usage is not None else None
        elif kind == "response.failed":
            error = getattr(event.response, "error", None)
            raise _Failed(getattr(error, "code", None), getattr(error, "message", None) or "the response failed")
        elif kind == "error":
            raise _Failed(
                getattr(event, "code", None), getattr(event, "message", None) or "the stream reported an error"
            )


# ---------------------------------------------------------------- helpers

_LIMIT_MESSAGE = (
    "Your ChatGPT plan's usage limit, or this app's limit, has been reached. "
    "Check it in ChatGPT settings › Usage, or switch to another connection."
)


def _usage(data: dict[str, Any] | None) -> tuple[Usage, int | None]:
    if not data:
        return Usage(requests=1), None
    details = data.get("input_tokens_details") or {}
    cached = details.get("cached_tokens") or 0
    written = details.get("cache_write_tokens") or 0
    total_in, out = data.get("input_tokens", 0), data.get("output_tokens", 0)
    usage = Usage(
        input_tokens=total_in - cached - written,
        output_tokens=out,
        cache_read_tokens=cached,
        cache_write_tokens=written,
        requests=1,
    )
    return usage, total_in + out


def _args(raw: str) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = None
    return parsed if isinstance(parsed, dict) else {INVALID_ARGS_KEY: raw}


def _result_text(block: ToolResultBlock) -> str:
    if isinstance(block.content, str):
        return block.content
    texts = [b.text for b in block.content if isinstance(b, TextBlock)]
    count = sum(isinstance(b, Image) for b in block.content)
    if not count:
        return "\n".join(texts)
    return "\n".join([*texts, _IMAGES_MOVED.format("1 image" if count == 1 else f"{count} images")])


def _result_images(block: ToolResultBlock) -> list[dict[str, Any]]:
    if isinstance(block.content, str):
        return []
    images = [b for b in block.content if isinstance(b, Image)]
    if not images:
        return []
    opening = f'<tool_result tool_name="{block.name}" tool_call_id="{block.call_id}">'
    return [
        {"type": "input_text", "text": opening},
        *(_input_image(i) for i in images),
        {"type": "input_text", "text": "</tool_result>"},
    ]


def _input_image(image: Image) -> dict[str, Any]:
    return {"type": "input_image", "image_url": f"data:{image.media_type};base64,{image.base64}"}


def _code(body: Any) -> str | None:
    """OpenAI's error code. Admission errors before a stream carry only ``{"detail": "..."}``, so ``None``."""
    if isinstance(body, dict):
        error = body.get("error", body)
        if isinstance(error, dict) and isinstance(error.get("code"), str):
            return error["code"]
    return None


def _message(body: Any, fallback: str) -> str:
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])
        if body.get("message"):
            return str(body["message"])
        if body.get("detail"):
            return str(body["detail"])
    return fallback


def _explain(status: int | None, code: str | None, message: str) -> str:
    match code:
        case "subscription_sharing_user_not_eligible":
            return "This ChatGPT account or workspace cannot use its plan in other apps."
        case "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable":
            return "ChatGPT could not check the plan's usage right now. Try again in a moment."
        case "subscription_sharing_unsupported_capability":
            return f"ChatGPT's plan route does not support part of this request: {message}"
    where = f" ({status})" if status else ""
    return f"The ChatGPT request failed{where}: {message}"
