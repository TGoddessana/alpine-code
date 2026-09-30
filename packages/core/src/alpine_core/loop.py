"""The agent loop: compact when full, ask the model, run the tools. Permissions decide inside ``ause_tools``."""

from __future__ import annotations

from alpineagents import Agent, State, acompact_if_full, loop

#: Most model turns in one ``Session.asend``.
TURN_LIMIT = 200


@loop(until=State.is_answered, limit=TURN_LIMIT)
async def coding(agent: Agent, state: State) -> None:
    await acompact_if_full(agent, state)
    await agent.athink(state)
    if state.wants_tools():
        await agent.ause_tools(state)
