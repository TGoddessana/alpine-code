"""TF (Task Force): the session's model writes a script that hands work to many agents, and Alpine runs it as written.

Decisions: ``alpine-code-archive/docs/taskforce.md``. The script runs in a sandboxed worker (``sandbox``,
``worker``); ``runner.ScriptRun`` answers it and starts the agents; ``store.RunStore`` keeps runs for a rerun."""

from .check import ScriptError, check_script
from .runner import AgentRequest, Member, RunOutcome, ScriptRun
from .sandbox import available
from .store import RunStore

__all__ = [
    "AgentRequest",
    "Member",
    "RunOutcome",
    "RunStore",
    "ScriptError",
    "ScriptRun",
    "available",
    "check_script",
]
