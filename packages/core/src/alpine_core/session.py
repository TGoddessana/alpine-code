"""Session: one conversation with the agent. The only object a frontend drives."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from alpineagents import Agent, AlpineAgentsError, State

from .approval import Approver
from .bridge import EventReporter
from .config import ConfigError, Settings
from .events import Event, Failed, Interrupted, RunFinished, UsageInfo
from .loop import TurnCancelled, build_loop
from .models import make_model
from .permissions import Mode, PermissionPolicy
from .prompt import build_system_prompt
from .tools import Workspace, default_tools


class Session:
    """Owns the agent and the conversation state.

    ``send`` blocks until the agent answers, reporting progress through ``on_event`` and asking ``approver`` before
    tool calls the permission mode does not allow. Ctrl+C (KeyboardInterrupt) during ``send`` stops the run and
    keeps the conversation.

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
    ) -> None:
        self.workspace = Workspace((cwd or Path.cwd()).resolve())
        self.policy = PermissionPolicy(self.workspace, settings.mode)
        self._emit = on_event
        self._approver = approver
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
                loop=build_loop(self.policy, self._approver, self.workspace),
                reporter=self._reporter,
                human=None,
            )
        except (ValueError, TypeError) as e:
            raise ConfigError(str(e)) from e

    # ------------------------------------------------------------ actions

    def send(self, text: str) -> str | None:
        """Sends a user message and runs the agent until it answers. Returns the answer, or ``None`` if the run
        was interrupted or failed (a ``Interrupted`` or ``Failed`` event says which)."""
        if self._state is None:
            self._state = State(text)
        else:
            self._state.add_user_message(text)
        try:
            answer = self._agent.run(self._state)
        except (KeyboardInterrupt, TurnCancelled):
            self._emit(Interrupted())
            return None
        except AlpineAgentsError as e:
            self._emit(Failed(_describe_error(e)))
            return None
        self._emit(RunFinished(self._state.stopped_by, self.usage))
        return answer if isinstance(answer, str) else None

    def clear(self) -> None:
        """Starts a new conversation."""
        self._state = None

    def compact(self) -> bool:
        """Summarizes the conversation to free context. ``False`` if there is nothing to compact."""
        if self._state is None or not self._state.context:
            return False
        try:
            self._agent.compact(self._state)
        except KeyboardInterrupt:
            self._emit(Interrupted())
            return False
        except AlpineAgentsError as e:
            self._emit(Failed(_describe_error(e)))
            return False
        return True

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
        return UsageInfo(u.input_tokens, u.output_tokens, u.cache_read_tokens, u.requests, u.cost)

    @property
    def context_used(self) -> float:
        """Fraction of the model's context window in use, 0.0 to 1.0."""
        return self._state.context_used if self._state is not None else 0.0

    @property
    def has_conversation(self) -> bool:
        return self._state is not None


def _describe_error(error: BaseException) -> str:
    message = str(error).strip() or type(error).__name__
    cause = error.__cause__
    if cause is not None and str(cause).strip() and str(cause).strip() not in message:
        message += f"\n{str(cause).strip()}"
    return f"{type(error).__name__}: {message}"
