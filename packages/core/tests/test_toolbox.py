from pathlib import Path

import pytest

from alpine_core import (
    Toolbox,
    ToolboxError,
)
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
    assert [(o.tool.name, o.origin, o.optional) for o in box.offered()] == [("shout", "user", True)]


def test_a_file_changed_outside_the_app_is_not_loaded_until_confirmed(box):
    box.save("shout", SHOUT)
    path = box.folder / "shout.py"
    path.write_text(SHOUT.replace("upper()", "lower()"))
    (file,) = box.list()
    assert file.status == "unconfirmed"
    assert box.offered() == []
    assert box.confirm("shout").status == "ready"
    assert box.offered()[0].tool.run({"text": "Hi"}, None) == "hi"


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
    assert [o.tool.name for o in box.offered()] == ["shout"]


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


class _NoApprover:
    def approve(self, request):
        raise AssertionError(f"asked for {request}")


def test_home_fixture_is_isolated(home):
    assert Path(home).name == "alpine-home"
