"""The UI-agnostic core of alpine-code.

A frontend creates a ``Session`` with an ``on_event`` callback and an ``Approver``, then calls ``send``. Everything a
frontend needs is exported here; frontends must not import alpineagents or core submodules directly.
"""

from .approval import ApprovalRequest, Approver, Decision
from .config import ConfigError, Connection, Settings, config_file, save_connection, set_default_model
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
from .git import CloneError, GitStatus, PullRequest, clone, current_branch, pull_request
from .git import status as git_status
from .home import home_dir
from .models import ModelListError, list_models
from .permissions import Mode
from .projects import Project, ProjectList
from .providers import PROVIDERS, Api, Billing, Provider
from .secrets import FileSecrets, Secrets
from .session import Session

__all__ = [
    "Session",
    "Settings",
    "ConfigError",
    "home_dir",
    "config_file",
    "Connection",
    "save_connection",
    "set_default_model",
    "Provider",
    "PROVIDERS",
    "Api",
    "Billing",
    "Secrets",
    "FileSecrets",
    "list_models",
    "ModelListError",
    "Project",
    "ProjectList",
    "clone",
    "CloneError",
    "current_branch",
    "git_status",
    "GitStatus",
    "pull_request",
    "PullRequest",
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
