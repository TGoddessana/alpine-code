"""Session: one conversation with the agent. The only object a frontend drives."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any, TypeVar

from alpineagents import (
    Agent,
    AlpineAgentsError,
    State,
    StoppedByFinish,
    StoppedByLimit,
    StoppedByPermission,
    StoppedByUntil,
)
from alpineagents.types import Stopped

from .approval import Approver, DecideByApprover
from .bridge import EventReporter
from .config import ConfigError, Settings
from .events import Event, Failed, Interrupted, RunFinished, StopReason, UsageInfo
from .loop import coding
from .models import make_model
from .permissions import Mode, PermissionPolicy
from .projects import ProjectList
from .prompt import build_system_prompt
from .tools import Workspace, default_tools


class Session:
    """Owns the agent and the conversation state.

    ``asend`` runs until the agent answers, reporting progress through ``on_event`` (on the event loop's thread) and
    asking ``approver`` before tool calls the permission mode does not allow. Cancelling it stops the run and keeps
    the conversation. ``send`` is the same for a frontend without an event loop, stopped with Ctrl+C. With
    ``projects``, the first message of a conversation records its folder there.

    Raises:
        ConfigError: The settings cannot make a model.
    """

    def __init__(
        self,
        settings: Settings,
        *,
        on_event: Callable[[Event], None],
        approver: Approver,
        cwd: Path | None = None,
        projects: ProjectList | None = None,
    ) -> None:
        self.workspace = Workspace((cwd or Path.cwd()).resolve())
        self.policy = PermissionPolicy(self.workspace, settings.mode)
        self._emit = on_event
        self._permission = DecideByApprover(self.policy, approver)
        self._projects = projects
        self._reporter = EventReporter(on_event)
        self._state: State | None = None
        self._settings = settings
        self._agent = self._build_agent(settings)

    def _build_agent(self, settings: Settings) -> Agent:
        try:
            return Agent(
                make_model(settings),
                system=build_system_prompt(self.workspace.root),
                tools=default_tools(self.workspace),
                loop=coding,
                permissions=[self._permission],
                reporter=self._reporter,
                human=None,
            )
        except (ValueError, TypeError) as e:
            raise ConfigError(str(e)) from e

    # ------------------------------------------------------------ actions

    async def asend(self, text: str) -> str | None:
        """Sends a user message and runs the agent until it answers. Returns the answer, or ``None`` if the run
        was interrupted or failed (a ``Interrupted`` or ``Failed`` event says which).

        Cancelling the task stops the run and keeps the conversation: ``Interrupted`` is emitted and
        ``CancelledError`` propagates."""
        if self._state is None:
            self._state = State(text)
            if self._projects is not None:
                self._projects.open(self.workspace.root)
        else:
            self._state.add_user_message(text)
        try:
            answer = await self._agent.arun(self._state)
        except asyncio.CancelledError:
            self._emit(Interrupted())
            raise
        except KeyboardInterrupt:  # Ctrl+C inside a blocking approver's prompt
            self._emit(Interrupted())
            return None
        except AlpineAgentsError as e:
            self._emit(Failed(_describe_error(e)))
            return None
        stopped = self._state.stopped
        if isinstance(stopped, StoppedByPermission):  # the user declined a call without saying what to do instead
            self._emit(Interrupted())
            return None
        self._emit(RunFinished(_stop_reason(stopped), self.usage))
        return answer if isinstance(answer, str) else None

    def send(self, text: str) -> str | None:
        """``asend`` on a new event loop, for a frontend without one. Ctrl+C stops the run and keeps the
        conversation. Must not be called while an event loop is running on this thread."""
        return _run(self.asend(text))

    def clear(self) -> None:
        """Starts a new conversation."""
        self._state = None

    async def acompact(self) -> bool:
        """Summarizes the conversation to free context. ``False`` if there is nothing to compact or it failed.
        Cancelling works as in ``asend``."""
        if self._state is None or not self._state.context:
            return False
        try:
            await self._agent.acompact(self._state)
        except asyncio.CancelledError:
            self._emit(Interrupted())
            raise
        except KeyboardInterrupt:
            self._emit(Interrupted())
            return False
        except AlpineAgentsError as e:
            self._emit(Failed(_describe_error(e)))
            return False
        return True

    def compact(self) -> bool:
        """``acompact`` on a new event loop, like ``send``."""
        return bool(_run(self.acompact()))

    def set_model(self, model: str) -> None:
        """Switches the model. The conversation restarts, because a conversation belongs to one model.

        Raises:
            ConfigError: The model cannot be used. The current model stays.
        """
        settings = self._settings.with_model(model)
        self._agent = self._build_agent(settings)
        self._settings = settings
        self._state = None

    # ------------------------------------------------------------ read-only views

    @property
    def mode(self) -> Mode:
        return self.policy.mode

    @mode.setter
    def mode(self, mode: Mode) -> None:
        self.policy.mode = mode

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

    @property
    def context_used(self) -> float:
        """Fraction of the model's context window in use, 0.0 to 1.0."""
        return self._state.context_used if self._state is not None else 0.0

    @property
    def has_conversation(self) -> bool:
        return self._state is not None


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


def _describe_error(error: BaseException) -> str:
    message = str(error).strip() or type(error).__name__
    cause = error.__cause__
    if cause is not None and str(cause).strip() and str(cause).strip() not in message:
        message += f"\n{str(cause).strip()}"
    return f"{type(error).__name__}: {message}"
