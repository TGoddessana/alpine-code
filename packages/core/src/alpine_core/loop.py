"""The agent loop: tidy the conversation when full, ask the model, run the tools. Permissions decide inside
``ause_tools``; ``tidy.py`` decides when and how the conversation is tidied."""

from __future__ import annotations

from alpineagents import Agent, State, loop

from .tidy import athink_fitting, tidy_if_full

#: Most model turns in one ``Session.asend``.
TURN_LIMIT = 200


def is_answered(state: State) -> bool:
    """The model's last message asks for no tools: it is the answer, and the user speaks next."""
    if state.pending_calls or not state.messages:
        return False
    last = state.messages[-1]
    return last.role == "assistant" and not last.tool_calls


@loop(until=is_answered, limit=TURN_LIMIT)
async def coding(agent: Agent, state: State) -> None:
    await tidy_if_full(agent, state)
    await athink_fitting(agent, state)
    if state.pending_calls:
        await agent.ause_tools(state)
