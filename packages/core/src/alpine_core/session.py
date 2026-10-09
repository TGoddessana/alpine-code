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
    ToolCall,
)
from alpineagents.types import Stopped

from . import shell
from .agents import AgentConfig, AgentList
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
from .items import (
    Item,
    ItemCompleted,
    ItemEvent,
    ItemRecorder,
    ToolCallItem,
    UserMessage,
    item_from_dict,
    item_to_dict,
)
from .loop import coding
from .memory import Memories, Memory
from .memory.rules import CheckRunner, Facts, relative
from .memory.rules import Event as RuleEvent
from .models import make_model
from .permissions import Mode, PermissionPolicy
from .projects import ProjectList
from .prompt import build_system_prompt
from .review import GlobalAgentsMd, ModelReviewer, Review, Reviewer, ReviewRequest
from .storage import Activity, ActivityKind, Record, SessionInfo, SessionStatus, Storage
from .tool_sources import ToolSources, builtins_only, gather, pick
from .tools import Workspace

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
    Ctrl+C. With ``projects``, the first message of a conversation records its folder there. ``tools`` gives the
    sources of the folder's tools (the built-ins unless told otherwise). With ``agents``, the session works with an
    agent: ``agent`` (an id), else the one its project used last, else the default agent. The agent brings its model
    (unless ``model`` says otherwise), its instructions and the tools it turns on from those sources; the tools no
    agent can turn off (the memory's) are always there. The choice is saved with the session and ``set_agent``
    changes it. Edits to the agent apply from the next message, announced in the items. Without agents the session
    has every tool its sources offer and no instructions. With ``memories``, the prompt carries the project's memory,
    its checks and guards apply, and memories approved through ``memories`` reach it as notices; the memory's tools
    come from ``tools``, as ``memories.of(folder)``.

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
        agents: AgentList | None = None,
        tools: ToolSources = builtins_only,
        agent: str | None = None,
        model: str | None = None,
        memories: Memories | None = None,
        _saved: _Saved | None = None,
    ) -> None:
        if mode is not None:
            settings = dataclasses.replace(settings, mode=mode)
        self.workspace = Workspace((cwd or Path.cwd()).resolve())
        self._memory = memories.of(self.workspace.root) if memories is not None else None
        readable = tuple(self._memory.readable()) if self._memory is not None else ()
        self.policy = PermissionPolicy(self.workspace, settings.mode, readable)
        self._checks: CheckRunner | None = None
        self._new_files: dict[str, bool] = {}
        self._watch_rules()
        self._on_event = on_event
        self._on_item_event = on_item_event
        self._storage = storage
        self._reviewers: dict[str, Reviewer] = {}
        self._permissions = build_permissions(
            self.policy,
            _ItemApprover(self, approver),
            self._refusal if self._memory is not None else None,
            reviewer=self._reviewer,
            trusted=[GlobalAgentsMd()],
        )
        self._projects = projects
        self._agents = agents
        self._tool_sources = tools
        self._always: set[str] = set()
        self._applied = self._pick_agent(_saved.info if _saved else None, agent)
        if _saved is None and (chosen := model or (self._applied.model if self._applied else None)):
            settings = settings.with_model(chosen)
        self._reporter = EventReporter(self._dispatch)
        self._state: State | None = None
        self._settings = settings
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
        self._stop_memory = (
            memories.on_approved(self.workspace.root, self._on_memory_approved) if memories is not None else None
        )
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
        agents: AgentList | None = None,
        tools: ToolSources = builtins_only,
        memories: Memories | None = None,
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
            agents=agents,
            tools=tools,
            memories=memories,
            _saved=_Saved(info, records, state),
        )

    def _build_agent(self, settings: Settings) -> Agent:
        try:
            return Agent(
                make_model(settings),
                system=build_system_prompt(
                    self.workspace.root,
                    self._memory.system_block() if self._memory is not None else "",
                    self._applied.instructions if self._applied is not None else "",
                ),
                tools=self._tools(),
                loop=coding,
                permissions=self._permissions,
                reporter=self._reporter,
                human=None,
                store=self._storage.states if self._storage is not None else None,
            )
        except (ValueError, TypeError) as e:
            raise ConfigError(str(e)) from e

    @property
    def review_model(self) -> str | None:
        """The model auto mode's reviewer uses: the configured one, else the session's own."""
        return self._settings.review_model or self._settings.model

    def _reviewer(self) -> Reviewer | None:
        """Auto mode's reviewer for ``review_model``, made once per model. A model that cannot be made is a
        reviewer that fails, so the user is asked and told why."""
        name = self.review_model
        if not name:
            return None
        if name not in self._reviewers:
            try:
                reviewer: Reviewer = ModelReviewer(make_model(self._settings.with_model(name)))
            except (ConfigError, ValueError, TypeError) as e:
                reviewer = _Unavailable(str(e).splitlines()[0] if str(e) else type(e).__name__)
            self._reviewers[name] = _ItemReviewer(self, reviewer)
        return self._reviewers[name]

    def _pick_agent(self, saved: SessionInfo | None, agent_id: str | None) -> AgentConfig | None:
        """The agent a session starts with. A new one: ``agent_id``, else the project's last agent, else the default
        agent. A saved one: its own agent, as the session last applied it (the agent may have been edited since),
        else the default agent."""
        if self._agents is None:
            return None
        if saved is not None:
            found = self._agents.get(saved.agent or "")
            applied = saved.agent_applied
            if found is None and saved.agent and applied:
                # The agent was deleted since. Keep its id and what it was applied with, so the first message
                # switches to the default agent and says so, as for a live session.
                found = dataclasses.replace(self._agents.default(), id=saved.agent, name="")
            picked = found or self._agents.default()
            if not applied:
                return picked
            return dataclasses.replace(
                picked,
                model=applied.get("model"),
                instructions=applied.get("instructions", ""),
                tools=tuple(applied.get("tools", picked.tools)),
            )
        self._agents.list()  # reading the list first runs the profiles migration, which sets the project's last agent
        project = self._projects.get(self.workspace.root) if self._projects is not None else None
        last = project.last_agent if project is not None else None
        return self._agents.get(agent_id or "") or self._agents.get(last or "") or self._agents.default()

    def _tools(self) -> list[Any]:
        """The tools the folder's sources offer that the agent turns on, and those no agent can turn off (without
        agents, all of them)."""
        offered = gather(self._tool_sources(self.workspace.root))
        self._always = {o.tool.name for o in offered if not o.optional}
        return pick(offered, self._applied.tools if self._applied is not None else None)

    # ------------------------------------------------------------ actions

    async def asend(self, text: str) -> str | None:
        """Sends a user message and runs the agent until it answers. Returns the answer, or ``None`` if the run
        was interrupted or failed (a ``Interrupted`` or ``Failed`` event says which).

        Cancelling the task stops the run and keeps the conversation: ``Interrupted`` is emitted, the unfinished
        items are closed and ``CancelledError`` propagates."""
        self._refresh_agent()
        if self._state is None:
            self._state = State(messages=[Message.user(text)], id=self._id)
            if self._projects is not None:
                self._projects.open(self.workspace.root)
                if self._applied is not None:
                    self._projects.set_agent(self.workspace.root, self._applied.id)
            if self._title == NEW_TITLE:
                self._title = _title(text)
        else:
            self._state.add_message(Message.user(text))
        self._recorder.add_user_message(text)
        self._begin_run("thinking")
        try:
            answer = await self._agent.arun(self._state)
            reminded: set[str] = set()
            # A check of what the run did reminds the agent once and lets it go on; it never ends the run itself.
            while isinstance(self._state.stopped, StoppedByUntil):  # it answered (not stopped, not out of turns)
                failed = [say for say in self._run_end_checks() if say not in reminded]
                if not failed:
                    break
                reminded.update(failed)
                self._remind(failed)
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
        if self._memory is not None:
            for source, count in self._memory.on_run_end(self._state).items():
                self._recorder.add_memory_review(source, count)
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
        self._refresh_agent()
        self._agent = self._build_agent(self._settings)  # the new conversation's prompt has today's memory
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
        the new model, and the agent (so the tools) stays the one the session has. Not during a run.

        Raises:
            ConfigError: The model cannot be used. The current model stays.
        """
        settings = self._settings.with_model(model)
        self._agent = self._build_agent(settings)
        self._settings = settings
        self._touch()

    def set_agent(self, agent_id: str) -> None:
        """Puts another agent to work from the next message on: its model (if it has one), instructions and tools.
        The project, the conversation and the safety setting stay. Once the conversation has begun, an
        ``agent_switched`` item says so, and the project remembers the agent. Not during a run.

        Raises:
            LookupError: There are no agents, or none with this id.
            ConfigError: The agent's model cannot be used. The current agent stays.
        """
        if self._agents is None:
            raise LookupError("this session has no agents")
        if self._applied is not None and self._applied.id == agent_id:
            return
        config = self._agents.get(agent_id)
        if config is None:
            raise LookupError(agent_id)
        self._switch(config)

    def _switch(self, config: AgentConfig) -> None:
        previous, settings = self._applied, self._settings
        if config.model:
            settings = settings.with_model(config.model)
        self._applied = config
        try:
            self._agent = self._build_agent(settings)
        except ConfigError:
            self._applied = previous
            raise
        self._settings = settings
        self._recorder.agent = config.id
        if self._state is not None:
            self._recorder.add_agent_switched(config.id, config.name, config.look, config.color)
            if self._projects is not None:
                self._projects.set_agent(self.workspace.root, config.id)
        self._touch()

    def _refresh_agent(self) -> None:
        """Takes the agent's edits since the last message (decision 10 of ``docs/agents.md``). A deleted agent is
        replaced by the default agent. Edits the model never sees (name, description, look) only update what the
        session knows; changed tools, instructions or model rebuild the agent, and once the conversation has begun
        an ``agent_changed`` item says what changed, ahead of the user's message."""
        if self._agents is None or self._applied is None:
            return
        applied = self._applied
        latest = self._agents.get(applied.id)
        if latest is None:
            try:
                self._switch(self._agents.default())
            except ConfigError:
                pass  # keep working with the agent as it was
            return
        # Only tools the agent can turn on or off: one no agent can turn off (the memory's) changes nothing.
        added = [t for t in latest.tools if t not in applied.tools and t not in self._always]
        removed = [t for t in applied.tools if t not in latest.tools and t not in self._always]
        instructions = latest.instructions != applied.instructions
        model_changed = latest.model is not None and latest.model != applied.model
        if not (added or removed or instructions or model_changed):
            self._applied = latest
            return
        self._applied = latest
        moved: str | None = None
        if model_changed:
            assert latest.model is not None
            try:
                settings = self._settings.with_model(latest.model)
                self._agent = self._build_agent(settings)
                self._settings, moved = settings, latest.model
            except ConfigError:
                # Keep the current model, and try the edit again at the next message.
                self._applied = dataclasses.replace(latest, model=applied.model)
        if not (added or removed or instructions or moved):
            return
        if moved is None:
            self._agent = self._build_agent(self._settings)
        if self._state is not None:
            self._recorder.add_agent_changed(
                latest.id, latest.name, latest.look, latest.color, added, removed, instructions, moved
            )
        self._touch()

    def delete(self) -> None:
        """Removes the session from storage and announces ``Deleted``. Cancel a running ``asend`` first. The
        session is not usable afterwards."""
        self._closed = True
        if self._stop_memory is not None:
            self._stop_memory()
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
    def agent_id(self) -> str | None:
        return self._applied.id if self._applied is not None else None

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
            agent=self.agent_id,
            agent_applied=None
            if self._applied is None
            else {
                "model": self._applied.model,
                "instructions": self._applied.instructions,
                "tools": list(self._applied.tools),
            },
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

    def _on_memory_approved(self, memory: Memory, removed: bool) -> None:
        """A memory was approved (or removed) while this session is open. Its check and guard apply from the next
        call. The prompt is kept as it was when the conversation started, so the prompt cache holds; the model hears
        of the memory as a notice instead. Runs on the thread that approved, which must be the event loop's (the
        server approves there)."""
        if self._closed or self._memory is None:
            return
        self._watch_rules()
        if self._state is None:  # nothing was sent yet, so the prompt can still change
            self._agent = self._build_agent(self._settings)
            return
        text = self._memory.recall.notice(memory, removed)
        self._state.add_message(Message.notice(text))
        self._recorder.add_notice(text, "memory_removed" if removed else "memory_added")

    def _dispatch(self, event: Event) -> None:
        """A core event: the item recorder first (so ``snapshot()`` is current), then the frontend's callback."""
        self._recorder.handle(event)
        self._track(event)
        self._check_change(event)
        if self._on_event is not None:
            self._on_event(event)

    # ------------------------------------------------------------ memory checks and guards

    def _watch_rules(self) -> None:
        """Takes the checks and guards of the memories kept now."""
        if self._memory is not None:
            self._checks = self._memory.checks()
            self.policy.guards = self._memory.guards()

    def _facts(self) -> Facts:
        """What the harness saw in this conversation: the commands that ran and the files that changed, in order."""
        events: list[RuleEvent] = []
        run_start = 0
        for item in self._recorder.items:
            if isinstance(item, UserMessage):
                run_start = len(events)
            elif isinstance(item, ToolCallItem) and item.status not in ("running", "denied", "cancelled"):
                if item.name == "bash":
                    command = str(item.args.get("command", ""))
                    events += [RuleEvent("command", words) for words in shell.analyze(command).commands]
                elif item.name in ("edit", "write") and item.status == "done":
                    events.append(self._change(item.id, item.args))
        return Facts(tuple(events), run_start)

    def _change(self, call_id: str, args: dict[str, Any]) -> RuleEvent:
        path = relative(args.get("path"), self.workspace.root)
        return RuleEvent("change", path=path, new=self._new_files.get(call_id, False))

    def _refusal(self, call: ToolCall) -> str | None:
        """Why a command may not run yet, from the checks that run before it; ``None`` when it may."""
        if self._checks is None or call.name != "bash":
            return None
        failed = self._checks.before_command(self._facts(), str(call.args.get("command", "")))
        return "\n".join(failed) or None

    def _check_change(self, event: Event) -> None:
        """Notes whether a file is new before it is written, and runs the checks after a change."""
        if self._checks is None:
            return
        if isinstance(event, ToolStarted) and event.name == "write":
            self._new_files[event.id] = not self.workspace.resolve(str(event.args.get("path", ""))).exists()
        elif isinstance(event, ToolFinished) and event.name in ("edit", "write") and event.kind == "done":
            failed = self._checks.after_change(self._facts(), self._change(event.id, dict(event.args)))
            if failed:
                self._remind(failed)

    def _run_end_checks(self) -> list[str]:
        return self._checks.at_run_end(self._facts()) if self._checks is not None and self._state else []

    def _remind(self, failed: list[str]) -> None:
        """Tells the agent what a memory check found, as a notice the user sees too."""
        assert self._state is not None
        for say in failed:
            text = f"A check from the project's memory failed: {say}"
            self._state.add_message(Message.notice(text))
            self._recorder.add_notice(text, "memory_check")

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
        self._recorder.agent = self.agent_id
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
        self._recorder.agent = self.agent_id
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
            review=request.review,
            review_error=request.review_error,
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


class _ItemReviewer:
    """What auto mode asks: shows the session as ``reviewing`` while ``reviewer`` decides, and records a
    ``review_blocked`` item when it blocks."""

    def __init__(self, session: Session, reviewer: Reviewer) -> None:
        self._session = session
        self._reviewer = reviewer

    async def review(self, request: ReviewRequest) -> Review:
        session = self._session
        session._activity = Activity("reviewing", request.call.tool, _now())
        session._touch()
        try:
            review = await self._reviewer.review(request)
        finally:
            session._activity = Activity("running_tool", request.call.tool, _now())
            session._touch()
        if not review.allow:
            call = request.call
            session._recorder.add_review_blocked(call.call_id, call.tool, call.args, review.reason)
        return review


class _Unavailable:
    """A reviewer whose model cannot be made: every review fails with why."""

    def __init__(self, why: str) -> None:
        self.why = why

    async def review(self, request: ReviewRequest) -> Review:
        raise RuntimeError(self.why)


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
