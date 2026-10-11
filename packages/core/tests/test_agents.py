import json

import pytest

from alpine_core import BUILTIN, LOOKS, AgentConfig, AgentList, ProjectList, free_character
from alpine_core.agents import COLORS


@pytest.fixture
def agents(home):
    return AgentList(home)


def test_the_default_agent_always_exists_comes_first_and_stays(agents):
    assert [a.id for a in agents.list()] == ["default"]
    assert agents.default() == AgentConfig("default", "")
    other = agents.save(AgentConfig("", "reviewer"))
    saved = agents.save(AgentConfig("default", "Main", tools=("read",)))
    assert [a.id for a in agents.list()] == ["default", other.id]
    assert (saved.name, saved.tools) == ("Main", ("read",))
    agents.delete("default")
    assert agents.default().name == "Main"


def test_saving_a_new_agent_gives_it_an_id_and_cleans_it_up(agents):
    saved = agents.save(
        AgentConfig("", "  Site  ", "  builds  ", tools=("read", "bash", "read"), look="nope", color=99)
    )
    assert saved.id and agents.get(saved.id) == saved
    assert (saved.name, saved.description, saved.tools) == ("Site", "builds", ("read", "bash"))
    assert (saved.look, saved.color) == ("antenna", 1)  # nothing took that pair yet: the default has (antenna, 2)
    assert agents.save(AgentConfig("", "x")).id != saved.id


def test_a_taken_character_is_replaced_by_a_free_one(agents):
    first = agents.save(AgentConfig("", "a", look="hardhat", color=1))
    second = agents.save(AgentConfig("", "b", look="hardhat", color=1))
    assert (first.look, first.color) == ("hardhat", 1)
    assert (second.look, second.color) == ("hardhat", 2)
    default = agents.default()
    third = agents.save(AgentConfig("", "c", look=default.look, color=default.color))
    assert (third.look, third.color) == ("antenna", 3)


def test_an_edit_may_keep_its_own_character(agents):
    saved = agents.save(AgentConfig("", "a", look="beret", color=4))
    again = agents.save(AgentConfig(saved.id, "renamed", look="beret", color=4))
    assert (again.look, again.color) == ("beret", 4) and agents.get(saved.id).name == "renamed"


def test_an_unknown_id_is_appended_with_that_id(agents):
    agents.save(AgentConfig("fixed", "kept"))
    assert [a.id for a in agents.list()] == ["default", "fixed"]


def test_delete_removes_an_agent(agents):
    saved = agents.save(AgentConfig("", "a"))
    agents.delete(saved.id)
    assert agents.get(saved.id) is None


def test_free_character_searches_colours_then_looks():
    assert free_character(set()) == ("antenna", 1)
    assert free_character({("antenna", 1)}, "antenna", 1) == ("antenna", 2)
    assert free_character({("hardhat", 8)}, "hardhat", 8) == ("hardhat", 1)
    every_colour = {("antenna", c) for c in COLORS}
    assert free_character(every_colour, "antenna", 3) == ("hardhat", 3)
    assert free_character({("grad", c) for c in COLORS}, "grad", 5) == ("antenna", 5)
    everything = {(look, c) for look in LOOKS for c in COLORS}
    assert free_character(everything, "chef", 4) == ("chef", 4)


def test_enable_and_forget_tools(agents):
    saved = agents.save(AgentConfig("", "a", tools=("read",)))
    agents.enable(saved.id, "shout")
    agents.enable(saved.id, "shout")
    assert agents.get(saved.id).tools == ("read", "shout")
    agents.enable("missing", "shout")
    agents.forget_tools({"shout", "read"})
    assert agents.get(saved.id).tools == ()
    assert agents.default().tools == tuple(t for t in BUILTIN if t != "read")


def test_a_corrupt_file_gives_the_default(home):
    home.mkdir(parents=True)
    (home / "agents.json").write_text("{not json")
    assert AgentList(home).list() == [AgentConfig("default", "")]


def test_the_file_is_plain_json(agents, home):
    agents.save(AgentConfig("", "글쓴이", instructions="쉬운 말로", model="a/b", look="beret", color=4))
    data = json.loads((home / "agents.json").read_text("utf-8"))
    written = data["agents"][1]
    assert written | {"id": "x"} == {
        "id": "x",
        "name": "글쓴이",
        "description": "",
        "model": "a/b",
        "instructions": "쉬운 말로",
        "tools": list(BUILTIN),
        "look": "beret",
        "color": 4,
    }
    assert "글쓴이" in (home / "agents.json").read_text("utf-8")


# ------------------------------------------------------------ profiles become agents


def write_profiles(home, profiles):
    home.mkdir(parents=True, exist_ok=True)
    (home / "profiles.json").write_text(json.dumps({"profiles": profiles}), "utf-8")


def test_profiles_become_agents(home, tmp_path):
    shop, other = tmp_path / "shop", tmp_path / "other"
    shop.mkdir()
    other.mkdir()
    projects = ProjectList(home / "projects.json")
    projects.open(shop)
    projects.open(other)
    write_profiles(
        home,
        [
            {"id": "default", "name": "", "project": None, "model": None, "tools": ["read", "bash"]},
            {"id": "p1", "name": "shop", "project": str(shop), "model": None, "tools": ["read"]},
            {"id": "p2", "name": "light", "project": None, "model": "x/small", "tools": ["read", "grep"]},
            {"id": "p3", "name": "shop-light", "project": str(shop), "model": "x/small", "tools": ["grep"]},
            {"id": "p4", "name": "other-light", "project": str(other), "model": "x/small", "tools": []},
        ],
    )
    agents = AgentList(home)
    listed = agents.list()
    assert [(a.id, a.name, a.model, a.tools) for a in listed] == [
        ("default", "", None, ("read", "bash")),
        ("p1", "shop", None, ("read",)),
        ("p2", "light", "x/small", ("read", "grep")),
        ("p3", "shop-light", "x/small", ("grep",)),
        ("p4", "other-light", "x/small", ()),
    ]
    assert (listed[0].look, listed[0].color) == ("antenna", 2)
    assert len({(a.look, a.color) for a in listed}) == 5
    assert (listed[1].look, listed[1].color) == ("antenna", 1)  # the first other agent: LOOKS[0], colour 1
    assert (home / "agents.json").is_file() and (home / "profiles.json").is_file()
    assert projects.get(shop).last_agent == "p1"  # the project-only profile wins over the one with a model
    assert projects.get(other).last_agent == "p4"


def test_the_migration_runs_once(home):
    write_profiles(home, [{"id": "p1", "name": "a", "tools": ["read"]}])
    assert [a.id for a in AgentList(home).list()] == ["default", "p1"]
    write_profiles(home, [{"id": "p2", "name": "b"}])
    assert [a.id for a in AgentList(home).list()] == ["default", "p1"]


def test_no_migration_when_agents_exist(home):
    agents = AgentList(home)
    agents.save(AgentConfig("", "mine"))
    write_profiles(home, [{"id": "p1", "name": "old"}])
    assert [a.name for a in AgentList(home).list()] == ["", "mine"]


def test_garbage_profiles_give_the_default(home):
    home.mkdir(parents=True)
    (home / "profiles.json").write_text("[1, 2")
    assert AgentList(home).list() == [AgentConfig("default", "")]


def test_separate_instances_on_one_file_do_not_lose_updates(home):
    from concurrent.futures import ThreadPoolExecutor

    def work(n):
        mine = AgentList(home)
        for i in range(15):
            mine.save(AgentConfig("", f"a{n}-{i}"))

    with ThreadPoolExecutor(4) as pool:
        list(pool.map(work, range(4)))
    assert len(AgentList(home).list()) == 61
    assert [p.name for p in home.iterdir() if p.name.endswith(".tmp")] == []


@pytest.mark.parametrize(
    "content",
    [
        "null",
        "[]",
        '{"agents": null}',
        '{"agents": 5}',
        '{"agents": [{"id": "a", "tools": null, "look": "robot", "color": "3"}]}',
        '{"agents": [{"id": "a", "look": "glasses", "color": 99, "model": 4}]}',
    ],
)
def test_wrongly_shaped_files_still_give_usable_agents(home, content):
    home.mkdir(parents=True, exist_ok=True)
    (home / "agents.json").write_text(content)
    listed = AgentList(home).list()
    assert listed[0].is_default
    for a in listed:
        assert a.look in LOOKS and a.color in COLORS and isinstance(a.tools, tuple)
        assert a.model is None or isinstance(a.model, str)


@pytest.mark.parametrize(
    "content", ["null", '{"profiles": null}', '{"profiles": 5}', '{"profiles": [{"id": "p", "tools": null}]}']
)
def test_wrongly_shaped_profiles_do_not_break_the_migration(home, content):
    home.mkdir(parents=True, exist_ok=True)
    (home / "profiles.json").write_text(content)
    listed = AgentList(home).list()
    assert listed[0].is_default
    assert all(isinstance(a.tools, tuple) for a in listed)
