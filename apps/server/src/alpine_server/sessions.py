"""Sessions for the protocol: the ``session/*`` methods, on the event loop that runs every session.

``SessionManager`` keeps the running sessions in memory, opens the others from disk, and turns the core's item events
into ``session/event`` notifications. Approvals wait for ``session/answer``; the first answer wins.
"""

from __future__ import annotations

import asyncio
import dataclasses
import sys
import traceback
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from alpine_core import (
    ApprovalRequest,
    ConfigError,
    Decision,
    InfoChanged,
    ItemEvent,
    Mode,
    ProjectList,
    Session,
    Settings,
    Storage,
    file_storage,
    list_sessions,
)
from alpine_protocol import (
    SESSION_NOT_FOUND,
    SESSION_RUNNING,
    SessionAnswerParams,
    SessionAnswerResult,
    SessionCancelParams,
    SessionCancelResult,
    SessionDeleteParams,
    SessionDeleteResult,
    SessionEventParams,
    SessionListParams,
    SessionListResult,
    SessionNewParams,
    SessionNewResult,
    SessionOpenParams,
    SessionOpenResult,
    SessionSendParams,
    SessionSendResult,
    SessionSetModeParams,
    SessionSetModeResult,
)

from .methods import APP_ERROR, MethodError
from .wire import to_event_params, to_info, to_item

Notify = Callable[[SessionEventParams], None]


class _Approver:
    """The session's approver: waits for ``session/answer`` on a future per approval item."""

    def __init__(self) -> None:
        self.pending: dict[str, asyncio.Future[Decision]] = {}

    async def aapprove(self, request: ApprovalRequest) -> Decision:
        future: asyncio.Future[Decision] = asyncio.get_running_loop().create_future()
        self.pending[request.request_id] = future
        try:
            return await future
        finally:
            self.pending.pop(request.request_id, None)

    def answer(self, request_id: str, decision: Decision) -> bool:
        """``False`` if there is no such approval waiting (unknown, or already answered)."""
        future = self.pending.pop(request_id, None)
        if future is None or future.done():
            return False
        future.set_result(decision)
        return True


@dataclass
class _Live:
    session: Session
    approver: _Approver
    task: asyncio.Task[None] | None = field(default=None)

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()


class SessionManager:
    """Owns the storage and the sessions of one server.

    Args:
        notify: Called with every ``session/event``, on the event loop's thread.
        storage: Where sessions are saved; defaults to ``file_storage()`` in the home folder, made on first use.
        settings: Loads the settings a new or opened session starts from; defaults to ``Settings.load``.
    """

    def __init__(
        self, notify: Notify, *, storage: Storage | None = None, settings: Callable[[], Settings] | None = None
    ) -> None:
        self._notify = notify
        self._storage = storage
        self._settings = settings or (lambda: Settings.load())
        self._live: dict[str, _Live] = {}

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "session/new": self.new,
            "session/list": self.list,
            "session/open": self.open,
            "session/send": self.send,
            "session/cancel": self.cancel,
            "session/answer": self.answer,
            "session/setMode": self.set_mode,
            "session/delete": self.delete,
        }

    async def shutdown(self) -> None:
        """Stops every running session, so each is saved ending in ``run_stopped: interrupted``."""
        await asyncio.gather(*(self._stop(live) for live in list(self._live.values())))

    # ------------------------------------------------------------ methods

    async def new(self, params: SessionNewParams) -> SessionNewResult:
        folder = Path(params.cwd)
        if not folder.is_dir():
            raise MethodError(APP_ERROR, f"Not a folder: {params.cwd}", "not_a_folder")
        settings = self._load_settings()
        if params.model:
            settings = settings.with_model(params.model)
        approver = _Approver()
        try:
            session = Session(
                settings,
                on_item_event=self._on_item_event,
                approver=approver,
                cwd=folder,
                projects=ProjectList.default(),
                storage=self.storage,
                mode=Mode(params.mode) if params.mode else None,
            )
        except ConfigError as e:
            raise MethodError(APP_ERROR, str(e), "invalid_config") from e
        self._live[session.id] = _Live(session, approver)
        # The constructor announces nothing, so this is what tells the windows the session exists.
        self._on_item_event(session.id, session.seq, InfoChanged(session.info))
        return SessionNewResult(info=to_info(session.info))

    async def list(self, params: SessionListParams) -> SessionListResult:
        # A session that is not in memory has no run: "running" or "waiting" on disk is a process that died.
        infos = {
            info.id: dataclasses.replace(info, status="idle") if info.status in ("running", "waiting") else info
            for info in list_sessions(self.storage)
        }
        for id, live in self._live.items():
            infos[id] = live.session.info
        ordered = sorted(infos.values(), key=lambda info: info.updated_at, reverse=True)
        return SessionListResult(sessions=[to_info(info) for info in ordered])

    async def open(self, params: SessionOpenParams) -> SessionOpenResult:
        snapshot = self._get(params.session_id).session.snapshot()
        return SessionOpenResult(
            info=to_info(snapshot.info),
            seq=snapshot.seq,
            items=[to_item(item) for item in snapshot.items],
            active=[to_item(item) for item in snapshot.active],
        )

    async def send(self, params: SessionSendParams) -> SessionSendResult:
        live = self._get(params.session_id)
        if live.running:
            raise MethodError(SESSION_RUNNING, "The session is running")
        live.task = asyncio.create_task(self._run(live, params.text))
        return SessionSendResult()

    async def cancel(self, params: SessionCancelParams) -> SessionCancelResult:
        await self._stop(self._get(params.session_id))
        return SessionCancelResult()

    async def answer(self, params: SessionAnswerParams) -> SessionAnswerResult:
        live = self._get(params.session_id)
        decision = Decision(params.decision, params.feedback)
        return SessionAnswerResult(accepted=live.approver.answer(params.request_id, decision))

    async def set_mode(self, params: SessionSetModeParams) -> SessionSetModeResult:
        live = self._get(params.session_id)
        live.session.mode = Mode(params.mode)
        return SessionSetModeResult(info=to_info(live.session.info))

    async def delete(self, params: SessionDeleteParams) -> SessionDeleteResult:
        live = self._get(params.session_id)
        await self._stop(live)
        live.session.delete()
        self._live.pop(params.session_id, None)
        return SessionDeleteResult()

    # ------------------------------------------------------------ internals

    @property
    def storage(self) -> Storage:
        if self._storage is None:
            self._storage = file_storage()
        return self._storage

    def _load_settings(self) -> Settings:
        try:
            return self._settings()
        except ConfigError as e:
            raise MethodError(APP_ERROR, str(e), "invalid_config") from e

    def _on_item_event(self, session_id: str, seq: int, event: ItemEvent) -> None:
        self._notify(to_event_params(session_id, seq, event))

    def _get(self, session_id: str) -> _Live:
        """The session in memory, or opened from disk.

        Raises:
            MethodError: -32001, there is no such session.
        """
        live = self._live.get(session_id)
        if live is not None:
            return live
        approver = _Approver()
        settings = self._load_settings()
        try:
            session = Session.resume(
                self.storage,
                session_id,
                settings,
                on_item_event=self._on_item_event,
                approver=approver,
                projects=ProjectList.default(),
            )
        except LookupError as e:
            raise MethodError(SESSION_NOT_FOUND, f"No such session: {session_id}") from e
        except (ConfigError, ValueError) as e:
            raise MethodError(APP_ERROR, f"Cannot open session {session_id}: {e}", "invalid_config") from e
        live = self._live[session_id] = _Live(session, approver)
        return live

    async def _run(self, live: _Live, text: str) -> None:
        try:
            await live.session.asend(text)
        except asyncio.CancelledError:
            pass  # the session closed its items and saved itself; the task simply ends
        except Exception:
            # The session recorded the failure for the windows; the traceback is for the log.
            traceback.print_exc(file=sys.stderr)

    async def _stop(self, live: _Live) -> None:
        """Cancels the run, if any, and waits until the session has saved itself."""
        task = live.task
        if task is None or task.done():
            return
        task.cancel()
        await asyncio.wait({task})
