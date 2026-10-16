import io
import json

import pytest

from alpine_server.stdio import serve


def skill_md(name: str, description: str = "Does a thing.") -> str:
    return f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n"


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("HOME", str(tmp_path / "user"))  # other apps' skills live under the user's home
    return tmp_path / "home"


def call(method: str, **params) -> dict:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    out = io.StringIO()
    serve(io.StringIO(line + "\n"), out)
    return json.loads(out.getvalue())


def folder_with(tmp_path, *names):
    root = tmp_path / "download"
    for name in names:
        (root / name).mkdir(parents=True)
        (root / name / "SKILL.md").write_text(skill_md(name))
    return root


def test_a_source_with_several_skills_asks_which_then_adds_them(tmp_path):
    root = folder_with(tmp_path, "pdf", "xlsx")
    asked = call("skills/add", source=str(root))["result"]
    assert asked["added"] == [] and [c["name"] for c in asked["choices"]] == ["pdf", "xlsx"]
    added = call("skills/add", source=str(root), names=["xlsx"])["result"]
    assert [s["name"] for s in added["added"]] == ["xlsx"] and added["added"][0]["origin"] == "alpine"
    listed = call("skills/list")["result"]["skills"]
    assert [s["name"] for s in listed] == ["xlsx"]
    again = call("skills/add", source=str(root))["result"]
    assert [c["installed"] for c in again["choices"]] == [False, True]


def test_one_skill_is_added_at_once_and_can_be_read_changed_and_removed(tmp_path):
    root = folder_with(tmp_path, "pdf")
    added = call("skills/add", source=str(root / "pdf"))["result"]["added"]
    assert [s["name"] for s in added] == ["pdf"]
    got = call("skills/get", name="pdf")["result"]
    assert got["text"].startswith("---") and got["files"] == []
    call("skills/save", name="pdf", text=skill_md("pdf", "Better."))
    assert call("skills/list")["result"]["skills"][0]["description"] == "Better."
    assert "error" not in call("skills/remove", name="pdf")
    assert call("skills/list")["result"]["skills"] == []


def test_other_apps_skills_are_listed_but_not_removed(tmp_path):
    claude = tmp_path / "user" / ".claude" / "skills" / "notes"
    claude.mkdir(parents=True)
    (claude / "SKILL.md").write_text(skill_md("notes"))
    assert [(s["name"], s["origin"]) for s in call("skills/list")["result"]["skills"]] == [("notes", "claude")]
    error = call("skills/remove", name="notes")["error"]
    assert error["data"]["reason"] == "not_owned"


def test_a_source_that_is_not_one_says_why():
    error = call("skills/add", source="please make me a skill")["error"]
    assert error["data"]["reason"] == "unknown_source"


def test_agents_keep_the_skills_they_turned_off():
    agent = {
        "id": "",
        "name": "shop",
        "description": "",
        "model": None,
        "instructions": "",
        "tools": ["read"],
        "look": "antenna",
        "color": 2,
        "skillsOff": ["pdf"],
    }
    saved = call("agents/save", agent=agent)["result"]["agent"]
    assert saved["skillsOff"] == ["pdf"]
