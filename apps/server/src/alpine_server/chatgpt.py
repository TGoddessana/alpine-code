"""The ``chatgpt/*`` methods: signing in with ChatGPT through the browser, on the event loop.

``chatgpt/signIn`` answers at once with the sign-in page's address; the wait for the browser runs as a task, and its
end goes out as ``chatgpt/signInFinished``. One sign-in waits at a time: a new one cancels the old.
"""

from __future__ import annotations

import asyncio
import sys
import traceback
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from alpine_core import ConfigError, Settings, home_dir
from alpine_core.chatgpt import Account, SignIn, SignInError, account_of, host_id, is_chatgpt, save_account, sign_out
from alpine_protocol import (
    ChatGPTCancelSignInParams,
    ChatGPTCancelSignInResult,
    ChatGPTSignInFinishedParams,
    ChatGPTSignInParams,
    ChatGPTSignInResult,
    ChatGPTSignOutParams,
    ChatGPTSignOutResult,
)

from .methods import APP_ERROR, INVALID_PARAMS, MethodError, connection_info

Notify = Callable[[ChatGPTSignInFinishedParams], None]


class ChatGPTSignIns:
    """Runs sign-ins and announces how each ended through ``notify``."""

    def __init__(self, notify: Notify, start: Callable[..., Awaitable[SignIn]] = SignIn.start) -> None:
        self._notify = notify
        self._start = start
        self._waiting: dict[str, tuple[SignIn, asyncio.Task[None]]] = {}

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "chatgpt/signIn": self.sign_in,
            "chatgpt/cancelSignIn": self.cancel_sign_in,
            "chatgpt/signOut": self.sign_out,
        }

    async def shutdown(self) -> None:
        for sign_in, task in list(self._waiting.values()):
            sign_in.cancel()
            task.cancel()

    async def sign_in(self, params: ChatGPTSignInParams) -> ChatGPTSignInResult:
        previous = self._previous(params.connection) if params.connection else None
        for sign_in, _ in list(self._waiting.values()):
            sign_in.cancel()  # its task announces "cancelled"
        sign_in = await self._start(host_id(home_dir()), previous=previous, consent=params.consent)
        attempt_id = uuid.uuid4().hex
        task = asyncio.create_task(self._finish(attempt_id, sign_in))
        self._waiting[attempt_id] = (sign_in, task)
        return ChatGPTSignInResult(attempt_id=attempt_id, url=sign_in.url)

    async def cancel_sign_in(self, params: ChatGPTCancelSignInParams) -> ChatGPTCancelSignInResult:
        waiting = self._waiting.get(params.attempt_id)
        if waiting is not None:
            waiting[0].cancel()
        return ChatGPTCancelSignInResult()

    async def sign_out(self, params: ChatGPTSignOutParams) -> ChatGPTSignOutResult:
        settings = _settings()
        connection = settings.connections.get(params.connection)
        if connection is None or not is_chatgpt(connection):
            raise MethodError(INVALID_PARAMS, f"No ChatGPT connection named {params.connection!r}")
        revoked = await asyncio.to_thread(sign_out, connection, settings.secrets)
        return ChatGPTSignOutResult(revoked=revoked)

    def _previous(self, name: str) -> Account:
        settings = _settings()
        connection = settings.connections.get(name)
        if connection is None or not is_chatgpt(connection):
            raise MethodError(INVALID_PARAMS, f"No ChatGPT connection named {name!r}")
        account = account_of(connection, settings.secrets)
        if account is None:
            raise MethodError(INVALID_PARAMS, f"Connection {name!r} has never signed in; start a new sign-in")
        return account

    async def _finish(self, attempt_id: str, sign_in: SignIn) -> None:
        finished = ChatGPTSignInFinishedParams(attempt_id=attempt_id, result="failed")
        try:
            account = await sign_in.wait()
            name = await asyncio.to_thread(_keep, account)
            info = await asyncio.to_thread(connection_info, name)
            finished = finished.model_copy(update={"result": "connected", "connection": info})
        except SignInError as e:
            finished = finished.model_copy(update={"result": e.kind.value, "message": str(e)})
        except asyncio.CancelledError:
            finished = finished.model_copy(update={"result": "cancelled"})
            raise
        except Exception as e:  # a bug: still tell the app the sign-in is over
            traceback.print_exc(file=sys.stderr)
            finished = finished.model_copy(update={"message": f"{type(e).__name__}: {e}"})
        finally:
            self._waiting.pop(attempt_id, None)
            self._notify(finished)


def _keep(account: Account) -> str:
    settings = _settings()
    return save_account(account, settings.secrets, settings.connections)


def _settings() -> Settings:
    try:
        return Settings.load()
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
