"""A session's TFs: the session's model proposes one with the ``task_force`` tool, the user starts it, its agents work
in the background under the session's permissions, and the result comes back to the model as a notice.

Decisions (``alpine-code-archive/docs/taskforce.md``): an agent is the session's agent or one named by the script,
whose model may change and whose tools may only narrow (2); agents follow the session's safety setting and the same
question from several of them is one card (3); nothing runs before 시작 (4); the plan's count is the cap (5); while a
TF runs the session's model only reads and answers (7); a rerun reuses finished agents (8).
"""

from __future__ import annotations

import asyncio
import contextvars
import dataclasses
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, TypedDict

from alpineagents import Agent, Message, State, StoppedByPermission, Tool, ToolError, Usage, tool
from alpineagents.permissions import Denied, DenyPermission

from ..approval import ApprovalRequest, Decision
from ..bridge import EventReporter
from ..events import Event, TextDelta, ToolFinished, ToolStarted, TurnStarted
from ..items import Item, ItemRecorder, TaskForceItem, TaskForceStatus, item_to_dict
from ..loop import coding
from ..models import make_model
from ..prompt import build_system_prompt
from ..skills import SkillTool, catalog
from ..tool_sources import gather, pick
from .check import ScriptError, check_script
from .runner import Member, RunOutcome, ScriptRun
from .sandbox import available

if TYPE_CHECKING:
    from ..agents import AgentConfig
    from ..session import Session

#: The tools the session's model keeps while a TF runs (decision 7): it reads and answers, it does not change files.
READING = frozenset({"read", "glob", "grep", "skill"})

#: Tools a TF agent never gets: proposing memory is the session's (decision 2).
NEVER = frozenset({"propose_memory", "task_force", "task_force_status"})

#: Statuses of a TF that is still going.
LIVE: frozenset[TaskForceStatus] = frozenset({"running", "over", "stopping"})

#: Most characters of agents' answers the session's model gets back at the end.
RESULT_LIMIT = 40_000

#: The agent and TF a tool call runs for, so an approval knows who asks.
current_member: contextvars.ContextVar[tuple[_Run, Member] | None] = contextvars.ContextVar(
    "taskforce_member", default=None
)

MEMBER_NOTE = """# You are one agent of a TF
The session's model split a larger job among several agents and gave you one part. Your final answer goes back to
the script that runs the TF, not to a person: nobody reads your messages before it, and nobody can answer
questions. Do your part with the tools you have, then answer with what you found or did, complete and concrete,
so it can be combined with the others' work. Other agents may be working in the same project: only change the
files your part is about."""


class Step(TypedDict):
    """One step of the plan the card shows."""

    title: str
    count: int
    model: str


@dataclass
class _Run:
    id: str
    title: str
    steps: list[dict[str, Any]]
    minutes: int
    script: str
    status: TaskForceStatus = "proposed"
    created_at: str = ""
    started_at: str | None = None
    cache: dict[str, Any] = field(default_factory=dict)
    members: list[dict[str, Any]] = field(default_factory=list)
    """The last view of the members, kept for the screens after the job is gone."""
    step: str = ""
    log: str | None = None
    needed: int | None = None
    error: str | None = None
    result: Any = None
    records: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    """Each member's record (its items), by member id."""
    job: ScriptRun | None = None
    task: asyncio.Task[None] | None = None
    states: dict[str, State] = field(default_factory=dict)
    recorders: dict[str, ItemRecorder] = field(default_factory=dict)
    usage: Usage = field(default_factory=Usage)
    """What the members that ended used."""

    @property
    def planned(self) -> int:
        return sum(int(step.get("count", 0)) for step in self.steps)

    def to_record(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "steps": self.steps,
            "minutes": self.minutes,
            "script": self.script,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "cache": self.cache,
            "members": self.members,
            "step": self.step,
            "log": self.log,
            "error": self.error,
            "records": self.records,
        }

    @classmethod
    def from_record(cls, data: dict[str, Any]) -> _Run:
        return cls(
            id=str(data["id"]),
            title=str(data.get("title", "")),
            steps=list(data.get("steps", [])),
            minutes=int(data.get("minutes", 0)),
            script=str(data.get("script", "")),
            status=data.get("status", "interrupted"),
            created_at=str(data.get("created_at", "")),
            started_at=data.get("started_at"),
            cache=dict(data.get("cache", {})),
            members=list(data.get("members", [])),
            step=str(data.get("step", "")),
            log=data.get("log"),
            error=data.get("error"),
            records=dict(data.get("records", {})),
        )


class StopWhenAsked(DenyPermission):
    """Ends a member's agent at its next tool call once the user stopped it: the reply it is writing still ends."""

    def __init__(self, member: Member) -> None:
        self.member = member

    def check(self, state: State, call: Any, tool: Tool) -> Denied | None:
        return Denied("The user stopped this agent.", stop=True) if self.member.stop_asked else None

    async def acheck(self, state: State, call: Any, tool: Tool) -> Denied | None:
        return self.check(state, call, tool)


@dataclass
class _Group:
    """Agents waiting for the answer to the same question (decision 3)."""

    item_id: str
    answer: asyncio.Task[Decision]


class TaskForce:
    """The TFs of one session. The session owns it and calls ``restore`` once its items are back."""

    def __init__(self, session: Session, *, offered: bool = True) -> None:
        self._session = session
        self._offered = offered
        self._runs: dict[str, _Run] = {}
        self._groups: dict[tuple[str, str], _Group] = {}

    # ------------------------------------------------------------ what the session's model gets

    @property
    def offered(self) -> bool:
        """Whether the session's model may propose a TF: the frontend asked for it, and scripts can run here."""
        return self._offered and available()

    @property
    def active(self) -> bool:
        """A TF is at work: the session's model only reads meanwhile."""
        return any(run.status in LIVE for run in self._runs.values())

    def tools(self) -> list[Tool]:
        if not self.offered:
            return []
        return [self._propose_tool(), self._status_tool()]

    @property
    def usage(self) -> Usage:
        total = Usage()
        for run in self._runs.values():
            total = total + run.usage
            for state in run.states.values():
                total = total + state.usage
        return total

    # ------------------------------------------------------------ the user's controls

    def start(self, run_id: str) -> None:
        """시작: the proposal runs."""
        run = self._run(run_id)
        if run.status != "proposed":
            raise ValueError(f"TF {run_id} is {run.status}, not waiting to start")
        self._launch(run)

    def decline(self, run_id: str) -> None:
        """혼자 하기: the proposal ends, and the session's model goes on alone."""
        run = self._run(run_id)
        if run.status != "proposed":
            raise ValueError(f"TF {run_id} is {run.status}, not waiting to start")
        run.status = "declined"
        self._end(run)
        self._session._request_turn(
            f'The user chose to go on without the TF "{run.title}" (혼자 하기). Do the work yourself, in this '
            "conversation."
        )

    def stop(self, run_id: str) -> None:
        """멈추기 / 여기까지 결과 받기."""
        run = self._run(run_id)
        if run.job is not None and run.status in LIVE:
            run.job.stop()

    def stop_member(self, run_id: str, member_id: str) -> bool:
        run = self._run(run_id)
        return run.job is not None and run.job.stop_member(member_id)

    def allow_more(self, run_id: str) -> None:
        """계속: more agents than the card said."""
        run = self._run(run_id)
        if run.job is not None:
            run.job.allow_more()

    def resume(self, run_id: str, *, fresh: bool = False) -> None:
        """이어 하기 after the app was closed mid-run: finished agents are reused unless ``fresh``."""
        run = self._run(run_id)
        if run.status != "interrupted":
            raise ValueError(f"TF {run_id} is {run.status}, not interrupted")
        if fresh:
            run.cache = {}
        self._launch(run)

    def take_results(self, run_id: str) -> None:
        """결과만 받기 after the app was closed mid-run: what finished goes to the session's model."""
        run = self._run(run_id)
        if run.status != "interrupted":
            raise ValueError(f"TF {run_id} is {run.status}, not interrupted")
        run.status = "stopped"
        self._end(run)
        self._session._request_turn(self._notice(run, RunOutcome("stopped")))

    def record(self, run_id: str, member_id: str) -> list[Item]:
        """What one agent did: its items, read-only."""
        run = self._run(run_id)
        recorder = run.recorders.get(member_id)
        if recorder is not None:
            return [*recorder.items, *recorder.active]
        from ..items import item_from_dict

        return [item_from_dict(data) for data in run.records.get(member_id, [])]

    def status_text(self) -> str:
        """What the status tool tells the session's model."""
        if not self._runs:
            return "No TF in this session."
        out = []
        for run in self._runs.values():
            members = self._members(run)
            counts: dict[str, int] = {}
            for member in members:
                counts[member["state"]] = counts.get(member["state"], 0) + 1
            lines = [f'TF "{run.title}" ({run.id}): {run.status}, step {run.step or "-"}, agents {counts}']
            if run.log:
                lines.append(f"  latest log: {run.log}")
            for member in members:
                doing = f", {member['activity']}" if member.get("activity") else ""
                doing += f" ({member['error']})" if member.get("error") else ""
                lines.append(f"  - {member['id']} [{member['step']}] {member['task']}: {member['state']}{doing}")
            out.append("\n".join(lines))
        return "\n\n".join(out)

    # ------------------------------------------------------------ session lifecycle

    def restore(self) -> None:
        """Brings back the session's TFs after a restart: a proposal still waits, a run that was going waits for
        이어 하기 or 결과만 받기; the ended ones are in the items already."""
        storage = self._session._storage
        if storage is None or storage.runs is None:
            return
        for data in storage.runs.list(self._session.id):
            try:
                run = _Run.from_record(data)
            except (KeyError, TypeError, ValueError):
                continue
            self._runs[run.id] = run
            if run.status in LIVE:
                run.status = "interrupted"
                self._save(run)
            if run.status in ("proposed", "interrupted"):
                self._show(run)

    async def aclose(self) -> None:
        """Stops the running TFs, so they can be continued (the server is shutting down)."""
        tasks = [run.task for run in self._runs.values() if run.task is not None and not run.task.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------ approvals

    async def ask(self, request: ApprovalRequest, ask: Callable[[ApprovalRequest], Awaitable[Decision]]) -> Decision:
        """A member's call needs the user: one card per question, however many members ask it."""
        found = current_member.get()
        assert found is not None
        run, member = found
        recorder = self._session._recorder
        member.state = "asking"
        self._changed(run)
        try:
            key = (request.tool, request.remember) if request.remember else None
            group = self._groups.get(key) if key is not None else None
            if group is not None and not group.answer.done():
                recorder.ask_also(group.item_id, member.task)
                return await asyncio.shield(group.answer)
            item = recorder.start_approval(
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
                asked_by=[member.task],
            )
            asked = dataclasses.replace(request, request_id=item.id)

            async def answer() -> Decision:
                try:
                    decision = await ask(asked)
                except asyncio.CancelledError:
                    recorder.finish_approval(item.id, "deny", cancelled=True)
                    raise
                recorder.finish_approval(item.id, decision.kind, decision.feedback)
                if key is not None:
                    self._groups.pop(key, None)
                return decision

            task = asyncio.get_running_loop().create_task(answer())
            if key is not None:
                self._groups[key] = _Group(item.id, task)
            return await asyncio.shield(task)
        finally:
            if member.state == "asking":
                member.state = "working"
            self._changed(run)

    # ------------------------------------------------------------ the tools

    def _propose_tool(self) -> Tool:
        task_force = self

        # Asks nothing of the user itself: the card it puts up is the question (decision 4).
        @tool(name="task_force", description=_describe(self._session), read_only=True, open_world=False)
        def propose(
            title: str,
            steps: list[Step],
            minutes: int,
            script: str,
            resume: str | None = None,
        ) -> str:
            return task_force._propose(title, steps, minutes, script, resume)

        return propose

    def _status_tool(self) -> Tool:
        task_force = self

        @tool(
            name="task_force_status",
            description="How the session's TFs are doing: each one's status and step, every agent's state and what "
            "it is doing. Use it to answer the user while a TF runs.",
            read_only=True,
            open_world=False,
        )
        def status() -> str:
            return task_force.status_text()

        return status

    def _propose(self, title: str, steps: list[Step], minutes: int, script: str, resume: str | None) -> str:
        try:
            check_script(script)
        except ScriptError as e:
            raise ToolError(f"The script needs changes before it can run:\n{e}") from e
        plan = _plan(steps)
        if self.active:
            raise ToolError("A TF is already running in this session. Wait for its result.")
        if resume is not None:
            earlier = self._runs.get(resume)
            if earlier is None or earlier.status != "failed":
                raise ToolError(f"There is no failed TF {resume!r} to continue; propose a new one without resume.")
            if sum(step["count"] for step in plan) <= earlier.planned:
                earlier.script, earlier.steps = script, plan
                self._launch(earlier)
                return (
                    f'TF "{earlier.title}" runs again with the fixed script; agents that finished are reused. Its '
                    "result comes to you as a notice when it ends. End your turn now."
                )
        run = _Run(
            id=uuid.uuid4().hex[:12],
            title=" ".join(str(title).split())[:80] or "TF",
            steps=plan,
            minutes=max(1, int(minutes)),
            script=script,
            created_at=_now(),
            cache=dict(self._runs[resume].cache) if resume in self._runs else {},
        )
        self._runs[run.id] = run
        self._show(run)
        self._save(run)
        return (
            f'Proposed TF "{run.title}" ({run.id}) to the user: {run.planned} agents. Nothing runs until they press '
            "시작; if they choose 혼자 하기 you will be told to go on yourself. Its result comes to you as a "
            "notice. End your turn now without repeating the plan."
        )

    # ------------------------------------------------------------ running

    def _launch(self, run: _Run) -> None:
        run.status, run.error, run.needed, run.started_at = "running", None, None, _now()
        run.job = ScriptRun(
            run.script,
            lambda member: self._spawn(run, member),
            planned=run.planned,
            cache=run.cache,
            on_change=lambda job: self._changed(run),
        )
        self._session._refresh_reading()
        self._show(run)
        self._save(run)
        run.task = asyncio.get_running_loop().create_task(self._go(run))

    async def _go(self, run: _Run) -> None:
        assert run.job is not None
        try:
            outcome = await run.job.run()
        except asyncio.CancelledError:
            run.status = "interrupted"
            run.members = self._members(run)
            self._keep_records(run)
            self._save(run)
            raise
        except Exception as e:  # the worker could not start
            outcome = RunOutcome("failed", error=f"The TF could not run: {type(e).__name__}: {e}")
        run.status, run.error, run.result = outcome.status, outcome.error, outcome.result
        run.members = self._members(run)
        self._keep_records(run)
        self._end(run)
        self._session._refresh_reading()
        self._session._request_turn(self._notice(run, outcome))

    async def _spawn(self, run: _Run, member: Member) -> Any:
        session = self._session
        request = member.request
        config = self._config(request.agent)
        settings = session._settings.with_model(self._model(request.model, config))
        recorder = ItemRecorder(lambda seq, event: None)
        recorder.agent = config.id if config is not None else None
        run.recorders[member.id] = recorder

        def emit(event: Event) -> None:
            recorder.handle(event)
            match event:
                case TurnStarted(turn):
                    member.turn, member.activity = turn, "thinking"
                case TextDelta():
                    if member.activity == "thinking":
                        member.activity = "writing"
                    else:
                        return
                case ToolStarted(name=name):
                    member.activity = _activity(name)
                case ToolFinished():
                    member.activity = "thinking"
                case _:
                    return
            self._changed(run)

        agent = Agent(
            make_model(settings),
            system=self._system(config),
            tools=self._tools_for(config, request.tools),
            loop=coding,
            permissions=[StopWhenAsked(member), *session._permissions],
            reporter=EventReporter(emit),
            human=None,
            store=None,
        )
        prompt = request.prompt
        if request.returns is not None:
            prompt += (
                "\n\nWhen you are done, your final answer must be only a JSON value of this shape, nothing else:\n"
                + json.dumps(request.returns, ensure_ascii=False)
            )
        state = State(messages=[Message.user(prompt)])
        run.states[member.id] = state
        token = current_member.set((run, member))
        try:
            answer = await agent.arun(state)
        finally:
            current_member.reset(token)
            run.usage = run.usage + state.usage
            del run.states[member.id]
        if member.stop_asked or isinstance(state.stopped, StoppedByPermission):
            return None
        if request.returns is None:
            return answer if isinstance(answer, str) else state.answer
        return _json(answer if isinstance(answer, str) else str(state.answer or ""))

    def _config(self, name: str | None) -> AgentConfig | None:
        """The agent a member works as: the session's own, or one of the user's by name (or id)."""
        session = self._session
        if name is None or session._agents is None:
            return session._applied
        wanted = name.casefold().strip()
        for config in session._agents.list():
            if config.id == name or (config.name or "").casefold().strip() == wanted:
                return config
        known = ", ".join(c.name or c.id for c in session._agents.list())
        raise ValueError(f"No agent named {name!r}. The user's agents: {known}")

    def _model(self, wanted: str | None, config: AgentConfig | None) -> str:
        """The model by name; one without a connection takes the session model's connection."""
        session = self._session
        name = wanted or (config.model if config is not None else None) or session._settings.model or ""
        if wanted and "/" not in wanted and "/" in (session._settings.model or ""):
            name = session._settings.model.split("/", 1)[0] + "/" + wanted  # type: ignore[union-attr]
        return name

    def _tools_for(self, config: AgentConfig | None, narrowed: tuple[str, ...] | None) -> list[Any]:
        session = self._session
        offered = gather(session._tool_sources(session.workspace.root))
        tools = [t for t in pick(offered, config.tools if config is not None else None) if t.name not in NEVER]
        if narrowed is not None:
            unknown = set(narrowed) - {t.name for t in tools}
            if unknown:
                raise ValueError(f"This agent has no tool {sorted(unknown)}; it has {sorted(t.name for t in tools)}")
            tools = [t for t in tools if t.name in narrowed]
        skills = self._skills(config)
        if skills and (narrowed is None or "skill" in narrowed):
            tools.append(SkillTool(skills))
        return tools

    def _skills(self, config: AgentConfig | None) -> tuple[Any, ...]:
        library = self._session._skill_library
        if library is None:
            return ()
        off = set(config.skills_off) if config is not None else set()
        return tuple(s for s in library.for_project(self._session.workspace.root) if s.name not in off)

    def _system(self, config: AgentConfig | None) -> str:
        session = self._session
        memory = session._memory.system_block() if session._memory is not None else ""
        instructions = config.instructions if config is not None else ""
        prompt = build_system_prompt(session.workspace.root, memory, instructions, catalog(self._skills(config)))
        return f"{prompt}\n\n{MEMBER_NOTE}"

    # ------------------------------------------------------------ what the screens show

    def _changed(self, run: _Run) -> None:
        if run.job is not None:
            run.step, run.log, run.needed = run.job.step, run.job.log, run.job.needed
            if run.status in LIVE:
                run.status = run.job.status if run.job.status in LIVE else run.status
        run.members = self._members(run)
        self._show(run)

    def _members(self, run: _Run) -> list[dict[str, Any]]:
        if run.job is None:
            return run.members
        views = [self._member_view(member) for member in run.job.members]
        # A script that never calls phase(): its agents fill the plan's steps in order, as many as each counts.
        slots, index, used = [(str(s["title"]), int(s["count"])) for s in run.steps], 0, 0
        for view in views:
            if view["step"]:
                continue
            while index < len(slots) and used >= slots[index][1]:
                index, used = index + 1, 0
            if index < len(slots):
                view["step"], used = slots[index][0], used + 1
        return views

    def _member_view(self, member: Member) -> dict[str, Any]:
        try:
            config = self._config(member.request.agent)
        except ValueError:
            config = None
        return {
            "id": member.id,
            "step": member.step,
            "task": member.task,
            "agent": (config.name if config is not None else None) or "",
            "look": config.look if config is not None else "antenna",
            "color": config.color if config is not None else 2,
            "model": self._model(member.request.model, config),
            "state": member.state,
            "activity": member.activity,
            "turn": member.turn,
            "source": member.source,
            "cached": member.cached,
            "error": member.error,
        }

    def _item(self, run: _Run) -> TaskForceItem:
        return TaskForceItem(
            run.id,
            run.title,
            [dict(step) for step in run.steps],
            run.minutes,
            run.status,
            [dict(member) for member in run.members],
            run.step,
            run.log,
            run.needed if run.status == "over" else None,
            run.error,
            run.started_at,
        )

    def _show(self, run: _Run) -> None:
        self._session._recorder.show_taskforce(self._item(run))

    def _end(self, run: _Run) -> None:
        self._session._recorder.end_taskforce(self._item(run))
        self._save(run)

    def _keep_records(self, run: _Run) -> None:
        for member_id, recorder in run.recorders.items():
            run.records[member_id] = [_trim(item_to_dict(item)) for item in (*recorder.items, *recorder.active)]

    def _save(self, run: _Run) -> None:
        storage = self._session._storage
        if storage is not None and storage.runs is not None and self._session.id:
            storage.runs.save(self._session.id, run.id, run.to_record())

    def _run(self, run_id: str) -> _Run:
        run = self._runs.get(run_id)
        if run is None:
            raise LookupError(f"No TF {run_id} in this session")
        return run

    def _notice(self, run: _Run, outcome: RunOutcome) -> str:
        """What the session's model hears when a TF ends."""
        members = run.members
        done = [m for m in members if m["state"] == "done"]
        lines = [
            f'The TF "{run.title}" ({run.id}) ended: {outcome.status}. {len(done)} of {len(members)} agents finished.'
        ]
        if outcome.status == "failed":
            lines.append(
                "The script failed:\n"
                + (outcome.error or "")
                + f'\nFix the script and call task_force again with resume="{run.id}": agents that finished are '
                "reused, and it starts without a new card while the steps add up to no more than before."
            )
        if outcome.status == "stopped":
            lines.append("The user stopped it; work with what finished.")
        if outcome.result is not None:
            lines.append("The script's result:\n" + _clip(json.dumps(outcome.result, ensure_ascii=False, indent=1)))
        elif run.job is not None:
            answers = [
                f"- {m.id} [{m.step}] {m.task}: "
                + (m.answer if isinstance(m.answer, str) else json.dumps(m.answer, ensure_ascii=False))
                for m in run.job.members
                if m.state == "done"
            ]
            if answers:
                lines.append("The agents' answers (the script set no result):\n" + _clip("\n".join(answers)))
        failed = [
            f"{m['id']} {m['task']}: {m['state']}" + (f" ({m['error']})" if m.get("error") else "")
            for m in members
            if m["state"] in ("failed", "stopped")
        ]
        if failed:
            lines.append("Did not finish: " + "; ".join(failed))
        lines.append("Tell the user what came of it, in their words.")
        return "\n\n".join(lines)


def _describe(session: Session) -> str:
    agents = ", ".join(sorted({c.name for c in session._agents.list() if c.name})) if session._agents else ""
    models = {session._settings.model or ""} | (
        {c.model for c in session._agents.list() if c.model} if session._agents else set()
    )
    return f"""Put together a TF (task force): several agents that split up work too big for one conversation, run by a
Python script you write. Use it when doing the work alone would make you cover only part of it: drawing or re-fitting
the product map of a large codebase, auditing whether promises hold, a first review of many patches, a refactor
across many files. Not for small jobs.

The user sees a card with your plan (steps, agents per step, models, minutes) and presses 시작; nothing runs before.
After calling this tool, end your turn. The TF runs in the background; meanwhile you can only read and answer
questions (task_force_status shows its progress). When it ends its result comes to you as a notice.

The script is Python with top-level await. It cannot read files, run commands or reach the network: agents do that.
Allowed imports: json, re, math, itertools, collections, functools, textwrap, statistics. Built-in names:
- await agent(prompt, agent=None, model=None, tools=None, returns=None, label=None, phase=None): runs one agent to the
  end and returns its answer; with returns (a JSON shape, e.g. {{"topics": ["..."]}}) the parsed JSON. None if it
  failed or was stopped. The prompt is all it knows: put in everything it needs. agent= picks one of the user's
  agents by name ({agents or "only the session's agent"}); default is the session's agent. model= picks a model,
  e.g. one of {", ".join(sorted(m for m in models if m))}. tools= narrows its tools (never widens). label= is what
  the user sees for it (a topic, a file). phase= is the plan step it counts in (default: the latest phase()); give
  it inside parallel() and pipeline(), where stages of different steps run at once.
- await parallel([agent(...), ...]): runs them at the same time (at most 6 work at once); results in order.
- await pipeline(items, stage1, stage2, ...): each item through async stages in turn, items at once.
- phase("작성"): the step the next agents belong to; use the step titles of your plan.
- log("주제 6개로 나눴어요"): one line for the user, in their language (print does the same).
- budget(): how many more agents the plan allows. args: unused.
- result = ...: what you get back at the end.
The script must make the same calls when it runs again (no clock, no randomness): a rerun reuses finished agents.
More agents than the plan counts wait for the user's OK, so count honestly.

What worked (a PostgreSQL product map: one session stopped near 17 cards; a TF of 14 agents drew 103, yet an
audit found only 77% of its promises exact):
- Split the work wide enough, and by what can break as well as by who uses it: splitting only by kind of user lost
  every card about durability and crash recovery.
- Let a stronger model review what cheaper ones wrote: cheap reviewers missed promises that hold only under a
  condition ("only when logging_collector=on"); a strong reviewer caught them.
- Ask agents to run the tests that prove a claim, not to read expected-output files.
- Repeat a pass that looks for what is still missing until it finds nothing new.
- Keep agents off each other's files: work on one file goes to one agent, or runs in order.

Args:
    title: What the TF does, in the user's words and language, e.g. "지도 그리기".
    steps: The plan the card shows, in order: [{{"title": "조사", "count": 1, "model": "..."}}, ...].
    minutes: Expected minutes.
    script: The script.
    resume: The id of a TF whose script failed, to run the fixed script reusing its finished agents."""


def _plan(steps: Any) -> list[dict[str, Any]]:
    if not isinstance(steps, list) or not steps:
        raise ToolError('steps must be a list like [{"title": "작성", "count": 6, "model": "..."}]')
    plan = []
    for step in steps:
        if not isinstance(step, dict) or not str(step.get("title", "")).strip():
            raise ToolError(f"Each step needs a title, a count and a model: {step!r}")
        try:
            count = int(step.get("count", 0))
        except (TypeError, ValueError) as e:
            raise ToolError(f"A step's count must be a number: {step!r}") from e
        if count < 1:
            raise ToolError(f"A step needs at least one agent: {step!r}")
        plan.append({"title": str(step["title"]).strip(), "count": count, "model": str(step.get("model") or "")})
    return plan


def _activity(tool_name: str) -> str:
    if tool_name == "read":
        return "read"
    if tool_name in ("glob", "grep"):
        return "search"
    if tool_name in ("write", "edit"):
        return "edit"
    if tool_name == "bash" or tool_name.startswith("process_"):
        return "run"
    return "tool"


def _json(text: str) -> Any:
    body = text.strip()
    if body.startswith("```"):
        body = body.split("\n", 1)[1] if "\n" in body else ""
        body = body.rsplit("```", 1)[0]
    try:
        return json.loads(body)
    except ValueError:
        start = min((i for i in (body.find("{"), body.find("[")) if i >= 0), default=-1)
        if start >= 0:
            try:
                return json.loads(body[start : max(body.rfind("}"), body.rfind("]")) + 1])
            except ValueError:
                pass
    raise ValueError("the agent's answer was not the JSON asked for")


def _clip(text: str) -> str:
    return text if len(text) <= RESULT_LIMIT else text[:RESULT_LIMIT] + "\n… (cut: too long)"


def _trim(data: dict[str, Any]) -> dict[str, Any]:
    if isinstance(data.get("result"), str) and len(data["result"]) > 2000:
        data["result"] = data["result"][:2000] + "…"
    return data


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")
