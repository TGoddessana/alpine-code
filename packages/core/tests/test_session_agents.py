"""Session with agents: the agent's tools, instructions and model, switching, and edits applied between turns."""

import dataclasses
import json

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import (
    AgentChanged,
    AgentConfig,
    AgentList,
    AgentMessage,
    AgentSwitched,
    Builtins,
    InfoChanged,
    ProjectList,
    Session,
    Settings,
    Toolbox,
    UserMessage,
    Workspace,
    file_storage,
)
from alpine_core import session as session_module

SHOUT = '''
from alpineagents import tool


@tool(read_only=True, open_world=False)
def shout(text: str, times: int = 1) -> str:
    """Says the text loudly.

    Args:
        text: What to say
        times: How many times
    """
    return " ".join([text.upper()] * times)
'''


class _NoApprover:
    def approve(self, request):
        raise AssertionError(f"asked for {request}")


class Models:
    """``make_model`` for tests: remembers the model names asked for and serves the next batch of replies."""

    def __init__(self, monkeypatch, *batches):
        self.names: list[str | None] = []
        self.batches = list(batches) or [["ok"] * 5]
        monkeypatch.setattr(session_module, "make_model", self)

    def __call__(self, settings):
        self.names.append(settings.model)
        return FakeModel(self.batches.pop(0) if len(self.batches) > 1 else list(self.batches[0]))


@pytest.fixture
def agents(home):
    return AgentList(home)


def tools_of(session):
    return sorted(session._agent.tool_map)


def kinds(session):
    return [i.kind for i in session.snapshot().items]


def with_box(home):
    """Tool sources with the user's tools: the built-ins, then the toolbox's."""
    return lambda folder: [Builtins(Workspace(folder)), Toolbox(home)]


def make(tmp_path, agents, **kwargs):
    return Session(Settings(model="x/default"), approver=_NoApprover(), cwd=tmp_path, agents=agents, **kwargs)


def test_a_new_session_takes_the_agents_tools_instructions_and_model(home, tmp_path, monkeypatch, agents):
    Toolbox(home).save("shout", SHOUT)
    reviewer = agents.save(
        AgentConfig("", "reviewer", tools=("read", "shout"), instructions="Only comment.", model="x/small")
    )
    models = Models(monkeypatch)
    session = make(tmp_path, agents, tools=with_box(home), agent=reviewer.id)
    assert tools_of(session) == ["read", "shout"]
    assert "# Instructions for this agent\nThe role and way of working the user gave this agent.\n\nOnly comment." in (
        session._agent.system
    )
    assert models.names == ["x/small"] and session.model_name == "x/small"
    assert session.agent_id == reviewer.id and session.info.agent == reviewer.id
    assert session.info.agent_applied == {
        "model": "x/small",
        "instructions": "Only comment.",
        "tools": ["read", "shout"],
    }


def test_the_agent_without_a_model_uses_the_default_model(tmp_path, monkeypatch, agents):
    models = Models(monkeypatch)
    session = make(tmp_path, agents)
    assert session.agent_id == "default" and models.names == ["x/default"]
    assert "Instructions for this agent" not in session._agent.system
    assert tools_of(session)[:2] == ["bash", "edit"]


def test_an_explicit_model_beats_the_agents(tmp_path, monkeypatch, agents):
    reviewer = agents.save(AgentConfig("", "reviewer", model="x/small"))
    models = Models(monkeypatch)
    session = make(tmp_path, agents, agent=reviewer.id, model="x/big")
    assert models.names == ["x/big"] and session.model_name == "x/big"


def test_a_session_without_agents_has_the_builtin_tools_and_no_agent(tmp_path, monkeypatch):
    Models(monkeypatch)
    session = Session(Settings(model="fake"), approver=_NoApprover(), cwd=tmp_path)
    assert session.agent_id is None and session.info.agent is None and session.info.agent_applied is None
    assert tools_of(session) == ["bash", "edit", "glob", "grep", "read", "write"]
    with pytest.raises(LookupError):
        session.set_agent("default")


def test_without_an_agent_the_projects_last_one_starts(tmp_path, monkeypatch, agents):
    reviewer = agents.save(AgentConfig("", "reviewer", tools=("read",)))
    writer = agents.save(AgentConfig("", "writer", tools=("write",)))
    projects = ProjectList(tmp_path / "projects.json")
    projects.open(tmp_path)
    projects.set_agent(tmp_path, reviewer.id)
    Models(monkeypatch)
    assert make(tmp_path, agents, projects=projects).agent_id == reviewer.id
    assert make(tmp_path, agents, projects=projects, agent=writer.id).agent_id == writer.id
    projects.set_agent(tmp_path, "gone")
    assert make(tmp_path, agents, projects=projects).agent_id == "default"
    assert make(tmp_path, agents, projects=projects, agent="gone too").agent_id == "default"


def test_the_first_message_records_the_agent_for_the_project(tmp_path, monkeypatch, agents):
    reviewer = agents.save(AgentConfig("", "reviewer"))
    projects = ProjectList(tmp_path / "projects.json")
    Models(monkeypatch)
    session = make(tmp_path, agents, projects=projects, agent=reviewer.id)
    assert projects.get(tmp_path) is None
    session.send("hello")
    assert projects.get(tmp_path).last_agent == reviewer.id


def test_replies_carry_the_agent(tmp_path, monkeypatch, agents):
    reviewer = agents.save(AgentConfig("", "reviewer"))
    Models(monkeypatch, ["first"], ["second"])
    session = make(tmp_path, agents, agent=reviewer.id)
    session.send("hello")
    session.set_agent("default")
    session.send("again")
    replies = [i for i in session.snapshot().items if isinstance(i, AgentMessage)]
    assert [(r.text, r.agent) for r in replies] == [("first", reviewer.id), ("second", "default")]


def test_set_agent_keeps_the_conversation_and_announces_the_switch(home, tmp_path, monkeypatch, agents):
    Toolbox(home).save("shout", SHOUT)
    reviewer = agents.save(
        AgentConfig("", "reviewer", tools=("read", "shout"), model="x/small", look="glasses", color=3)
    )
    projects = ProjectList(tmp_path / "projects.json")
    models = Models(monkeypatch, ["one"], ["two"])
    announced = []
    session = make(
        tmp_path,
        agents,
        projects=projects,
        tools=with_box(home),
        on_item_event=lambda sid, seq, e: announced.append(e),
    )
    session.send("hello")
    count = session._state.messages.__len__()
    session.set_agent(reviewer.id)
    assert len(session._state.messages) == count and session.has_conversation
    assert tools_of(session) == ["read", "shout"] and models.names == ["x/default", "x/small"]
    assert session.model_name == "x/small" and session.info.agent == reviewer.id
    divider = session.snapshot().items[-1]
    assert divider == AgentSwitched(divider.id, reviewer.id, "reviewer", "glasses", 3)
    assert projects.get(tmp_path).last_agent == reviewer.id
    assert [e.info.agent for e in announced if isinstance(e, InfoChanged)][-1] == reviewer.id
    session.set_agent(reviewer.id)  # the same agent: nothing
    assert kinds(session).count("agent_switched") == 1
    assert session.send("again") == "two"
    with pytest.raises(LookupError):
        session.set_agent("missing")
    assert session.agent_id == reviewer.id


def test_switching_before_the_first_message_adds_no_divider(tmp_path, monkeypatch, agents):
    reviewer = agents.save(AgentConfig("", "reviewer", tools=("read",)))
    Models(monkeypatch)
    session = make(tmp_path, agents)
    session.set_agent(reviewer.id)
    assert tools_of(session) == ["read"] and kinds(session) == []


def test_a_model_that_cannot_be_made_keeps_the_agent(tmp_path, monkeypatch, agents):
    broken = agents.save(AgentConfig("", "broken", model="x/broken"))
    from alpine_core import ConfigError

    def make_model(settings):
        if settings.model == "x/broken":
            raise ConfigError("no such model")
        return FakeModel(["ok"])

    monkeypatch.setattr(session_module, "make_model", make_model)
    session = make(tmp_path, agents)
    with pytest.raises(ConfigError):
        session.set_agent(broken.id)
    assert session.agent_id == "default" and session.model_name == "x/default"


def test_an_edit_applies_at_the_next_message_ahead_of_it(home, tmp_path, monkeypatch, agents):
    Toolbox(home).save("shout", SHOUT)
    site = agents.save(AgentConfig("", "site", tools=("read", "bash"), instructions="Build."))
    models = Models(monkeypatch, ["one"], [tool_call("shout", text="hi"), "done", "more"])
    session = make(tmp_path, agents, tools=with_box(home), agent=site.id)
    session.send("hello")
    assert tools_of(session) == ["bash", "read"]
    agents.save(dataclasses.replace(site, tools=("read", "shout"), instructions="Review.", model="x/new"))
    assert tools_of(session) == ["bash", "read"]  # nothing happens until the next message
    assert session.send("go on") == "done"
    items = session.snapshot().items
    assert [i.kind for i in items[:4]] == ["user_message", "agent_message", "agent_changed", "user_message"]
    changed = items[2]
    assert changed == AgentChanged(
        changed.id, site.id, "site", site.look, site.color, ["shout"], ["bash"], True, "x/new"
    )
    assert models.names == ["x/default", "x/new"] and session.model_name == "x/new"
    assert "Review." in session._agent.system and "Build." not in session._agent.system
    assert [i.name for i in items if i.kind == "tool_call"] == ["shout"]
    assert session.info.agent_applied == {"model": "x/new", "instructions": "Review.", "tools": ["read", "shout"]}
    session.send("and again")
    assert kinds(session).count("agent_changed") == 1


def test_an_edit_to_the_name_alone_adds_nothing(tmp_path, monkeypatch, agents):
    site = agents.save(AgentConfig("", "site", description="old"))
    models = Models(monkeypatch)
    session = make(tmp_path, agents, agent=site.id)
    session.send("hello")
    agent_before = session._agent
    agents.save(dataclasses.replace(site, name="homepage", description="new", look="chef", color=5))
    session.send("go on")
    assert kinds(session) == ["user_message", "agent_message", "user_message", "agent_message"]
    assert session._agent is agent_before and models.names == ["x/default"]


def test_an_edit_before_the_first_message_adds_no_item(tmp_path, monkeypatch, agents):
    site = agents.save(AgentConfig("", "site", tools=("read", "bash")))
    Models(monkeypatch)
    session = make(tmp_path, agents, agent=site.id)
    agents.save(dataclasses.replace(site, tools=("read",)))
    session.send("hello")
    assert tools_of(session) == ["read"] and "agent_changed" not in kinds(session)


def test_a_model_that_cannot_be_made_still_gets_the_new_tools(tmp_path, monkeypatch, agents):
    from alpine_core import ConfigError

    site = agents.save(AgentConfig("", "site", tools=("read", "bash")))

    def make_model(settings):
        if settings.model == "x/broken":
            raise ConfigError("no such model")
        return FakeModel(["ok"])

    monkeypatch.setattr(session_module, "make_model", make_model)
    session = make(tmp_path, agents, agent=site.id)
    session.send("hello")
    agents.save(dataclasses.replace(site, tools=("read",), model="x/broken"))
    session.send("go on")
    changed = [i for i in session.snapshot().items if isinstance(i, AgentChanged)]
    assert [(c.removed, c.model) for c in changed] == [(["bash"], None)]
    assert tools_of(session) == ["read"] and session.model_name == "x/default"


def test_deleting_the_agent_switches_to_the_default(tmp_path, monkeypatch, agents):
    site = agents.save(AgentConfig("", "site", tools=("read",)))
    Models(monkeypatch)
    session = make(tmp_path, agents, agent=site.id)
    session.send("hello")
    agents.delete(site.id)
    session.send("go on")
    assert kinds(session) == ["user_message", "agent_message", "agent_switched", "user_message", "agent_message"]
    assert session.snapshot().items[2].agent == "default" and session.agent_id == "default"
    assert "bash" in tools_of(session)


def test_a_clear_takes_the_edits_without_a_divider(tmp_path, monkeypatch, agents):
    site = agents.save(AgentConfig("", "site", tools=("read", "bash")))
    Models(monkeypatch)
    session = make(tmp_path, agents, agent=site.id)
    session.send("hello")
    agents.save(dataclasses.replace(site, tools=("read",)))
    session.clear()
    assert tools_of(session) == ["read"] and kinds(session) == []


def test_a_saved_session_keeps_its_agent_and_sees_edits_made_while_closed(home, tmp_path, monkeypatch, agents):
    site = agents.save(AgentConfig("", "site", tools=("read", "bash"), instructions="Build."))
    storage = file_storage()
    Models(monkeypatch, ["one"], ["two"])
    session = make(tmp_path, agents, agent=site.id, storage=storage)
    session.send("hello")
    agents.save(dataclasses.replace(site, tools=("read", "bash", "grep"), instructions="Review."))
    resumed = Session.resume(storage, session.id, Settings(model="other"), approver=_NoApprover(), agents=agents)
    assert resumed.agent_id == site.id
    assert tools_of(resumed) == ["bash", "read"] and "Build." in resumed._agent.system  # as it was applied
    assert resumed.send("go on") == "two"
    changed = [i for i in resumed.snapshot().items if isinstance(i, AgentChanged)]
    assert [(c.added, c.removed, c.instructions) for c in changed] == [(["grep"], [], True)]
    assert kinds(resumed)[-3:] == ["agent_changed", "user_message", "agent_message"]
    assert tools_of(resumed) == ["bash", "grep", "read"]
    again = Session.resume(storage, session.id, Settings(model="other"), approver=_NoApprover(), agents=agents)
    assert again.snapshot().items == resumed.snapshot().items and "Review." in again._agent.system


def test_a_deleted_agent_of_a_saved_session_opens_with_the_default(home, tmp_path, monkeypatch, agents):
    site = agents.save(AgentConfig("", "site", tools=("read",)))
    storage = file_storage()
    Models(monkeypatch)
    session = make(tmp_path, agents, agent=site.id, storage=storage)
    session.send("hello")
    agents.delete(site.id)
    resumed = Session.resume(storage, session.id, Settings(model="other"), approver=_NoApprover(), agents=agents)
    assert resumed.send("go on") == "ok"
    assert resumed.agent_id == "default" and "bash" in tools_of(resumed)
    assert [k for k in kinds(resumed) if k.startswith("agent_") and k != "agent_message"] == ["agent_switched"]


def test_a_session_saved_with_a_profile_id_opens_with_that_agent(home, tmp_path, monkeypatch, agents):
    old = agents.save(AgentConfig("p1", "old profile", tools=("read",)))
    storage = file_storage()
    Models(monkeypatch)
    session = make(tmp_path, agents, storage=storage)
    session.send("hello")
    file = home / "sessions" / session.id / "info.json"
    data = json.loads(file.read_text("utf-8"))
    del data["agent"], data["agent_applied"]
    data["profile"] = old.id
    file.write_text(json.dumps(data), "utf-8")
    resumed = Session.resume(storage, session.id, Settings(model="other"), approver=_NoApprover(), agents=agents)
    assert resumed.agent_id == "p1" and tools_of(resumed) == ["read"]
    assert not any(isinstance(i, AgentChanged) for i in resumed.snapshot().items)
    assert isinstance(resumed.snapshot().items[0], UserMessage)


def test_a_model_edit_that_fails_is_tried_again_and_leaves_no_empty_divider(tmp_path, monkeypatch, agents):
    from alpine_core import ConfigError

    site = agents.save(AgentConfig("", "site", tools=("read",)))
    broken = {"on": True}

    def make_model(settings):
        if settings.model == "x/later" and broken["on"]:
            raise ConfigError("no such model")
        return FakeModel(["ok"] * 5)

    monkeypatch.setattr(session_module, "make_model", make_model)
    session = make(tmp_path, agents, agent=site.id)
    session.send("hello")
    agents.save(dataclasses.replace(site, model="x/later"))
    session.send("two")
    assert [i for i in session.snapshot().items if isinstance(i, AgentChanged)] == []
    assert session.model_name == "x/default"
    broken["on"] = False
    session.send("three")
    changed = [i for i in session.snapshot().items if isinstance(i, AgentChanged)]
    assert [c.model for c in changed] == ["x/later"] and session.model_name == "x/later"


def test_the_first_session_after_the_upgrade_starts_with_the_migrated_project_agent(home, tmp_path, monkeypatch):
    home.mkdir(parents=True, exist_ok=True)
    (home / "profiles.json").write_text(
        json.dumps({"profiles": [{"id": "p1", "name": "old", "project": str(tmp_path.resolve()), "tools": ["read"]}]})
    )
    Models(monkeypatch)
    projects = ProjectList(home / "projects.json")
    projects.open(tmp_path)
    session = Session(
        Settings(model="x/default"), approver=_NoApprover(), cwd=tmp_path, agents=AgentList(home), projects=projects
    )
    assert session.agent_id == "p1"


def test_every_agent_has_the_memory_tools_and_naming_them_changes_nothing(home, tmp_path, monkeypatch, agents):
    from alpine_core import Memories

    memories = Memories(home)
    site = agents.save(AgentConfig("", "site", tools=("read",)))
    Models(monkeypatch)
    session = make(
        tmp_path,
        agents,
        agent=site.id,
        tools=lambda folder: [Builtins(Workspace(folder)), memories.of(folder)],
        memories=memories,
    )
    assert tools_of(session) == ["propose_memory", "read"]
    session.send("hello")
    agents.save(dataclasses.replace(site, tools=("read", "propose_memory")))
    session.send("go on")
    agents.save(dataclasses.replace(site, tools=("read",)))
    session.send("and again")
    assert "agent_changed" not in kinds(session)
    assert tools_of(session) == ["propose_memory", "read"]
