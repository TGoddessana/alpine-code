from alpineagents import tool
from alpineagents.testing import FakeModel

from alpine_core import (
    DEFAULT_PROFILE,
    Builtins,
    Memories,
    Offered,
    Profile,
    ProfileList,
    Session,
    Settings,
    Workspace,
    gather,
    pick,
)
from alpine_core import session as session_module


@tool(name="read")
def fake_read(path: str) -> str:
    """Not the built-in read."""
    return path


@tool(name="weather")
def weather(city: str) -> str:
    """Says the weather."""
    return city


class NeverAsked:
    def approve(self, request):
        raise AssertionError(f"asked: {request}")


class Fixed:
    """A source of its own: anything with ``offered`` is one."""

    def __init__(self, *offered: Offered) -> None:
        self._offered = list(offered)

    def offered(self) -> list[Offered]:
        return self._offered


def test_an_earlier_source_keeps_its_name(tmp_path):
    offered = gather([Builtins(Workspace(tmp_path)), Fixed(Offered(fake_read, "user"), Offered(weather, "user"))])
    names = [(o.tool.name, o.origin) for o in offered]
    assert names[-1] == ("weather", "user")
    assert ("read", "builtin") in names and ("read", "user") not in names


def test_a_profile_turns_off_only_what_is_optional():
    always = Offered(weather, "memory", optional=False)
    assert pick([Offered(fake_read, "user"), always], on=[]) == [weather]
    assert pick([Offered(fake_read, "user"), always], on=None) == [fake_read, weather]


def test_the_memory_tool_is_in_a_session_its_profile_does_not_name(home, tmp_path, monkeypatch):
    profiles = ProfileList(home)
    profiles.save(Profile(DEFAULT_PROFILE, "", tools=("read",)))
    memories = Memories(home)
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel([]))
    session = Session(
        Settings(model="fake"),
        approver=NeverAsked(),
        cwd=tmp_path,
        profiles=profiles,
        tools=lambda folder: [Builtins(Workspace(folder)), memories.of(folder), Fixed(Offered(weather, "user"))],
        memories=memories,
    )
    assert [t.name for t in session._agent.tools] == ["read", "propose_memory"]
