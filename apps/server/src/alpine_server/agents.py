"""The ``agents/*`` methods: the agents a session can work as."""

from __future__ import annotations

from alpine_core import AgentConfig, AgentList, home_dir
from alpine_protocol import (
    AgentInfo,
    AgentsDeleteParams,
    AgentsDeleteResult,
    AgentsListParams,
    AgentsListResult,
    AgentsSaveParams,
    AgentsSaveResult,
)


def agents() -> AgentList:
    return AgentList(home_dir())


def list_agents(params: AgentsListParams) -> AgentsListResult:
    return AgentsListResult(agents=[_agent_info(a) for a in agents().list()])


def save_agent(params: AgentsSaveParams) -> AgentsSaveResult:
    info = params.agent
    saved = agents().save(
        AgentConfig(
            id=info.id,
            name=info.name,
            description=info.description,
            model=info.model,
            instructions=info.instructions,
            tools=tuple(info.tools),
            look=info.look,
            color=info.color,
        )
    )
    return AgentsSaveResult(agent=_agent_info(saved))


def delete_agent(params: AgentsDeleteParams) -> AgentsDeleteResult:
    agents().delete(params.id)
    return AgentsDeleteResult()


def _agent_info(agent: AgentConfig) -> AgentInfo:
    return AgentInfo(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        model=agent.model,
        instructions=agent.instructions,
        tools=list(agent.tools),
        look=agent.look,  # type: ignore[arg-type]
        color=agent.color,
    )


HANDLERS = {
    "agents/list": list_agents,
    "agents/save": save_agent,
    "agents/delete": delete_agent,
}
