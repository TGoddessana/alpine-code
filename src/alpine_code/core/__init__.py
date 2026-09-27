"""The UI-agnostic core of alpine-code.

A frontend creates a ``Session`` with an ``on_event`` callback and an ``Approver``, then calls ``send``. Everything a
frontend needs is exported here; frontends must not import alpineagents or core submodules directly.
"""

from .approval import ApprovalRequest, Approver, Decision
from .config import ConfigError, Settings, config_dir
from .events import (
    AssistantDone,
    ContextCompacted,
    Event,
    Failed,
    Interrupted,
    Notice,
    RunFinished,
    TextDelta,
    ToolFinished,
    ToolResultKind,
    ToolStarted,
    TurnStarted,
    UsageInfo,
)
from .permissions import Mode
from .session import Session

__all__ = [
    "Session",
    "Settings",
    "ConfigError",
    "config_dir",
    "Mode",
    "Approver",
    "ApprovalRequest",
    "Decision",
    "Event",
    "TurnStarted",
    "TextDelta",
    "AssistantDone",
    "ToolStarted",
    "ToolFinished",
    "ToolResultKind",
    "ContextCompacted",
    "Notice",
    "RunFinished",
    "Interrupted",
    "Failed",
    "UsageInfo",
]
