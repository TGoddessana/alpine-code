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
    Builtins,
    ConfigError,
    Decision,
    ExternalSession,
    InfoChanged,
    ItemEvent,
    Memories,
    Mode,
    ProjectList,
    Session,
    Settings,
    Storage,
    ToolSource,
    Workspace,
    file_storage,
    find_external_sessions,
    import_session,
    list_sessions,
)
from alpine_core.taskforce.team import TaskForce
from alpine_core.work_changes import checkpoint_changes
from alpine_protocol import (
    SESSION_NOT_FOUND,
    SESSION_RUNNING,
    ExternalSessionInfo,
    ProjectsArchiveParams,
    ProjectsArchiveResult,
    SessionAnswerParams,
    SessionAnswerResult,
    SessionCancelParams,
    SessionCancelResult,
    SessionChangesParams,
    SessionChangesResult,
    SessionDeleteParams,
    SessionDeleteResult,
    SessionEventParams,
    SessionImportableParams,
    SessionImportableResult,
    SessionImportParams,
    SessionImportResult,
    SessionListParams,
    SessionListResult,
    SessionNewParams,
    SessionNewResult,
    SessionOpenParams,
    SessionOpenResult,
    SessionSearchHit,
    SessionSearchParams,
    SessionSearchResult,
    SessionSendParams,
    SessionSendResult,
    SessionSetAgentParams,
    SessionSetAgentResult,
    SessionSetDetailsParams,
    SessionSetDetailsResult,
    SessionSetModelParams,
    SessionSetModelResult,
    SessionSetModeParams,
    SessionSetModeResult,
    TaskForceAgentParams,
    TaskForceParams,
    TaskForceRecordResult,
    TaskForceResult,
    TaskForceResumeParams,
    TaskForceStopAgentResult,
    ToolsListParams,
    ToolsListResult,
)

from . import map_state
from .agents import agents
from .methods import APP_ERROR, INVALID_PARAMS, MethodError
from .skills import skills
from .tools import list_tools, toolbox
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
        memories: The memory of every project, shared by the sessions and the ``memory/*`` methods.
    """

    def __init__(
        self,
        notify: Notify,
        *,
        storage: Storage | None = None,
        settings: Callable[[], Settings] | None = None,
        memories: Memories | None = None,
    ) -> None:
        self._notify = notify
        self.memories = memories or Memories()
        self._storage = storage
        self._settings = settings or (lambda: Settings.load())
        self._live: dict[str, _Live] = {}
        # The map reads sessions from disk; a running status there with no live session is a crashed process.
        map_state.live_ids = lambda: set(self._live)

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "projects/archive": self.archive_project,
            "session/new": self.new,
            "session/list": self.list,
            "session/open": self.open,
            "session/changes": self.changes,
            "session/send": self.send,
            "session/cancel": self.cancel,
            "session/answer": self.answer,
            "session/search": self.search,
            "session/setDetails": self.set_details,
            "session/setMode": self.set_mode,
            "session/setAgent": self.set_agent,
            "session/setModel": self.set_model,
            "session/delete": self.delete,
            "session/importable": self.importable,
            "session/import": self.import_,
            "taskforce/start": self.taskforce_start,
            "taskforce/decline": self.taskforce_decline,
            "taskforce/stop": self.taskforce_stop,
            "taskforce/allowMore": self.taskforce_allow_more,
            "taskforce/resume": self.taskforce_resume,
            "taskforce/takeResults": self.taskforce_take_results,
            "taskforce/stopAgent": self.taskforce_stop_agent,
            "taskforce/record": self.taskforce_record,
            "tools/list": self.list_tools,
        }

    def tool_sources(self, project: Path) -> list[ToolSource]:
        """Where a folder's tools come from, for its sessions and for ``tools/list``: the built-ins, the project's
        memory, then the user's tools, so a user tool cannot take an earlier one's name."""
        return [Builtins(Workspace(project)), self.memories.of(project), toolbox()]

    async def shutdown(self) -> None:
        """Stops every running session, so each is saved ending in ``run_stopped: interrupted``, and every TF, so
        it can be continued."""
        await asyncio.gather(*(self._stop(live) for live in list(self._live.values())))
        await asyncio.gather(*(live.session.aclose() for live in list(self._live.values())))

    # ------------------------------------------------------------ methods

    async def archive_project(self, params: ProjectsArchiveParams) -> ProjectsArchiveResult:
        folder = Path(params.path).expanduser().resolve()
        if any(live.running and live.session.workspace.root == folder for live in self._live.values()):
            raise MethodError(SESSION_RUNNING, "A session in this project is running")
        ProjectList.default().archive(folder)
        return ProjectsArchiveResult()

    async def new(self, params: SessionNewParams) -> SessionNewResult:
        folder = Path(params.cwd)
        if not folder.is_dir():
            raise MethodError(APP_ERROR, f"Not a folder: {params.cwd}", "not_a_folder")
        settings = self._load_settings()
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
                agents=agents(),
                tools=self.tool_sources,
                agent=params.agent,
                model=params.model,
                memories=self.memories,
                skills=skills(),
                taskforce=True,
            )
        except ConfigError as e:
            raise MethodError(APP_ERROR, str(e), "invalid_config") from e
        self._live[session.id] = self._keep(session, approver)
        # The constructor announces nothing, so this is what tells the windows the session exists.
        self._on_item_event(session.id, session.seq, InfoChanged(session.info))
        return SessionNewResult(info=to_info(session.info))

    async def list_tools(self, params: ToolsListParams) -> ToolsListResult:
        return await asyncio.to_thread(list_tools, params, self.tool_sources)

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

    async def changes(self, params: SessionChangesParams) -> SessionChangesResult:
        live = self._live.get(params.session_id)
        try:
            info = live.session.info if live else (await asyncio.to_thread(self.storage.log.read, params.session_id))[0]
        except LookupError as exc:
            raise MethodError(SESSION_NOT_FOUND, "Session not found") from exc
        history = info.work_history
        try:
            files = await asyncio.to_thread(checkpoint_changes, history, info.work_baseline, params.checkpoint_id)
        except LookupError as exc:
            raise MethodError(APP_ERROR, str(exc), "not_found") from exc
        return SessionChangesResult(
            checkpoints=[
                {key: request[key] for key in ("id", "label", "created_at", "status")}
                for request in history.get("requests", [])
            ],
            files=files,
            available=bool(history.get("requests")),
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
        if params.agent is not None:
            if params.decision != "deny":
                raise MethodError(INVALID_PARAMS, "Only a decline can answer one agent's call")
            return SessionAnswerResult(accepted=live.session.taskforce.decline_one(params.request_id, params.agent))
        decision = Decision(params.decision, params.feedback)
        return SessionAnswerResult(accepted=live.approver.answer(params.request_id, decision))

    async def search(self, params: SessionSearchParams) -> SessionSearchResult:
        query = " ".join(params.query.casefold().split())
        if not query:
            return SessionSearchResult(hits=[])
        listed = await self.list(SessionListParams())

        def find() -> SessionSearchResult:
            hits = []
            for info in listed.sessions:
                excerpt = info.summary
                if query not in " ".join(f"{info.title} {info.cwd} {info.summary}".casefold().split()):
                    try:
                        _, records = self.storage.log.read(info.id)
                    except LookupError:
                        continue
                    matched = None
                    for _, item in reversed(records):
                        if item.get("kind") not in ("user_message", "agent_message"):
                            continue
                        text = " ".join(str(item.get("text", "")).split())
                        index = text.casefold().find(query)
                        if index >= 0:
                            start = max(0, index - 60)
                            matched = ("…" if start else "") + text[start : start + 240]
                            break
                    if matched is None:
                        continue
                    excerpt = matched
                hits.append(SessionSearchHit(info=info, excerpt=excerpt))
                if len(hits) >= params.limit:
                    break
            return SessionSearchResult(hits=hits)

        return await asyncio.to_thread(find)

    async def set_details(self, params: SessionSetDetailsParams) -> SessionSetDetailsResult:
        live = self._get(params.session_id)
        if params.archived and live.running:
            raise MethodError(SESSION_RUNNING, "The session is running")
        try:
            live.session.set_details(title=params.title, pinned=params.pinned, archived=params.archived)
        except ValueError as exc:
            raise MethodError(APP_ERROR, str(exc), "invalid_details") from exc
        return SessionSetDetailsResult(info=to_info(live.session.info))

    async def set_mode(self, params: SessionSetModeParams) -> SessionSetModeResult:
        live = self._get(params.session_id)
        live.session.mode = Mode(params.mode)
        return SessionSetModeResult(info=to_info(live.session.info))

    async def set_model(self, params: SessionSetModelParams) -> SessionSetModelResult:
        live = self._get(params.session_id)
        if live.running:
            raise MethodError(SESSION_RUNNING, "The session is running")
        try:
            live.session.set_model(params.model)
        except ConfigError as e:
            raise MethodError(APP_ERROR, str(e), "invalid_config") from e
        return SessionSetModelResult(info=to_info(live.session.info))

    async def set_agent(self, params: SessionSetAgentParams) -> SessionSetAgentResult:
        live = self._get(params.session_id)
        if live.running:
            raise MethodError(SESSION_RUNNING, "The session is running")
        try:
            live.session.set_agent(params.agent)
        except LookupError as e:
            raise MethodError(APP_ERROR, f"No such agent: {params.agent}", "agent_not_found") from e
        except ConfigError as e:
            raise MethodError(APP_ERROR, str(e), "invalid_config") from e
        return SessionSetAgentResult(info=to_info(live.session.info))

    async def delete(self, params: SessionDeleteParams) -> SessionDeleteResult:
        live = self._get(params.session_id)
        await self._stop(live)
        await live.session.aclose()
        live.session.delete()
        self._live.pop(params.session_id, None)
        return SessionDeleteResult()

    async def importable(self, params: SessionImportableParams) -> SessionImportableResult:
        folder = Path(params.cwd)
        found = await asyncio.to_thread(find_external_sessions, folder)
        done = self._imported()
        return SessionImportableResult(
            sessions=[
                ExternalSessionInfo(
                    source=external.source,
                    id=external.id,
                    title=external.title,
                    updated_at=external.updated_at,
                    imported=done.get((external.source, external.id, external.updated_at)),
                )
                for external in found
            ]
        )

    async def import_(self, params: SessionImportParams) -> SessionImportResult:
        folder = Path(params.cwd)
        if not folder.is_dir():
            raise MethodError(APP_ERROR, f"Not a folder: {params.cwd}", "not_a_folder")
        external = await self._external(folder, params.source, params.id)
        settings = self._load_settings()
        project = ProjectList.default().open(folder)
        try:
            info = await asyncio.to_thread(
                import_session,
                self.storage,
                external,
                folder,
                model=settings.model or "",
                mode=settings.mode.value,
                agent=project.last_agent,
            )
        except (OSError, ValueError) as e:
            raise MethodError(APP_ERROR, f"Cannot carry over {external.path}: {e}", "import_failed") from e
        session = self._get(info.id).session
        self._on_item_event(session.id, session.seq, InfoChanged(session.info))
        return SessionImportResult(info=to_info(session.info))

    # ------------------------------------------------------------ TF

    async def taskforce_start(self, params: TaskForceParams) -> TaskForceResult:
        return self._taskforce(params, lambda tf: tf.start(params.run_id))

    async def taskforce_decline(self, params: TaskForceParams) -> TaskForceResult:
        return self._taskforce(params, lambda tf: tf.decline(params.run_id))

    async def taskforce_stop(self, params: TaskForceParams) -> TaskForceResult:
        return self._taskforce(params, lambda tf: tf.stop(params.run_id))

    async def taskforce_allow_more(self, params: TaskForceParams) -> TaskForceResult:
        return self._taskforce(params, lambda tf: tf.allow_more(params.run_id))

    async def taskforce_resume(self, params: TaskForceResumeParams) -> TaskForceResult:
        return self._taskforce(params, lambda tf: tf.resume(params.run_id, fresh=params.fresh))

    async def taskforce_take_results(self, params: TaskForceParams) -> TaskForceResult:
        return self._taskforce(params, lambda tf: tf.take_results(params.run_id))

    async def taskforce_stop_agent(self, params: TaskForceAgentParams) -> TaskForceStopAgentResult:
        stopped = False

        def stop(tf: TaskForce) -> None:
            nonlocal stopped
            stopped = tf.stop_member(params.run_id, params.member_id)

        self._taskforce(params, stop)
        return TaskForceStopAgentResult(stopped=stopped)

    async def taskforce_record(self, params: TaskForceAgentParams) -> TaskForceRecordResult:
        items: list[Any] = []

        def read(tf: TaskForce) -> None:
            items.extend(tf.record(params.run_id, params.member_id))

        self._taskforce(params, read)
        return TaskForceRecordResult(items=[to_item(item) for item in items])

    def _taskforce(self, params: TaskForceParams, action: Callable[[TaskForce], None]) -> TaskForceResult:
        tf = self._get(params.session_id).session.taskforce
        try:
            action(tf)
        except LookupError as e:
            raise MethodError(APP_ERROR, str(e), "taskforce_not_found") from e
        except ValueError as e:
            raise MethodError(APP_ERROR, str(e), "taskforce_state") from e
        return TaskForceResult()

    # ------------------------------------------------------------ internals

    def _imported(self) -> dict[tuple[str, str, str], str]:
        """The sessions carried over from other apps, by ``(source, id, updated_at)`` of what they came from."""
        done = {}
        for info in list_sessions(self.storage):
            if (origin := info.imported_from) is not None:
                done[(origin.get("source", ""), origin.get("id", ""), origin.get("updated_at", ""))] = info.id
        return done

    async def _external(self, folder: Path, source: str, external_id: str) -> ExternalSession:
        for external in await asyncio.to_thread(find_external_sessions, folder):
            if (external.source, external.id) == (source, external_id):
                return external
        raise MethodError(APP_ERROR, f"No {source} conversation {external_id} in {folder}", "not_found")

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
                agents=agents(),
                tools=self.tool_sources,
                memories=self.memories,
                skills=skills(),
                taskforce=True,
            )
        except LookupError as e:
            raise MethodError(SESSION_NOT_FOUND, f"No such session: {session_id}") from e
        except (ConfigError, ValueError) as e:
            raise MethodError(APP_ERROR, f"Cannot open session {session_id}: {e}", "invalid_config") from e
        live = self._live[session_id] = self._keep(session, approver)
        return live

    def _keep(self, session: Session, approver: _Approver) -> _Live:
        """A live session; a turn it asks for itself (a TF's result) runs as its task, after the one running."""
        live = _Live(session, approver)

        def turn(notice: str) -> None:
            before = live.task
            live.task = asyncio.create_task(self._notice_turn(live, notice, before))

        session.on_turn = turn
        return live

    async def _notice_turn(self, live: _Live, notice: str, before: asyncio.Task[None] | None) -> None:
        try:
            if before is not None and not before.done():
                await asyncio.wait({before})
        except asyncio.CancelledError:
            if before is not None:
                before.cancel()
            raise
        await self._run(live, notice, notice="taskforce")

    async def _run(self, live: _Live, text: str, *, notice: str | None = None) -> None:
        try:
            await live.session.asend(text, notice=notice)
        except asyncio.CancelledError:
            pass  # the session closed its items and saved itself; the task simply ends
        except Exception:
            # The session recorded the failure for the windows; the traceback is for the log.
            traceback.print_exc(file=sys.stderr)

    async def _stop(self, live: _Live) -> None:
        """Cancels the run, if any, and waits until the session has saved itself."""
        task = live.task
        if task is None or task.done():
            await live.session.stop_processes()
            return
        task.cancel()
        await asyncio.wait({task})
