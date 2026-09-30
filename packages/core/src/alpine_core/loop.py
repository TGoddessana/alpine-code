"""The agent loop: compact when full, ask the model, run the tools. Permissions decide inside ``use_tools``."""

from __future__ import annotations

from alpineagents import Agent, State, compact_if_full, loop

#: Most model turns in one ``Session.send``.
TURN_LIMIT = 200


@loop(until=State.is_answered, limit=TURN_LIMIT)
def coding(agent: Agent, state: State) -> None:
    compact_if_full(agent, state)
    agent.think(state)
    if state.wants_tools():
        agent.use_tools(state)
