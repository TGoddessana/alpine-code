"""Runs a TF script: the sandboxed worker plans, Alpine starts the agents it asks for.

``ScriptRun`` starts the worker (``sandbox.command``), answers its requests and keeps what the screens show: one
``Member`` per ``agent()`` call, the step it belongs to, the script's latest ``log()`` line. Agents are started by
``spawn``, which the session provides (decision 2). At most ``concurrency`` work at once and at most ``planned`` are
started; one more waits until the user allows more or stops (decision 5). A finished call's answer is kept in
``cache`` under a key of what was asked, so running the script again answers it at once (decision 8).
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from . import sandbox

MemberState = Literal["queued", "working", "asking", "done", "failed", "stopped"]
RunStatus = Literal["running", "over", "stopping", "done", "stopped", "failed"]

#: How many agents work at once (decision 5).
CONCURRENCY = 6

#: How long a stopped script may keep running once no agent works, before it is ended.
STOP_GRACE = 30.0

#: Shortest answer that counts as handed over when a later prompt quotes it (for the walk on the screen).
_QUOTED = 40


@dataclass(frozen=True)
class AgentRequest:
    """One ``agent()`` call, as the script made it."""

    prompt: str
    agent: str | None = None
    model: str | None = None
    tools: tuple[str, ...] | None = None
    returns: Any = None
    label: str | None = None

    def key(self) -> str:
        data = [self.prompt, self.agent, self.model, list(self.tools) if self.tools is not None else None, self.returns]
        return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


@dataclass
class Member:
    """One agent of the run, as the screens draw it."""

    id: str
    step: str
    task: str
    request: AgentRequest
    state: MemberState = "queued"
    activity: str | None = None
    turn: int = 0
    source: str | None = None
    """The member whose answer this one's prompt quotes: it walks over to hand it."""
    cached: bool = False
    """Answered from an earlier run of the script."""
    answer: Any = None
    error: str | None = None
    stop_asked: bool = False


@dataclass
class RunOutcome:
    status: Literal["done", "stopped", "failed"]
    result: Any = None
    """What the script set ``result`` to."""
    error: str | None = None
    """The script's error with the lines of the script it came from, for the model to fix."""


Spawn = Callable[[Member], Awaitable[Any]]
"""Runs one member's agent to the end: its answer (parsed when ``returns`` was given), or ``None``. It sets
``member.activity``, ``turn`` and ``state`` (``asking``) as the agent goes and calls ``ScriptRun.changed``. It stops
the agent once ``member.stop_asked`` is set."""


@dataclass
class ScriptRun:
    script: str
    spawn: Spawn
    planned: int
    """How many agents the user agreed to (the card's number)."""
    args: Any = None
    cache: dict[str, Any] = field(default_factory=dict)
    on_change: Callable[[ScriptRun], None] | None = None
    concurrency: int = CONCURRENCY
    command: list[str] | None = None
    """The worker's command; ``sandbox.command()`` by default."""

    members: list[Member] = field(default_factory=list)
    status: RunStatus = "running"
    step: str = ""
    log: str | None = None
    needed: int | None = None
    """While ``over``: how many agents the script wants in all."""

    def __post_init__(self) -> None:
        self._started = 0
        self._cap = self.planned
        self._waiting_at_cap = 0
        self._more = asyncio.Event()
        self._slots = asyncio.Semaphore(self.concurrency)
        self._seen: dict[str, int] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._stopping = False
        self._process: asyncio.subprocess.Process | None = None

    # ------------------------------------------------------------ the user's controls

    def stop(self) -> None:
        """여기까지 결과 받기: no new agents; working ones stop after the reply they are writing."""
        if self._stopping or self.status in ("done", "stopped", "failed"):
            return
        self._stopping = True
        self.status = "stopping"
        self.needed = None
        self._more.set()
        for member in self.members:
            if member.state in ("working", "asking"):
                member.stop_asked = True
        self.changed()

    def stop_member(self, member_id: str) -> bool:
        """Stops one agent: one waiting for its turn never starts, a working one stops after its reply."""
        for member in self.members:
            if member.id == member_id and member.state in ("queued", "working", "asking"):
                member.stop_asked = True
                self.changed()
                return True
        return False

    def allow_more(self) -> None:
        """계속: the cap becomes what the script wants now."""
        if self.status != "over" or self.needed is None:
            return
        self._cap = self.needed
        self.needed = None
        self.status = "running"
        self._more.set()
        self.changed()

    def changed(self) -> None:
        if self.on_change is not None:
            self.on_change(self)

    @property
    def remaining(self) -> int:
        return max(0, self._cap - self._started)

    # ------------------------------------------------------------ running

    async def run(self) -> RunOutcome:
        command = self.command or sandbox.command()
        self._process = process = await asyncio.create_subprocess_exec(
            *command,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=sandbox.ENV,
            limit=2**24,
        )
        assert process.stdin is not None and process.stdout is not None
        start = {"script": self.script, "args": self.args, "remaining": self.remaining}
        process.stdin.write((json.dumps(start, ensure_ascii=False) + "\n").encode())
        outcome: RunOutcome | None = None
        watchdog = asyncio.create_task(self._end_when_stopped())
        try:
            while line := await process.stdout.readline():
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                match message.get("op"):
                    case "agent":
                        self._track(asyncio.create_task(self._agent(message)))
                    case "phase":
                        self.step = str(message.get("title", ""))
                        self.changed()
                    case "log":
                        self.log = str(message.get("text", ""))
                        self.changed()
                    case "done":
                        outcome = RunOutcome("stopped" if self._stopping else "done", message.get("result"))
                    case "error":
                        outcome = RunOutcome("failed", error=str(message.get("traceback") or message.get("message")))
            await process.wait()
        except asyncio.CancelledError:
            self._kill()
            for task in list(self._tasks):
                task.cancel()
            raise
        finally:
            watchdog.cancel()
        for task in list(self._tasks):  # calls the script never awaited
            task.cancel()
        if outcome is None:
            stderr = (await process.stderr.read()).decode(errors="replace") if process.stderr else ""
            ended = "it was stopped" if self._stopping else f"it ended with code {process.returncode}"
            outcome = RunOutcome(
                "stopped" if self._stopping else "failed",
                error=f"The script ended without finishing ({ended}). {stderr.strip()[-2000:]}".strip(),
            )
        self.status = outcome.status
        self.changed()
        return outcome

    def _track(self, task: asyncio.Task[None]) -> None:
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _agent(self, message: dict[str, Any]) -> None:
        tools = message.get("tools")
        request = AgentRequest(
            prompt=str(message.get("prompt", "")),
            agent=message.get("agent"),
            model=message.get("model"),
            tools=tuple(str(t) for t in tools) if isinstance(tools, list) else None,
            returns=message.get("returns"),
            label=message.get("label"),
        )
        key = request.key()
        self._seen[key] = self._seen.get(key, 0) + 1
        key = f"{key}:{self._seen[key]}"  # the same call made twice is two agents
        member = Member(
            id=f"a{len(self.members) + 1}",
            step=self.step,
            task=_task(request),
            request=request,
            source=self._source(request.prompt),
        )
        self.members.append(member)
        value = await self._answer(member, key)
        self._reply(message["id"], value)

    async def _answer(self, member: Member, key: str) -> Any:
        if key in self.cache:
            member.state, member.cached, member.answer = "done", True, self.cache[key]
            self.changed()
            return member.answer
        if not await self._may_start(member):
            member.state = "stopped"
            self.changed()
            return None
        async with self._slots:
            if self._stopping or member.stop_asked:
                member.state = "stopped"
                self.changed()
                return None
            member.state = "working"
            self.changed()
            try:
                value = await self.spawn(member)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # the agent failed: the script gets None and goes on
                member.state, member.error = "failed", f"{type(e).__name__}: {e}"
                self.changed()
                return None
        member.activity = None
        if member.stop_asked:
            member.state = "stopped"
        elif value is None:
            member.state = "failed"
        else:
            member.state, member.answer = "done", value
            self.cache[key] = value
        self.changed()
        return value

    async def _may_start(self, member: Member) -> bool:
        """Counts the member against the plan; waits while the plan is used up. ``False`` when stopped."""
        self._waiting_at_cap += 1
        try:
            while self._started >= self._cap and not self._stopping and not member.stop_asked:
                self.status = "over"
                self.needed = self._started + self._waiting_at_cap
                self._more.clear()
                self.changed()
                await self._more.wait()
        finally:
            self._waiting_at_cap -= 1
        if self._stopping or member.stop_asked:
            return False
        self._started += 1
        return True

    def _reply(self, request_id: Any, value: Any) -> None:
        process = self._process
        if process is None or process.stdin is None or process.stdin.is_closing():
            return
        answer = {"id": request_id, "value": value, "remaining": self.remaining}
        with contextlib.suppress(ConnectionError, RuntimeError):
            process.stdin.write((json.dumps(answer, ensure_ascii=False) + "\n").encode())

    def _source(self, prompt: str) -> str | None:
        for earlier in reversed(self.members):
            if earlier.answer is None:
                continue
            text = earlier.answer if isinstance(earlier.answer, str) else json.dumps(earlier.answer, ensure_ascii=False)
            quote = text.strip()[:_QUOTED]
            if len(quote) >= _QUOTED and quote in prompt:
                return earlier.id
        return None

    async def _end_when_stopped(self) -> None:
        """After 멈추기, a script that keeps going with nobody working is ended."""
        while True:
            await asyncio.sleep(1)
            if not self._stopping:
                continue
            if any(m.state in ("working", "asking") for m in self.members):
                continue
            await asyncio.sleep(STOP_GRACE)
            if not any(m.state in ("working", "asking") for m in self.members):
                self._kill()
                return

    def _kill(self) -> None:
        if self._process is not None and self._process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                self._process.kill()


def _task(request: AgentRequest) -> str:
    """What the screens call the member: the script's label, else the prompt's first line, shortened."""
    text = request.label or next((line for line in request.prompt.splitlines() if line.strip()), request.prompt)
    text = " ".join(text.split())
    return text if len(text) <= 40 else text[:39].rstrip() + "…"
