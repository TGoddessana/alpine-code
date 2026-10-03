"""Session: one conversation with the agent. The only object a frontend drives."""

from __future__ import annotations

import asyncio
import dataclasses
import threading
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, TypeVar

from alpineagents import (
    Agent,
    AlpineAgentsError,
    Message,
    State,
    StoppedByFinish,
    StoppedByLimit,
    StoppedByPermission,
    StoppedByUntil,
)
from alpineagents.tool import collect_tools
from alpineagents.types import Stopped

from .approval import ApprovalRequest, Approver, Decision, build_permissions
from .bridge import EventReporter
from .chatgpt import PlanUsageOff, SignInNeeded, UsageLimitError
from .config import ConfigError, Settings
from .events import (
    AssistantDone,
    ContextCompacted,
    Event,
    Failed,
    Interrupted,
    RunFinished,
    StopReason,
    TextDelta,
    ToolFinished,
    ToolStarted,
    TurnStarted,
    UsageInfo,
)
from .items import Item, ItemCompleted, ItemEvent, ItemRecorder, item_from_dict, item_to_dict
from .loop import coding
from .models import make_model
from .permissions import Mode, PermissionPolicy
from .profiles import Profile, ProfileList
from .projects import ProjectList
from .prompt import build_system_prompt
from .storage import Activity, ActivityKind, Record, SessionInfo, SessionStatus, Storage
from .toolbox import Toolbox
from .tools import Workspace, default_tools

#: Longest session title, in characters.
TITLE_LENGTH = 60

#: The title of a session that has no message yet.
NEW_TITLE = "New session"


@dataclass(frozen=True)
class Snapshot:
    """Everything a window needs to draw a session and follow its events: ``info``, the ``seq`` of the last event,
    the finished ``items`` in order, and the ``active`` (unfinished) ones."""

    info: SessionInfo
    seq: int
    items: tuple[Item, ...]
    active: tuple[Item, ...]


@dataclass(frozen=True)
class _Saved:
    """What ``Session.resume`` loaded."""

    info: SessionInfo
    records: list[Record]
    state: State | None


class Session:
    """Owns the agent and the conversation state.

    ``asend`` runs until the agent answers, reporting progress through ``on_event`` (core events, on the event
    loop's thread) and asking ``approver`` before tool calls the permission mode does not allow. Cancelling it stops
    the run and keeps the conversation. ``send`` is the same for a frontend without an event loop, stopped with
    Ctrl+C. With ``projects``, the first message of a conversation records its folder there. With ``profiles``, the
    agent gets the tools of ``profile`` (an id) or of the profile its folder and model match, including the user's
    tools from ``toolbox``; the choice is saved with the session.

    The conversation is also kept as items (``docs/session-protocol.md``): ``on_item_event(session_id, seq,
    event)`` gets every item event, and ``snapshot()`` returns the items so far. With ``storage``, the session is
    saved as it goes (finished items and info in the log, the conversation in the store) and ``Session.resume``
    opens it again. ``id`` is the id it is saved under. All of this runs on the event loop's thread.

    Raises:
        ConfigError: The settings cannot make a model.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        on_event: Callable[[Event], None] | None = None,
        on_item_event: Callable[[str, int, ItemEvent], None] | None = None,
        approver: Approver,
        cwd: Path | None = None,
        projects: ProjectList | None = None,
        storage: Storage | None = None,
        mode: Mode | None = None,
        profiles: ProfileList | None = None,
        toolbox: Toolbox | None = None,
        profile: str | None = None,
        _saved: _Saved | None = None,
    ) -> None:
        if mode is not None:
            settings = dataclasses.replace(settings, mode=mode)
        self.workspace = Workspace((cwd or Path.cwd()).resolve())
        self.policy = PermissionPolicy(self.workspace, settings.mode)
        self._on_event = on_event
        self._on_item_event = on_item_event
        self._storage = storage
        self._permissions = build_permissions(self.policy, _ItemApprover(self, approver))
        self._projects = projects
        self._reporter = EventReporter(self._dispatch)
        self._state: State | None = None
        self._settings = settings
        self._profiles = profiles
        self._toolbox = toolbox
        self._profile = self._pick_profile(settings, _saved.info.profile if _saved else profile)
        self._agent = self._build_agent(settings)
        self._closed = False
        self._id = ""
        self._title = NEW_TITLE
        self._status: SessionStatus = "idle"
        self._created = self._updated = ""
        self._activity: Activity | None = None
        self._run_started_at: str | None = None
        self._run_base = UsageInfo()
        self._running_tools: dict[str, str] = {}
        self._recorder = ItemRecorder(self._on_recorded)
        if _saved is None:
            self._begin_conversation()
        else:
            self._restore(_saved)

    @classmethod
    def resume(
        cls,
        storage: Storage,
        session_id: str,
        settings: Settings,
        *,
        on_event: Callable[[Event], None] | None = None,
        on_item_event: Callable[[str, int, ItemEvent], None] | None = None,
        approver: Approver,
        cwd: Path | None = None,
        projects: ProjectList | None = None,
        profiles: ProfileList | None = None,
        toolbox: Toolbox | None = None,
    ) -> Session:
        """Opens a saved session and continues it: the items and ``seq`` from the log, the conversation from the
        store. The session's own model, mode and folder win over ``settings`` and ``cwd``. If the process died
        during a run (the log's status is ``running`` or ``waiting``), the items end with ``run_stopped:
        interrupted``: the conversation is what the store has, and the screen follows it.

        Raises:
            LookupError: There is no such session.
            ConfigError: The session's model cannot be used.
            ValueError: The saved conversation is damaged.
        """
        info, records = storage.log.read(session_id)
        try:
            state = storage.states.load(session_id)
        except LookupError:  # a session that never got a message has no conversation yet
            state = None
        if info.model and info.model != "?":
            settings = settings.with_model(info.model)
        try:
            settings = dataclasses.replace(settings, mode=Mode(info.mode))
        except ValueError:
            pass
        folder = Path(info.cwd) if info.cwd else cwd
        return cls(
            settings,
            on_event=on_event,
            on_item_event=on_item_event,
            approver=approver,
            cwd=folder,
            projects=projects,
            storage=storage,
            profiles=profiles,
            toolbox=toolbox,
            _saved=_Saved(info, records, state),
        )

    def _build_agent(self, settings: Settings) -> Agent:
        try:
            return Agent(
                make_model(settings),
                system=build_system_prompt(self.workspace.root),
                tools=self._tools(),
                loop=coding,
                permissions=self._permissions,
                reporter=self._reporter,
                human=None,
                store=self._storage.states if self._storage is not None else None,
            )
        except (ValueError, TypeError) as e:
            raise ConfigError(str(e)) from e

    def _pick_profile(self, settings: Settings, saved_id: str | None) -> Profile | None:
        """The session's profile: the one it was saved with, or the one its folder and model match."""
        if self._profiles is None:
            return None
        saved = self._profiles.get(saved_id) if saved_id else None
        return saved or self._profiles.resolve(self.workspace.root, settings.model)

    def _tools(self) -> list[Any]:
        """The built-in tools, and the user's tools, that the profile turns on. Without profiles, the built-ins."""
        builtin = default_tools(self.workspace)
        if self._profile is None:
            return builtin
        on = set(self._profile.tools)
        tools: list[Any] = [tool for name, tool in collect_tools(builtin).items() if name in on]
        if self._toolbox is not None:
            tools += self._toolbox.load(on)
        return tools

    # ------------------------------------------------------------ actions

    async def asend(self, text: str) -> str | None:
        """Sends a user message and runs the agent until it answers. Returns the answer, or ``None`` if the run
        was interrupted or failed (a ``Interrupted`` or ``Failed`` event says which).

        Cancelling the task stops the run and keeps the conversation: ``Interrupted`` is emitted, the unfinished
        items are closed and ``CancelledError`` propagates."""
        if self._state is None:
            self._state = State(messages=[Message.user(text)], id=self._id)
            if self._projects is not None:
                self._projects.open(self.workspace.root)
            if self._title == NEW_TITLE:
                self._title = _title(text)
        else:
            self._state.add_message(Message.user(text))
        self._recorder.add_user_message(text)
        self._begin_run("thinking")
        try:
            answer = await self._agent.arun(self._state)
        except asyncio.CancelledError:
            self._dispatch(Interrupted())
            self._end_run("idle")
            raise
        except KeyboardInterrupt:  # Ctrl+C inside a blocking approver's prompt
            self._dispatch(Interrupted())
            self._end_run("idle")
            return None
        except AlpineAgentsError as e:
            self._dispatch(_failed(e))
            self._end_run("failed")
            return None
        except Exception as e:  # a bug: still leave the screen record closed
            self._dispatch(_failed(e))
            self._end_run("failed")
            raise
        stopped = self._state.stopped
        if isinstance(stopped, StoppedByPermission):  # the user declined a call without saying what to do instead
            self._dispatch(Interrupted())
            self._end_run("idle")
            return None
        self._dispatch(RunFinished(_stop_reason(stopped), self.usage))
        self._end_run("idle")
        return answer if isinstance(answer, str) else None

    def send(self, text: str) -> str | None:
        """``asend`` on a new event loop, for a frontend without one. Ctrl+C stops the run and keeps the
        conversation. Must not be called while an event loop is running on this thread."""
        return _run(self.asend(text))

    def clear(self) -> None:
        """Starts a new conversation. With ``storage`` it is a new session: ``id`` changes, and the old one stays
        saved."""
        self._state = None
        self._begin_conversation()

    async def acompact(self) -> bool:
        """Summarizes the conversation to free context. ``False`` if there is nothing to compact or it failed.
        Cancelling works as in ``asend``."""
        if self._state is None or not self._state.messages:
            return False
        self._begin_run("compacting")
        try:
            await self._agent.acompact(self._state)
        except asyncio.CancelledError:
            self._dispatch(Interrupted())
            self._end_run("idle")
            raise
        except KeyboardInterrupt:
            self._dispatch(Interrupted())
            self._end_run("idle")
            return False
        except AlpineAgentsError as e:
            self._dispatch(_failed(e))
            self._end_run("failed")
            return False
        self._end_run("idle")
        return True

    def compact(self) -> bool:
        """``acompact`` on a new event loop, like ``send``."""
        return bool(_run(self.acompact()))

    def set_model(self, model: str) -> None:
        """Switches the model from the next message on, and announces the new info. The conversation goes on with
        the new model, and the profile (so the tools) stays the one the session started with. Not during a run.

        Raises:
            ConfigError: The model cannot be used. The current model stays.
        """
        settings = self._settings.with_model(model)
        self._agent = self._build_agent(settings)
        self._settings = settings
        self._touch()

    def delete(self) -> None:
        """Removes the session from storage and announces ``Deleted``. Cancel a running ``asend`` first. The
        session is not usable afterwards."""
        self._closed = True
        if self._storage is not None:
            delete_session(self._storage, self._id)
        self._recorder.deleted()

    # ------------------------------------------------------------ read-only views

    @property
    def mode(self) -> Mode:
        return self.policy.mode

    @mode.setter
    def mode(self, mode: Mode) -> None:
        """Changes the permission mode from the next tool call on, and announces the new info."""
        self.policy.mode = mode
        self._touch()

    @property
    def id(self) -> str:
        """The session id: the id of the conversation in the store and of the session in the log."""
        return self._id

    @property
    def info(self) -> SessionInfo:
        return SessionInfo(
            id=self._id,
            title=self._title,
            cwd=str(self.workspace.root),
            model=self.model_name,
            mode=self.policy.mode.value,
            status=self._status,
            created_at=self._created,
            updated_at=self._updated,
            usage=self.usage,
            context_used=self._agent.context_tokens(self._state) if self._state is not None else 0,
            context_window=self._context_window(),
            activity=self._activity,
            run_started_at=self._run_started_at,
            run_usage=self._run_usage(),
            profile=self._profile.id if self._profile is not None else None,
        )

    @property
    def seq(self) -> int:
        """The ``seq`` of the last item event."""
        return self._recorder.seq

    def snapshot(self) -> Snapshot:
        """The session as it is now: info, ``seq``, finished items and active items."""
        return Snapshot(self.info, self._recorder.seq, self._recorder.items, self._recorder.active)

    @property
    def model_name(self) -> str:
        return self._settings.model or "?"

    @property
    def cwd(self) -> Path:
        return self.workspace.root

    @property
    def usage(self) -> UsageInfo:
        if self._state is None:
            return UsageInfo()
        u = self._state.usage
        return UsageInfo(
            input_tokens=u.input_tokens,
            output_tokens=u.output_tokens,
            cache_read_tokens=u.cache_read_tokens,
            cache_write_tokens=u.cache_write_tokens,
            requests=u.requests,
            cost=u.cost,
        )

    def _context_window(self) -> int | None:
        try:
            window = self._agent.model.context_window
        except Exception:  # a model that cannot say
            return None
        return window if isinstance(window, int) and window > 0 else None

    def _run_usage(self) -> UsageInfo | None:
        """The usage since the run started, ``None`` when idle."""
        if self._run_started_at is None:
            return None
        now, base = self.usage, self._run_base
        return UsageInfo(
            input_tokens=now.input_tokens - base.input_tokens,
            output_tokens=now.output_tokens - base.output_tokens,
            cache_read_tokens=now.cache_read_tokens - base.cache_read_tokens,
            cache_write_tokens=now.cache_write_tokens - base.cache_write_tokens,
            requests=now.requests - base.requests,
            cost=None if now.cost is None or base.cost is None else now.cost - base.cost,
        )

    @property
    def context_used(self) -> float:
        """Fraction of the model's context window in use, 0.0 to 1.0."""
        return self._agent.context_used(self._state) if self._state is not None else 0.0

    @property
    def has_conversation(self) -> bool:
        return self._state is not None

    # ------------------------------------------------------------ items and storage

    def _dispatch(self, event: Event) -> None:
        """A core event: the item recorder first (so ``snapshot()`` is current), then the frontend's callback."""
        self._recorder.handle(event)
        self._track(event)
        if self._on_event is not None:
            self._on_event(event)

    def _track(self, event: Event) -> None:
        """Follows what the run is doing. Info is announced when the activity changes and after every model call
        (its usage and context), not for every text delta."""
        activity = self._activity
        if activity is None or activity.kind == "compacting":
            if isinstance(event, ContextCompacted):
                self._touch()
            return
        match event:
            case TurnStarted():
                self._running_tools.clear()
                self._set_activity("thinking")
            case TextDelta():
                if activity.kind == "thinking":
                    self._set_activity("writing")
            case AssistantDone() | ContextCompacted():
                self._touch()
            case ToolStarted(id, name):
                self._running_tools[id] = name
                self._set_activity("running_tool", name)
            case ToolFinished(id):
                self._running_tools.pop(id, None)
                if self._running_tools:
                    self._set_activity("running_tool", next(reversed(self._running_tools.values())))
                elif activity.kind == "running_tool":
                    self._set_activity("thinking")

    def _set_activity(self, kind: ActivityKind, tool_name: str | None = None) -> None:
        """Changes what the session is doing and announces it, if it is different."""
        current = self._activity
        if current is not None and (current.kind, current.tool_name) == (kind, tool_name):
            return
        self._activity = Activity(kind, tool_name, _now())
        self._touch()

    def _begin_run(self, kind: ActivityKind) -> None:
        self._run_started_at = _now()
        self._run_base = self.usage
        self._running_tools.clear()
        self._activity = Activity(kind, None, self._run_started_at)
        self._set_status("running")

    def _end_run(self, status: SessionStatus) -> None:
        self._run_started_at = None
        self._activity = None
        self._running_tools.clear()
        self._set_status(status)

    def _on_recorded(self, seq: int, event: ItemEvent) -> None:
        if isinstance(event, ItemCompleted) and self._storage is not None and not self._closed:
            self._storage.log.append(self._id, [(seq, item_to_dict(event.item))])
        if self._on_item_event is not None:
            self._on_item_event(self._id, seq, event)

    def _touch(self) -> None:
        """Stamps ``updated_at``, saves the info and announces it."""
        self._updated = _now()
        # The info_changed event below takes the next seq; saving it keeps seq growing after a restart.
        info = dataclasses.replace(self.info, last_seq=self._recorder.seq + 1)
        if self._storage is not None and not self._closed:
            self._storage.log.update(info)
        self._recorder.info_changed(info)

    def _set_status(self, status: SessionStatus) -> None:
        self._status = status
        self._touch()

    def _begin_conversation(self) -> None:
        """A new session id and an empty screen record (a new session, or ``clear``)."""
        self._id = uuid.uuid4().hex
        self._title = NEW_TITLE
        self._status = "idle"
        self._activity = self._run_started_at = None
        self._created = self._updated = _now()
        self._recorder = ItemRecorder(self._on_recorded)
        if self._storage is not None:
            self._storage.log.create(self.info)

    def _restore(self, saved: _Saved) -> None:
        info = saved.info
        self._id, self._title = info.id, info.title
        self._created, self._updated = info.created_at, info.updated_at
        self._state = saved.state
        items = [item_from_dict(data) for _, data in saved.records]
        seq = max(info.last_seq, saved.records[-1][0] if saved.records else 0)
        self._recorder = ItemRecorder(self._on_recorded, seq=seq, items=items)
        if info.status in ("running", "waiting"):  # the process died mid-run: the store's conversation wins
            self._recorder.stop_run("interrupted")
            self._status = "idle"
            self._touch()
        else:
            self._status = info.status


T = TypeVar("T")


def _run(coro: Coroutine[Any, Any, T]) -> T | None:
    """Runs ``coro`` on a new event loop. ``None`` after Ctrl+C: ``asyncio.run`` cancels the task, which has already
    reported ``Interrupted``."""
    try:
        return asyncio.run(coro)
    except KeyboardInterrupt:
        return None


def _stop_reason(stopped: Stopped | None) -> StopReason | None:
    match stopped:
        case StoppedByUntil():
            return "answered"
        case StoppedByLimit():
            return "limit"
        case StoppedByFinish():
            return "finish"
    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _title(text: str) -> str:
    """The first user message on one line, shortened."""
    line = " ".join(text.split())
    return line if len(line) <= TITLE_LENGTH else line[: TITLE_LENGTH - 1].rstrip() + "…"


def list_sessions(storage: Storage) -> list[SessionInfo]:
    """Every saved session, most recently updated first."""
    return storage.log.list()


def delete_session(storage: Storage, session_id: str) -> None:
    """Removes a saved session: its screen record and its conversation. Does nothing if it does not exist."""
    storage.log.delete(session_id)
    storage.states.delete(session_id)


class _ItemApprover:
    """What the permissions ask: starts an ``approval`` item, sets the status to ``waiting``, asks the frontend's
    approver (a blocking one on a daemon thread, so a cancelled run does not wait for it) and completes the item
    with the answer."""

    def __init__(self, session: Session, approver: Approver) -> None:
        if not callable(getattr(approver, "aapprove", None)) and not callable(getattr(approver, "approve", None)):
            raise TypeError(f"approver {approver!r} has neither approve nor aapprove")
        self._session = session
        self._approver = approver

    async def aapprove(self, request: ApprovalRequest) -> Decision:
        session = self._session
        item = session._recorder.start_approval(
            request.call_id,
            request.title,
            request.preview,
            request.preview_kind,
            request.reason,
            request.remember,
            tool=request.tool,
            args=request.args,
        )
        session._activity = Activity("waiting_approval", None, _now())
        session._set_status("waiting")
        request = dataclasses.replace(request, request_id=item.id)
        decision = await self._ask(request)
        session._recorder.finish_approval(item.id, decision.kind, decision.feedback, stop=decision.stop)
        session._activity = Activity("running_tool", request.tool, _now())
        session._set_status("running")
        return decision

    async def _ask(self, request: ApprovalRequest) -> Decision:
        aapprove = getattr(self._approver, "aapprove", None)
        if callable(aapprove):
            return await aapprove(request)
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Decision] = loop.create_future()

        def deliver(setter: Callable[[Any], None], value: Any) -> None:
            if not future.done():
                setter(value)

        def target() -> None:
            try:
                decision = self._approver.approve(request)  # type: ignore[union-attr]
                outcome = (future.set_result, decision)
            except BaseException as e:
                outcome = (future.set_exception, e)
            try:
                loop.call_soon_threadsafe(deliver, *outcome)
            except RuntimeError:  # the loop is closed: the run was cancelled and nobody waits
                pass

        threading.Thread(target=target, name="alpine-approver", daemon=True).start()
        return await future


def _failed(error: BaseException) -> Failed:
    """The ``Failed`` event for ``error``: a used-up ChatGPT plan or an ended sign-in gets its own reason, and its
    message is the core's own sentence rather than an exception dump."""
    if isinstance(error, UsageLimitError):
        return Failed(str(error), "plan_limit")
    if isinstance(error, (SignInNeeded, PlanUsageOff)):
        return Failed(str(error), "signed_out")
    return Failed(_describe_error(error))


def _describe_error(error: BaseException) -> str:
    message = str(error).strip() or type(error).__name__
    cause = error.__cause__
    if cause is not None and str(cause).strip() and str(cause).strip() not in message:
        message += f"\n{str(cause).strip()}"
    return f"{type(error).__name__}: {message}"
