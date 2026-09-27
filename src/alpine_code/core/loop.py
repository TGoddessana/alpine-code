"""The agent loop: compact when full, ask the model, check permissions, run the tools."""

from __future__ import annotations

from alpineagents import Agent, State, compact_if_full, loop

from .approval import Approver, describe
from .permissions import PermissionPolicy
from .tools import Workspace

DEFAULT_LIMIT = 200

DECLINED = "The user declined this tool call."


class TurnCancelled(Exception):
    """Raised inside the loop when the user declines a call without saying what to do instead. The run stops,
    pending calls are closed, and the conversation waits for the user's next message."""


def build_loop(policy: PermissionPolicy, approver: Approver, workspace: Workspace, limit: int = DEFAULT_LIMIT):
    @loop(until=State.is_answered, limit=limit)
    def coding(agent: Agent, state: State):
        compact_if_full(agent, state)
        agent.think(state)
        for call in state.pending_calls:
            args = dict(call.args)
            verdict = policy.evaluate(call.name, args)
            if verdict.allowed:
                continue
            request = describe(call.name, args, workspace, reason=verdict.reason, remember=verdict.remember)
            decision = approver.approve(request)
            if decision.kind == "allow_always" and verdict.grant is not None:
                policy.remember(verdict.grant)
            elif decision.kind == "deny":
                if not decision.feedback:
                    state.deny(call, f"{DECLINED} Wait for their next message.")
                    raise TurnCancelled
                state.deny(call, f"{DECLINED} They said: {decision.feedback}")
        if state.wants_tools():
            agent.use_tools(state)

    return coding
