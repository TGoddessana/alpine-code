"""The ``cloud/*`` methods: signing in to Alpine, the account, and what later steps add (publish, data, plans).

``cloud/signIn`` answers at once with the sign-in page's address; the wait for the browser runs as a task, and its end
goes out as ``cloud/signInFinished``. One sign-in waits at a time: a new one cancels the old. ``cloud/changed``
follows every change of the status (sign-in, plan, credits), whichever thread caused it.

Methods a later step builds answer ``not_available`` until then.
"""

from __future__ import annotations

import asyncio
import sys
import traceback
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, get_args

from alpine_core.cloud import (
    BrowserSignIn,
    CloudClient,
    CloudError,
    CloudStatus,
    SignedOut,
    SignInError,
    account,
    complete_sign_in,
    send_code,
    sign_out,
    verify_code,
)
from alpine_protocol import ErrorData
from alpine_protocol.cloud import (
    CLOUD_METHODS,
    CloudCancelSignInParams,
    CloudCancelSignInResult,
    CloudChangedParams,
    CloudPlansParams,
    CloudPlansResult,
    CloudSendCodeParams,
    CloudSendCodeResult,
    CloudSignInFinishedParams,
    CloudSignInParams,
    CloudSignInResult,
    CloudSignOutParams,
    CloudSignOutResult,
    CloudStatusParams,
    CloudVerifyCodeParams,
)
from alpine_protocol.cloud import CloudStatus as CloudStatusModel

from .methods import APP_ERROR, MethodError

NotifyFinished = Callable[[CloudSignInFinishedParams], None]
NotifyChanged = Callable[[CloudChangedParams], None]

#: The reasons the protocol knows; an API error code outside them arrives as ``other``.
_KNOWN = set(get_args(ErrorData.model_fields["reason"].annotation))


class CloudMethods:
    """The signed-in side of Alpine Cloud. Later steps add their handlers to ``handlers``."""

    def __init__(self, notify_finished: NotifyFinished, notify_changed: NotifyChanged) -> None:
        self._notify_finished = notify_finished
        self._notify_changed = notify_changed
        self._loop: asyncio.AbstractEventLoop | None = None
        self._waiting: dict[str, tuple[BrowserSignIn, asyncio.Task[None]]] = {}
        self._unsubscribe: Callable[[], None] | None = None

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        later = {name: _not_available(name) for name in CLOUD_METHODS if name.split("/")[0] == "publish"}
        # publish/status, prepare, run, cancel, restorePoints and restore are PublishMethods's (publish.py), the
        # data/ family DataMethods's (data.py).
        later |= {name: _not_available(name) for name in ("cloud/startTrial", "cloud/checkout", "cloud/portal")}
        return later | {
            "cloud/status": self.status,
            "cloud/signIn": self.sign_in,
            "cloud/cancelSignIn": self.cancel_sign_in,
            "cloud/sendCode": self.send_code,
            "cloud/verifyCode": self.verify_code,
            "cloud/signOut": self.sign_out,
            "cloud/plans": self.plans,
        }

    async def shutdown(self) -> None:
        if self._unsubscribe is not None:
            self._unsubscribe()
        for sign_in, task in list(self._waiting.values()):
            sign_in.cancel()
            task.cancel()

    # ---- account

    async def status(self, params: CloudStatusParams) -> CloudStatusModel:
        self._attach()
        return wire_status(await asyncio.to_thread(lambda: account.status(refresh=params.refresh)))

    async def sign_in(self, params: CloudSignInParams) -> CloudSignInResult:
        self._attach()
        for sign_in, _ in list(self._waiting.values()):
            sign_in.cancel()  # its task announces "cancelled"
        sign_in = await BrowserSignIn.start(params.method)
        attempt_id = uuid.uuid4().hex
        task = asyncio.create_task(self._finish(attempt_id, sign_in))
        self._waiting[attempt_id] = (sign_in, task)
        return CloudSignInResult(attempt_id=attempt_id, url=sign_in.url)

    async def cancel_sign_in(self, params: CloudCancelSignInParams) -> CloudCancelSignInResult:
        waiting = self._waiting.get(params.attempt_id)
        if waiting is not None:
            waiting[0].cancel()
        return CloudCancelSignInResult()

    async def send_code(self, params: CloudSendCodeParams) -> CloudSendCodeResult:
        try:
            await asyncio.to_thread(send_code, params.email, params.locale)
        except CloudError as e:
            raise method_error(e) from e
        return CloudSendCodeResult()

    async def verify_code(self, params: CloudVerifyCodeParams) -> CloudStatusModel:
        self._attach()
        try:
            tokens = await asyncio.to_thread(verify_code, params.email, params.code)
            return wire_status(await asyncio.to_thread(complete_sign_in, tokens))
        except CloudError as e:
            raise method_error(e, invalid="invalid_code") from e

    async def sign_out(self, params: CloudSignOutParams) -> CloudSignOutResult:
        self._attach()
        await asyncio.to_thread(sign_out)
        return CloudSignOutResult()

    async def plans(self, params: CloudPlansParams) -> CloudPlansResult:
        try:
            body = await asyncio.to_thread(lambda: CloudClient().get("/v1/plans", auth=False))
        except CloudError as e:
            raise method_error(e) from e
        return CloudPlansResult.model_validate(body)

    # ---- announcements

    def _attach(self) -> None:
        """Starts hearing about status changes, which come on whatever thread caused them, once a request shows which
        loop to announce them on."""
        self._loop = asyncio.get_running_loop()
        if self._unsubscribe is None:
            self._unsubscribe = account.subscribe(self._on_changed)

    def _on_changed(self, status: CloudStatus) -> None:
        loop = self._loop
        if loop is None or loop.is_closed():
            return  # nobody has asked yet: there is nobody to tell
        loop.call_soon_threadsafe(self._notify_changed, CloudChangedParams(status=wire_status(status)))

    async def _finish(self, attempt_id: str, sign_in: BrowserSignIn) -> None:
        finished = CloudSignInFinishedParams(attempt_id=attempt_id, result="failed")
        try:
            tokens = await sign_in.wait()
            status = await asyncio.to_thread(complete_sign_in, tokens)
            finished = finished.model_copy(update={"result": "connected", "status": wire_status(status)})
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
            self._notify_finished(finished)


def wire_status(status: CloudStatus) -> CloudStatusModel:
    """The protocol's status for core's: ``None`` fields are left out so the models' defaults apply."""

    def clean(value: dict[str, Any] | None) -> dict[str, Any] | None:
        return None if value is None else {k: v for k, v in value.items() if v is not None}

    return CloudStatusModel.model_validate(
        {
            "signed_in": status.signed_in,
            "api_url": status.api_url,
            "app_domain": status.app_domain,
            "account": clean(status.account),
            "plan": clean(status.plan),
            "limits": clean(status.limits),
            "credits": clean(status.credits),
            "reachable": status.reachable,
        }
    )


def method_error(e: CloudError | SignedOut, *, invalid: str = "invalid") -> MethodError:
    """The error the app sees for what the API or the sign-in said: the API's code as the reason."""
    if isinstance(e, SignedOut):
        return MethodError(APP_ERROR, str(e), "signed_out")
    reason = invalid if e.code == "invalid" else e.code
    return MethodError(APP_ERROR, e.message, reason if reason in _KNOWN else "other")


def _not_available(name: str) -> Callable[[Any], Awaitable[Any]]:
    async def handler(params: Any) -> Any:
        raise MethodError(APP_ERROR, f"{name} is not available yet", "not_available")

    return handler
