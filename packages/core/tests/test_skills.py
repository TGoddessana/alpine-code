"""Skills: reading SKILL.md leniently, the library, getting skills from links and files, and sessions using them."""

import io
import json
import tarfile
import zipfile

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import (
    AgentConfig,
    AgentList,
    Session,
    Settings,
    SkillError,
    SkillFetcher,
    SkillLibrary,
    UserMessage,
    parse_source,
    search_skills,
    skill_text,
)
from alpine_core import session as session_module
from alpine_core.skills import expand_command, read_skill, split_front_matter

PDF = """---
name: pdf
description: Read, fill and merge PDF files. Use when the user mentions PDFs.
license: Apache-2.0
---

# PDF

Run scripts/extract.py on the file.
"""


def write_skill(folder, text=PDF, files=()):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "SKILL.md").write_text(text, encoding="utf-8")
    for name in files:
        (folder / name).parent.mkdir(parents=True, exist_ok=True)
        (folder / name).write_text("print('hi')\n")
    return folder


# ------------------------------------------------------------ reading


def test_a_skill_is_read_from_its_front_matter_and_body(tmp_path):
    skill = read_skill(write_skill(tmp_path / "pdf", files=["scripts/extract.py"]), "alpine")
    assert skill is not None
    assert skill.name == "pdf"
    assert skill.description == "Read, fill and merge PDF files. Use when the user mentions PDFs."
    assert skill.meta == {"license": "Apache-2.0"}
    assert skill.body().startswith("# PDF")
    assert skill.files() == (["scripts/extract.py"], False)
    assert skill.has_scripts and skill.notes == ()


def test_an_unquoted_colon_is_read_as_other_apps_read_it(tmp_path):
    text = "---\nname: notes\ndescription: Use this when: the user asks for notes\n---\nBody"
    skill = read_skill(write_skill(tmp_path / "notes", text), "alpine")
    assert skill is not None and skill.description == "Use this when: the user asks for notes"


def test_a_bad_name_is_noted_but_loaded_and_no_description_is_left_out(tmp_path):
    odd = read_skill(write_skill(tmp_path / "odd", "---\nname: Odd_Name\ndescription: d\n---\n"), "alpine")
    assert odd is not None and odd.name == "Odd_Name"
    assert any("lowercase" in n for n in odd.notes) and any("folder" in n for n in odd.notes)
    assert read_skill(write_skill(tmp_path / "none", "---\nname: none\n---\nbody"), "alpine") is None
    assert read_skill(write_skill(tmp_path / "plain", "no front matter"), "alpine") is None


def test_front_matter_is_split_from_the_body():
    assert split_front_matter("---\na: 1\n---\n\nbody\n") == ("a: 1", "body")
    assert split_front_matter("just text") == (None, "just text")


# ------------------------------------------------------------ the library


def test_alpines_skills_come_first_then_other_apps_and_the_project_wins(home, tmp_path):
    claude = tmp_path / "claude-skills"
    write_skill(claude / "pdf", PDF.replace("Read, fill", "Claude's pdf"))
    write_skill(claude / "notes", "---\nname: notes\ndescription: Take notes.\n---\n")
    library = SkillLibrary(home, [(claude, "claude")])
    library.install(write_skill(tmp_path / "src" / "pdf"), "anthropics/skills/pdf")
    assert [(s.name, s.origin) for s in library.installed()] == [("pdf", "alpine"), ("notes", "claude")]
    assert library.get("pdf").source == "anthropics/skills/pdf"

    project = tmp_path / "project"
    write_skill(project / ".agents/skills/notes", "---\nname: notes\ndescription: The project's notes.\n---\n")
    by_name = {s.name: s for s in library.for_project(project)}
    assert by_name["notes"].origin == "project" and by_name["pdf"].origin == "alpine"


def test_installing_again_replaces_and_only_alpines_skills_can_be_removed(home, tmp_path):
    claude = tmp_path / "claude-skills"
    write_skill(claude / "notes", "---\nname: notes\ndescription: Take notes.\n---\n")
    library = SkillLibrary(home, [(claude, "claude")])
    library.install(write_skill(tmp_path / "a" / "pdf"), "one")
    library.install(write_skill(tmp_path / "b" / "pdf", PDF.replace("# PDF", "# PDF v2")), "two")
    pdf = library.get("pdf")
    assert pdf.source == "two" and "v2" in pdf.body()
    assert [p.name for p in library.folder.iterdir()] == ["pdf"]  # nothing left over from the swap
    library.remove("pdf")
    assert library.get("pdf") is None
    with pytest.raises(SkillError) as e:
        library.remove("notes")
    assert e.value.reason == "not_owned"
    assert (claude / "notes" / "SKILL.md").exists()


def test_a_skill_is_named_after_its_name_not_its_folder(home, tmp_path):
    library = SkillLibrary(home, [])
    skill = library.install(write_skill(tmp_path / "skill-main", PDF), None)
    assert skill.folder.name == "pdf" and skill.notes == ()


def test_writing_a_new_skill_and_changing_it(home):
    library = SkillLibrary(home, [])
    made = library.write("weekly-report", skill_text("weekly-report", "Write the weekly report.", "Steps"), new=True)
    assert made.owned and made.body() == "Steps"
    with pytest.raises(SkillError) as e:
        library.write("weekly-report", skill_text("weekly-report", "x", "y"), new=True)
    assert e.value.reason == "exists"
    with pytest.raises(SkillError) as e:
        library.write("weekly-report", "no front matter")
    assert e.value.reason == "invalid"
    with pytest.raises(SkillError) as e:
        library.write("Bad Name", skill_text("x", "x", "y"), new=True)
    assert e.value.reason == "bad_name"


# ------------------------------------------------------------ sources


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("anthropics/skills", ("github", "anthropics", "skills", "HEAD", "", "")),
        ("anthropics/skills/pdf", ("github", "anthropics", "skills", "HEAD", "", "pdf")),
        ("https://github.com/anthropics/skills", ("github", "anthropics", "skills", "HEAD", "", "")),
        (
            "https://github.com/anthropics/skills/tree/main/skills/pdf",
            ("github", "anthropics", "skills", "main", "skills/pdf", ""),
        ),
        (
            "https://github.com/anthropics/skills/blob/main/skills/pdf/SKILL.md",
            ("github", "anthropics", "skills", "main", "skills/pdf", ""),
        ),
        ("github.com/vercel-labs/agent-skills.git", ("github", "vercel-labs", "agent-skills", "HEAD", "", "")),
        ("https://skills.sh/anthropics/skills/pdf", ("github", "anthropics", "skills", "HEAD", "", "pdf")),
        (
            "npx skills add https://github.com/vercel-labs/agent-skills --skill web-design-guidelines",
            ("github", "vercel-labs", "agent-skills", "HEAD", "", "web-design-guidelines"),
        ),
        ("npx skills add anthropics/skills -s pdf", ("github", "anthropics", "skills", "HEAD", "", "pdf")),
    ],
)
def test_links_people_copy_point_at_github(text, expected):
    where = parse_source(text)
    assert (where.kind, where.owner, where.repo, where.ref, where.subdir, where.want) == expected


def test_paths_and_other_links():
    assert parse_source("~/Downloads/pdf.zip").kind == "path"
    assert parse_source("https://example.com/pdf.skill").kind == "url"
    with pytest.raises(SkillError) as e:
        parse_source("make me a pdf skill")
    assert e.value.reason == "unknown_source"


def _tarball(files: dict[str, str], top="skills-HEAD") -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name, text in files.items():
            data = text.encode()
            info = tarfile.TarInfo(f"{top}/{name}")
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class Web:
    def __init__(self, pages):
        self.pages = pages
        self.asked: list[str] = []

    def __call__(self, url):
        self.asked.append(url)
        if url not in self.pages:
            raise SkillError("nothing", "not_found")
        return self.pages[url]


REPO = {
    "skills/.curated/pdf/SKILL.md": PDF,
    "skills/.curated/pdf/scripts/extract.py": "print(1)",
    "skills/xlsx/SKILL.md": "---\nname: xlsx\ndescription: Spreadsheets.\n---\n",
    "README.md": "# repo",
}
CODELOAD = "https://codeload.github.com/anthropics/skills/tar.gz/HEAD"


def test_a_repository_gives_all_its_skills_and_is_downloaded_once(home):
    web = Web({CODELOAD: _tarball(REPO)})
    fetcher = SkillFetcher(web)
    found = fetcher.find("https://github.com/anthropics/skills")
    assert [s.name for s in found.skills] == ["pdf", "xlsx"]
    picked = fetcher.find("anthropics/skills/pdf")
    assert [s.name for s in picked.skills] == ["pdf"] and picked.source == "anthropics/skills/pdf"
    assert web.asked == [CODELOAD]
    skill = SkillLibrary(home, []).install(picked.skills[0].folder, picked.source)
    assert skill.files() == (["scripts/extract.py"], False)
    fetcher.close()


def test_a_folder_link_and_a_name_that_is_not_there(home):
    web = Web({"https://codeload.github.com/anthropics/skills/tar.gz/main": _tarball(REPO)})
    fetcher = SkillFetcher(web)
    found = fetcher.find("https://github.com/anthropics/skills/tree/main/skills/xlsx")
    assert [s.name for s in found.skills] == ["xlsx"]
    with pytest.raises(SkillError) as e:
        SkillFetcher(Web({CODELOAD: _tarball(REPO)})).find("anthropics/skills/nope")
    assert e.value.reason == "no_skills"
    with pytest.raises(SkillError) as e:
        SkillFetcher(Web({})).find("someone/missing")
    assert e.value.reason == "not_found"


def test_a_zip_a_skill_file_a_folder_and_a_lone_skill_md(home, tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("pdf/SKILL.md", PDF)
        z.writestr("__MACOSX/pdf/._SKILL.md", "junk")
    (tmp_path / "pdf.skill").write_bytes(buf.getvalue())
    fetcher = SkillFetcher(Web({"https://example.com/notes.md": b"---\nname: notes\ndescription: Notes.\n---\nHi"}))
    assert [s.name for s in fetcher.find(str(tmp_path / "pdf.skill")).skills] == ["pdf"]
    assert [s.name for s in fetcher.find(str(write_skill(tmp_path / "folder" / "pdf"))).skills] == ["pdf"]
    found = fetcher.find("https://example.com/notes.md")
    assert [(s.name, s.folder.name) for s in found.skills] == [("notes", "notes")]


def test_an_archive_cannot_write_outside_its_folder(tmp_path):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../evil/SKILL.md", PDF)
    (tmp_path / "evil.zip").write_bytes(buf.getvalue())
    with pytest.raises(SkillError) as e:
        SkillFetcher(Web({})).find(str(tmp_path / "evil.zip"))
    assert e.value.reason == "bad_archive"
    assert not (tmp_path / "evil").exists()


def test_search_asks_skills_sh_and_puts_the_most_installed_first():
    body = json.dumps(
        {
            "skills": [
                {"name": "pdf", "source": "someone/skills", "skillId": "pdf", "installs": 10},
                {"name": "pdf", "source": "anthropics/skills", "skillId": "pdf", "installs": 200000},
            ]
        }
    ).encode()
    hits = search_skills("pdf", get=lambda url: body)
    assert [h.id for h in hits] == ["anthropics/skills/pdf", "someone/skills/pdf"]
    assert search_skills("p", get=lambda url: body) == []


# ------------------------------------------------------------ sessions


class _NoApprover:
    def approve(self, request):
        raise AssertionError(f"asked for {request}")


def _session(tmp_path, monkeypatch, replies, **kwargs):
    model = FakeModel(replies)
    monkeypatch.setattr(session_module, "make_model", lambda settings: model)
    session = Session(Settings(model="x/default"), approver=_NoApprover(), cwd=tmp_path, **kwargs)
    return session, model


def test_the_model_sees_the_skills_and_loads_one_with_the_skill_tool(home, tmp_path, monkeypatch):
    library = SkillLibrary(home, [])
    library.install(write_skill(tmp_path / "src" / "pdf", files=["scripts/extract.py"]), None)
    project = tmp_path / "project"
    project.mkdir()
    session, model = _session(
        project, monkeypatch, [tool_call("skill", name="pdf"), tool_call("skill", name="pdf"), "done"], skills=library
    )
    session.send("merge these PDFs")
    first = model.requests[0]
    assert "<name>pdf</name>" in first.system and "Read, fill and merge" in first.system
    assert any(t.name == "skill" for t in first.tools)
    results = [str(b.content) for m in model.requests[2].messages for b in m.content if hasattr(b, "call_id")]
    assert "Run scripts/extract.py" in results[0] and "<file>scripts/extract.py</file>" in results[0]
    assert "already loaded" in results[1]
    # Its folder is readable without asking.
    assert library.get("pdf").folder in session.policy.readable


def test_without_skills_there_is_no_tool_and_no_section(home, tmp_path, monkeypatch):
    session, model = _session(tmp_path, monkeypatch, ["hi"], skills=SkillLibrary(home, []))
    session.send("hello")
    assert "# Skills" not in model.requests[0].system
    assert not any(t.name == "skill" for t in model.requests[0].tools)


def test_slash_name_sends_the_skill_with_the_message_and_shows_what_was_typed(home, tmp_path, monkeypatch):
    library = SkillLibrary(home, [])
    library.install(write_skill(tmp_path / "src" / "pdf"), None)
    session, model = _session(tmp_path, monkeypatch, ["ok"], skills=library)
    session.send("/pdf merge a.pdf and b.pdf")
    sent = model.requests[0].messages[0].content[0].text
    assert sent.startswith('<skill_content name="pdf">') and sent.endswith("/pdf merge a.pdf and b.pdf")
    typed = [i for i in session.snapshot().items if isinstance(i, UserMessage)]
    assert typed[0].text == "/pdf merge a.pdf and b.pdf"
    assert expand_command("/unknown hi", library.installed()) is None


def test_a_skill_installed_mid_conversation_is_listed_from_the_next_message(home, tmp_path, monkeypatch):
    library = SkillLibrary(home, [])
    session, model = _session(tmp_path, monkeypatch, ["one", "two"], skills=library)
    session.send("hi")
    library.install(write_skill(tmp_path / "src" / "pdf"), None)
    session.send("again")
    assert "# Skills" not in model.requests[0].system and "<name>pdf</name>" in model.requests[1].system


def test_an_agent_can_turn_a_skill_off(home, tmp_path, monkeypatch):
    library = SkillLibrary(home, [])
    library.install(write_skill(tmp_path / "src" / "pdf"), None)
    library.install(write_skill(tmp_path / "src2" / "xlsx", "---\nname: xlsx\ndescription: Sheets.\n---\n"), None)
    agents = AgentList(home)
    writer = agents.save(AgentConfig("", "writer", skills_off=("pdf",)))
    assert agents.get(writer.id).skills_off == ("pdf",)
    session, model = _session(tmp_path, monkeypatch, ["a", "b"], skills=library, agents=agents, agent=writer.id)
    session.send("hi")
    assert "<name>pdf</name>" not in model.requests[0].system and "<name>xlsx</name>" in model.requests[0].system
    agents.save(AgentConfig(writer.id, "writer", skills_off=()))
    session.send("again")
    assert "<name>pdf</name>" in model.requests[1].system
