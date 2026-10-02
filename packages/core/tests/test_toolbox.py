from pathlib import Path

import pytest
from alpineagents.testing import FakeModel, tool_call
from alpineagents.tool import collect_tools

from alpine_core import (
    DEFAULT_PROFILE,
    Profile,
    ProfileConflict,
    ProfileList,
    Session,
    Settings,
    Toolbox,
    ToolboxError,
    ToolFinished,
)
from alpine_core import session as session_module
from alpine_core import toolbox as toolbox_module
from alpine_core.toolbox import dependencies, extract_code

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


@pytest.fixture
def box(home):
    return Toolbox(home)


def test_save_loads_the_tools_as_the_model_sees_them(box):
    file = box.save("shout", SHOUT)
    assert file.status == "ready"
    (tool,) = file.tools
    assert tool.name == "shout"
    assert tool.description == "Says the text loudly."
    assert [(p.name, p.type, p.required, p.default) for p in tool.params] == [
        ("text", "string", True, None),
        ("times", "integer", False, 1),
    ]
    assert tool.ask == "never"
    assert [t.name for t in box.load(["shout"])] == ["shout"]


def test_a_file_changed_outside_the_app_is_not_loaded_until_confirmed(box):
    box.save("shout", SHOUT)
    path = box.folder / "shout.py"
    path.write_text(SHOUT.replace("upper()", "lower()"))
    (file,) = box.list()
    assert file.status == "unconfirmed"
    assert box.load(["shout"]) == []
    assert box.confirm("shout").status == "ready"
    assert box.load(["shout"])[0].run({"text": "Hi"}, None) == "hi"


def test_a_new_file_nobody_saved_is_unconfirmed(box):
    box.folder.mkdir(parents=True)
    (box.folder / "shout.py").write_text(SHOUT)
    assert box.list()[0].status == "unconfirmed"


def test_errors_stay_in_their_file(box):
    box.save("shout", SHOUT)
    broken = box.save("broken", "def oops(:\n")
    assert broken.status == "error"
    assert broken.error.startswith("Line 1:")
    crashing = box.save("crashing", "raise SystemExit(1)\n")
    assert crashing.status == "error" and "SystemExit" in crashing.error
    assert [t.name for t in box.load(["shout", "oops"])] == ["shout"]


def test_a_missing_package_is_named(box):
    file = box.save("needs", "import surely_not_installed_pkg\n")
    assert file.status == "error"
    assert file.missing_package == "surely_not_installed_pkg"


def test_tool_names_may_not_repeat(box):
    box.save("shout", SHOUT)
    with pytest.raises(ToolboxError) as e:
        box.save("again", SHOUT)
    assert e.value.reason == "name_taken"
    builtin = box.save("mine", SHOUT.replace("def shout", "def read"))
    assert builtin.status == "error" and "read" in builtin.error


def test_unreviewed_packages_need_approval(box, monkeypatch):
    monkeypatch.setattr(toolbox_module, "package_info", lambda name: toolbox_module.PackageInfo(name))
    source = '# /// script\n# dependencies = ["trafilatura>=1"]\n# ///\n' + SHOUT
    check = box.check(source)
    assert [p.name for p in check.needs_approval] == ["trafilatura"]
    assert check.tools == ()
    with pytest.raises(ToolboxError) as e:
        box.save("shout", source)
    assert e.value.reason == "package_not_approved"


def test_reviewed_packages_already_there_need_nothing(box):
    source = '# /// script\n# dependencies = ["pydantic"]\n# ///\n' + SHOUT
    check = box.check(source)
    assert check.needs_approval == () and check.packages == ("pydantic",)
    assert [t.name for t in check.tools] == ["shout"]


def test_dependencies_follow_pep_723():
    source = (
        '# /// script\n# requires-python = ">=3.11"\n'
        '# dependencies = [\n#   "Beautiful_Soup4>=4",\n#   "httpx",\n# ]\n# ///\n'
    )
    assert dependencies(source) == ("beautiful-soup4", "httpx")
    assert dependencies("import httpx\n") == ()


def test_test_runs_a_tool_once(box):
    result = box.test(SHOUT, "shout", {"text": "hi", "times": 2})
    assert result.ok and result.output == "HI HI"
    failed = box.test(SHOUT, "shout", {"times": "x"})
    assert not failed.ok


def test_delete_removes_file_and_record(box):
    box.save("shout", SHOUT)
    box.delete("shout")
    assert box.list() == []


def test_extract_code():
    assert extract_code("Here:\n```python\nx = 1\n```\n") == "x = 1\n"


# ------------------------------------------------------------ profiles


def test_the_most_specific_profile_wins(home, tmp_path):
    profiles = ProfileList(home)
    project = tmp_path / "shop"
    project.mkdir()
    by_model = profiles.save(Profile("", "light", model="local/motif"))
    by_project = profiles.save(Profile("", "shop", project=str(project)))
    both = profiles.save(Profile("", "shop-light", project=str(project), model="local/motif"))
    assert profiles.resolve(project, "local/motif").id == both.id
    assert profiles.resolve(project, "anthropic/sonnet").id == by_project.id
    assert profiles.resolve(tmp_path, "local/motif").id == by_model.id
    assert profiles.resolve(tmp_path, None).id == DEFAULT_PROFILE


def test_two_profiles_cannot_claim_the_same_place(home):
    profiles = ProfileList(home)
    profiles.save(Profile("", "a", model="x/y"))
    with pytest.raises(ProfileConflict):
        profiles.save(Profile("", "b", model="x/y"))


def test_the_default_profile_always_exists_and_applies_everywhere(home):
    profiles = ProfileList(home)
    saved = profiles.save(Profile(DEFAULT_PROFILE, "renamed", model="x/y", tools=("read",)))
    assert (saved.project, saved.model, saved.tools) == (None, None, ("read",))
    profiles.delete(DEFAULT_PROFILE)
    assert profiles.list()[0].id == DEFAULT_PROFILE


def test_a_session_gets_the_profiles_tools(home, tmp_path, monkeypatch):
    box = Toolbox(home)
    box.save("shout", SHOUT)
    profiles = ProfileList(home)
    profiles.save(Profile(DEFAULT_PROFILE, "", tools=("read", "shout")))
    replies = [tool_call("shout", text="hi"), "done"]
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    events = []
    session = Session(
        Settings(model="fake"),
        on_event=events.append,
        approver=_NoApprover(),
        cwd=tmp_path,
        profiles=profiles,
        toolbox=box,
    )
    assert session.info.profile == DEFAULT_PROFILE
    # The plan tools come with every session, whatever the profile turns on.
    assert sorted(collect_tools(session._agent.tools)) == ["check", "read", "shout", "update_plan"]
    assert session.send("shout hi") == "done"
    assert [(e.name, e.kind) for e in events if isinstance(e, ToolFinished)] == [("shout", "done")]


class _NoApprover:
    def approve(self, request):
        raise AssertionError(f"asked for {request}")


def test_home_fixture_is_isolated(home):
    assert Path(home).name == "alpine-home"
