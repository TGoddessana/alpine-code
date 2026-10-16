"""The ``github/*`` methods: signing in to GitHub with the device flow, on the event loop, and listing repositories.

``github/signIn`` answers at once with the code to show; the polling runs as a task, and its end goes out as
``github/signInFinished``. One sign-in waits at a time: a new one cancels the old.
"""

from __future__ import annotations

import asyncio
import sys
import traceback
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from alpine_core import ConfigError, Settings
from alpine_core.github import (
    GitHubUnavailable,
    SignedOut,
    SignIn,
    SignInError,
    access_settings_url,
    access_token,
    client_id,
    forget_account,
    repositories,
    save_account,
    saved_account,
)
from alpine_protocol import (
    GitHubAccountInfo,
    GitHubCancelSignInParams,
    GitHubCancelSignInResult,
    GitHubRepository,
    GitHubReposParams,
    GitHubReposResult,
    GitHubSignInFinishedParams,
    GitHubSignInParams,
    GitHubSignInResult,
    GitHubSignOutParams,
    GitHubSignOutResult,
    GitHubStatusParams,
    GitHubStatusResult,
)

from .methods import APP_ERROR, MethodError

Notify = Callable[[GitHubSignInFinishedParams], None]


class GitHubSignIns:
    """Runs sign-ins and announces how each ended through ``notify``."""

    def __init__(self, notify: Notify, start: Callable[[], Awaitable[SignIn]] = SignIn.start) -> None:
        self._notify = notify
        self._start = start
        self._waiting: dict[str, tuple[SignIn, asyncio.Task[None]]] = {}

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "github/status": self.status,
            "github/signIn": self.sign_in,
            "github/cancelSignIn": self.cancel_sign_in,
            "github/signOut": self.sign_out,
            "github/repos": self.repos,
        }

    async def shutdown(self) -> None:
        for sign_in, task in list(self._waiting.values()):
            sign_in.cancel()
            task.cancel()

    async def status(self, params: GitHubStatusParams) -> GitHubStatusResult:
        account = await asyncio.to_thread(saved_account, _store())
        return GitHubStatusResult(
            available=bool(client_id()),
            account=GitHubAccountInfo(login=account.login) if account else None,
            access_url=access_settings_url(),
        )

    async def sign_in(self, params: GitHubSignInParams) -> GitHubSignInResult:
        for sign_in, _ in list(self._waiting.values()):
            sign_in.cancel()  # its task announces "cancelled"
        try:
            sign_in = await self._start()
        except SignInError as e:
            raise MethodError(APP_ERROR, str(e), "unsupported") from e
        except OSError as e:
            raise MethodError(APP_ERROR, str(e), "unreachable") from e
        attempt_id = uuid.uuid4().hex
        task = asyncio.create_task(self._finish(attempt_id, sign_in))
        self._waiting[attempt_id] = (sign_in, task)
        return GitHubSignInResult(
            attempt_id=attempt_id, user_code=sign_in.code.user_code, verification_uri=sign_in.code.verification_uri
        )

    async def cancel_sign_in(self, params: GitHubCancelSignInParams) -> GitHubCancelSignInResult:
        waiting = self._waiting.get(params.attempt_id)
        if waiting is not None:
            waiting[0].cancel()
        return GitHubCancelSignInResult()

    async def sign_out(self, params: GitHubSignOutParams) -> GitHubSignOutResult:
        await asyncio.to_thread(forget_account, _store())
        return GitHubSignOutResult()

    async def repos(self, params: GitHubReposParams) -> GitHubReposResult:
        store = _store()
        try:
            account = await asyncio.to_thread(access_token, store)
            found = await asyncio.to_thread(repositories, account.token)
        except SignedOut as e:
            await asyncio.to_thread(forget_account, store)
            raise MethodError(APP_ERROR, str(e), "auth") from e
        except GitHubUnavailable as e:
            raise MethodError(APP_ERROR, str(e), "unreachable") from e
        return GitHubReposResult(
            repositories=[
                GitHubRepository(
                    full_name=r.full_name,
                    clone_url=r.clone_url,
                    private=r.private,
                    pushed_at=r.pushed_at,
                    description=r.description,
                )
                for r in found
            ]
        )

    async def _finish(self, attempt_id: str, sign_in: SignIn) -> None:
        finished = GitHubSignInFinishedParams(attempt_id=attempt_id, result="failed")
        try:
            account = await sign_in.wait()
            await asyncio.to_thread(save_account, _store(), account)
            finished = finished.model_copy(
                update={"result": "connected", "account": GitHubAccountInfo(login=account.login)}
            )
        except SignInError as e:
            finished = finished.model_copy(update={"result": e.kind.value, "message": str(e)})
        except asyncio.CancelledError:
            finished = finished.model_copy(update={"result": "cancelled"})
            raise
        except Exception as e:  # a bug, or GitHub gone: still tell the app the sign-in is over
            traceback.print_exc(file=sys.stderr)
            finished = finished.model_copy(update={"message": f"{type(e).__name__}: {e}"})
        finally:
            self._waiting.pop(attempt_id, None)
            self._notify(finished)


def _store() -> Any:
    try:
        return Settings.load().secrets
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
