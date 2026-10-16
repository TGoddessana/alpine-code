"""Skills: folders with a ``SKILL.md`` that teach the agent a task (the Agent Skills format, agentskills.io).

The model sees each skill's name and description in the system prompt and loads one with the ``skill`` tool when a
task calls for it; the user can also start a message with ``/<name>``. A skill's other files (scripts, references)
are read with the ordinary tools, and its folder is readable without asking.

Where skills come from, first one with a name wins:

- the project's own (``<project>/.agents/skills``, ``<project>/.alpine/skills``, ``<project>/.claude/skills``),
  read like the project's AGENTS.md;
- the ones Alpine installed, in ``~/.alpine-code/skills/<name>``, which Alpine may change and delete;
- the ones other apps put on this computer (``~/.agents/skills``, ``~/.claude/skills``, ``~/.codex/skills``), used
  where they are and never changed or deleted by Alpine.

Every skill is in every agent unless the agent turns it off (``AgentConfig.skills_off``): installing a skill is
enough to use it.

Files are read leniently, as the format's client guide asks: a name that breaks the rules or differs from the
folder is noted but loaded; a file without a description, or whose front matter cannot be read, is left out.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import tempfile
import threading
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from alpineagents import State, Tool
from alpineagents.errors import ToolInputError

from .home import home_dir

Origin = Literal["project", "alpine", "agents", "claude", "codex"]

#: The file that makes a folder a skill.
SKILL_FILE = "SKILL.md"

#: Where Alpine notes, inside a skill it installed, where the skill came from.
SOURCE_FILE = ".alpine-source.json"

#: Folders inside a project that hold its skills, in order.
PROJECT_FOLDERS = (".agents/skills", ".alpine/skills", ".claude/skills")

_NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
_SKIP = {".git", "node_modules", "__pycache__", ".venv", "venv"}
_TOOLING = {".cache", ".idea", ".vscode", ".next", ".turbo", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache"}

#: How deep and how wide a search for skills goes, so a huge folder cannot stall it.
MAX_DEPTH = 5
MAX_FOLDERS = 2000

#: Most files listed with a loaded skill.
MAX_LISTED = 50


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    folder: Path
    origin: Origin
    source: str | None = None
    """Where Alpine installed it from (a link, ``owner/repo/skill``, a file); ``None`` when Alpine did not."""
    notes: tuple[str, ...] = ()
    """What is off about the file, though it loads (a name that breaks the format's rules, say)."""
    meta: dict[str, Any] = field(default_factory=dict, compare=False, hash=False)
    """The rest of the front matter (license, compatibility, metadata, allowed-tools)."""

    @property
    def file(self) -> Path:
        return self.folder / SKILL_FILE

    @property
    def owned(self) -> bool:
        """Whether Alpine may change or delete it: it installed or made it."""
        return self.origin == "alpine"

    def body(self) -> str:
        """The instructions: ``SKILL.md`` after the front matter. Read now, so edits since discovery show."""
        try:
            return split_front_matter(self.file.read_text(encoding="utf-8", errors="replace"))[1]
        except OSError:
            return ""

    def files(self, limit: int = MAX_LISTED) -> tuple[list[str], bool]:
        """The skill's other files, relative to its folder, and whether there were more than ``limit``."""
        found: list[str] = []
        for path in sorted(self.folder.rglob("*")):
            rel = path.relative_to(self.folder)
            if any(part.startswith(".") or part in _SKIP for part in rel.parts):
                continue
            if path.is_file() and rel.as_posix() != SKILL_FILE:
                if len(found) == limit:
                    return found, True
                found.append(rel.as_posix())
        return found, False

    @property
    def has_scripts(self) -> bool:
        """Whether it brings code to run (a ``scripts`` folder, or a script file)."""
        if (self.folder / "scripts").is_dir():
            return True
        return any(p.suffix in {".py", ".sh", ".js", ".ts", ".mjs"} for p in self.folder.glob("*"))


class SkillError(Exception):
    """A skill file Alpine cannot use or write. ``reason`` is a code the app can word."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


# ------------------------------------------------------------ reading


def split_front_matter(text: str) -> tuple[str | None, str]:
    """The YAML between the opening and closing ``---``, and the body after it (trimmed). ``None`` for a file
    without front matter."""
    text = text.lstrip("﻿")
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None, text.strip()
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "\n".join(lines[1:i]), "\n".join(lines[i + 1 :]).strip()
    return None, text.strip()


def parse_front_matter(raw: str) -> dict[str, Any] | None:
    """The front matter as a dict, or ``None`` when it cannot be read. Files written for other apps often have
    unquoted values with a colon (``description: Use when: ...``), which YAML rejects; those lines are quoted and
    read again."""
    for attempt in (raw, _quote_plain_values(raw)):
        try:
            data = yaml.safe_load(attempt)
        except yaml.YAMLError:
            continue
        if isinstance(data, dict):
            return {str(k): v for k, v in data.items()}
    return None


def _quote_plain_values(raw: str) -> str:
    out = []
    for line in raw.splitlines():
        match = re.match(r"^([A-Za-z0-9_-]+):\s+(.+)$", line)
        if match and not match.group(2).startswith(("'", '"', "|", ">", "[", "{")) and ":" in match.group(2):
            value = match.group(2).replace("\\", "\\\\").replace('"', '\\"')
            line = f'{match.group(1)}: "{value}"'
        out.append(line)
    return "\n".join(out)


def name_problems(name: str, folder_name: str | None = None) -> list[str]:
    """What breaks the format's rules for ``name``: an empty list when nothing does."""
    problems = []
    if not name:
        problems.append("no name")
    elif len(name) > 64:
        problems.append("name longer than 64 characters")
    elif not _NAME.match(name):
        problems.append("name is not lowercase letters, digits and single hyphens")
    if name and folder_name is not None and name != folder_name:
        problems.append(f"name differs from the folder ({folder_name})")
    return problems


def read_skill(folder: Path, origin: Origin) -> Skill | None:
    """The skill in ``folder``, or ``None`` when its ``SKILL.md`` is missing, unreadable or has no description."""
    file = folder / SKILL_FILE
    try:
        text = file.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    raw, _ = split_front_matter(text)
    data = parse_front_matter(raw) if raw is not None else None
    if data is None:
        return None
    description = data.pop("description", None)
    if not isinstance(description, str) or not description.strip():
        return None
    name = data.pop("name", None)
    name = name.strip() if isinstance(name, str) and name.strip() else folder.name
    notes = name_problems(name, folder.name)
    if len(description) > 1024:
        notes.append("description longer than 1024 characters")
    source = None
    if origin == "alpine":
        try:
            source = json.loads((folder / SOURCE_FILE).read_text(encoding="utf-8")).get("source")
        except (OSError, ValueError, AttributeError):
            pass
    return Skill(name, " ".join(description.split()), folder, origin, source, tuple(notes), data)


def find_skill_folders(root: Path, max_depth: int = MAX_DEPTH, max_folders: int = MAX_FOLDERS) -> list[Path]:
    """Folders under ``root`` (``root`` too) that hold a ``SKILL.md``. A skill's own subfolders are not searched."""
    found: list[Path] = []
    seen = 0
    stack = [(root, 0)]
    while stack:
        folder, depth = stack.pop()
        seen += 1
        if seen > max_folders:
            break
        if (folder / SKILL_FILE).is_file():
            found.append(folder)
            continue
        if depth >= max_depth:
            continue
        try:
            children = sorted((p for p in folder.iterdir() if p.is_dir()), reverse=True)
        except OSError:
            continue
        # Hidden folders are searched (repositories keep skills in .claude/skills or .curated), tooling's are not.
        stack.extend((c, depth + 1) for c in children if c.name not in _SKIP and c.name not in _TOOLING)
    return sorted(found)


def _skills_in(folder: Path, origin: Origin) -> list[Skill]:
    """The skills directly inside ``folder`` (one level, as every client keeps them)."""
    if not folder.is_dir():
        return []
    skills = []
    try:
        children = sorted(p for p in folder.iterdir() if p.is_dir() and not p.name.startswith("."))
    except OSError:
        return []
    for child in children:
        skill = read_skill(child, origin)
        if skill is not None:
            skills.append(skill)
    return skills


def other_apps() -> list[tuple[Path, Origin]]:
    """Where other apps keep the user's skills."""
    home = Path.home()
    codex = Path(os.environ.get("CODEX_HOME") or home / ".codex")
    return [(home / ".agents/skills", "agents"), (home / ".claude/skills", "claude"), (codex / "skills", "codex")]


# ------------------------------------------------------------ the library


_locks: dict[Path, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(folder: Path) -> threading.Lock:
    key = folder.resolve()
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


class SkillLibrary:
    """The user's skills: the ones Alpine installed in ``home/skills`` and the ones other apps keep in ``elsewhere``
    (by default ``other_apps()``). Safe to use from several threads."""

    def __init__(self, home: Path | None = None, elsewhere: Sequence[tuple[Path, Origin]] | None = None) -> None:
        self.folder = (home or home_dir()) / "skills"
        self._elsewhere = list(other_apps() if elsewhere is None else elsewhere)
        self._lock = _lock_for(self.folder)

    def installed(self) -> list[Skill]:
        """Every skill of the user, Alpine's first; a name found again later is left out."""
        return _first_by_name([*_skills_in(self.folder, "alpine"), *self._from_elsewhere()])

    def for_project(self, project: Path) -> list[Skill]:
        """The skills a session in ``project`` can use: the project's own, then the user's."""
        own = [s for sub in PROJECT_FOLDERS for s in _skills_in(project / sub, "project")]
        return _first_by_name([*own, *self.installed()])

    def get(self, name: str, project: Path | None = None) -> Skill | None:
        skills = self.for_project(project) if project is not None else self.installed()
        return next((s for s in skills if s.name == name), None)

    def install(self, folder: Path, source: str | None) -> Skill:
        """Copies the skill in ``folder`` into the library, replacing an installed one with the same name (an
        update). The folder is named after the skill.

        Raises:
            SkillError: ``folder`` holds no usable skill (``not_a_skill``), or its name cannot be a folder name
                (``bad_name``).
        """
        skill = read_skill(folder, "alpine")
        if skill is None:
            raise SkillError(f"No usable {SKILL_FILE} in {folder}", "not_a_skill")
        name = skill.name if _NAME.match(skill.name) and len(skill.name) <= 64 else slug(skill.name)
        if not name:
            raise SkillError(f"Cannot name a folder after {skill.name!r}", "bad_name")
        with self._lock:
            self.folder.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(dir=self.folder, prefix=f".{name}."))
            try:
                copy = staging / name
                shutil.copytree(folder, copy, ignore=shutil.ignore_patterns(".git", "node_modules", "__pycache__"))
                (copy / SOURCE_FILE).write_text(json.dumps({"source": source}, ensure_ascii=False), encoding="utf-8")
                target = self.folder / name
                if target.exists():
                    old = staging / "old"
                    target.rename(old)
                copy.rename(target)
            finally:
                shutil.rmtree(staging, ignore_errors=True)
        installed = read_skill(self.folder / name, "alpine")
        assert installed is not None
        return installed

    def write(self, name: str, text: str, *, new: bool = False) -> Skill:
        """Writes the ``SKILL.md`` of a skill Alpine owns; with ``new``, makes the skill.

        Raises:
            SkillError: ``bad_name``, ``exists`` (``new`` and the name is taken), ``not_owned`` (no installed skill
                by that name), or ``invalid`` (the text has no front matter with a description).
        """
        if name_problems(name):
            raise SkillError(f"Not a skill name: {name!r}", "bad_name")
        raw, _ = split_front_matter(text)
        data = parse_front_matter(raw) if raw is not None else None
        if not data or not isinstance(data.get("description"), str) or not data["description"].strip():
            raise SkillError("SKILL.md needs front matter with a description", "invalid")
        folder = self.folder / name
        with self._lock:
            if new and (folder.exists() or any(s.name == name for s in self._from_elsewhere())):
                raise SkillError(f"A skill named {name} exists", "exists")
            if not new and not (folder / SKILL_FILE).is_file():
                raise SkillError(f"No skill named {name} that Alpine can change", "not_owned")
            folder.mkdir(parents=True, exist_ok=True)
            _write_atomic(folder / SKILL_FILE, text)
            if new:
                (folder / SOURCE_FILE).write_text(json.dumps({"source": None}), encoding="utf-8")
        skill = read_skill(folder, "alpine")
        assert skill is not None
        return skill

    def remove(self, name: str) -> None:
        """Deletes a skill Alpine installed or made. Nothing happens for an unknown name.

        Raises:
            SkillError: ``not_owned``, the skill belongs to another app.
        """
        folder = self.folder / name
        with self._lock:
            if (folder / SKILL_FILE).is_file() or folder.is_dir():
                shutil.rmtree(folder)
                return
        if any(s.name == name for s in self._from_elsewhere()):
            raise SkillError(f"{name} belongs to another app", "not_owned")

    def _from_elsewhere(self) -> list[Skill]:
        return [s for folder, origin in self._elsewhere for s in _skills_in(folder, origin)]


def _first_by_name(skills: Iterable[Skill]) -> list[Skill]:
    seen: set[str] = set()
    out = []
    for s in skills:
        if s.name not in seen:
            seen.add(s.name)
            out.append(s)
    return out


def _write_atomic(file: Path, text: str) -> None:
    fd, name = tempfile.mkstemp(dir=file.parent, prefix=f".{file.name}.", suffix=".tmp")
    tmp = Path(name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        tmp.replace(file)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


def slug(text: str) -> str:
    """``text`` as a skill name: lowercase letters, digits and single hyphens, at most 64 characters."""
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")[:64].strip("-")


def skill_text(name: str, description: str, body: str) -> str:
    """A ``SKILL.md`` with this name, description and body."""
    head = yaml.safe_dump({"name": name, "description": description}, allow_unicode=True, sort_keys=False)
    return f"---\n{head}---\n\n{body.strip()}\n"


# ------------------------------------------------------------ what the model sees


def catalog(skills: Sequence[Skill]) -> str:
    """The system prompt's section listing the skills; empty without any."""
    if not skills:
        return ""
    entries = "\n".join(
        f"  <skill>\n    <name>{_xml(s.name)}</name>\n    <description>{_xml(s.description)}</description>\n  </skill>"
        for s in skills
    )
    return (
        "# Skills\n"
        "Skills are instructions for particular kinds of tasks, installed by the user. When a task matches a "
        "skill's description, load it with the `skill` tool before starting, and follow it. A message that starts "
        "with `/<name>` comes with that skill already loaded.\n\n"
        f"<available_skills>\n{entries}\n</available_skills>"
    )


def skill_content(skill: Skill) -> str:
    """A skill's instructions as the model gets them: the body, where its folder is, and its other files."""
    files, more = skill.files()
    listed = "\n".join(f"  <file>{_xml(f)}</file>" for f in files)
    if more:
        listed += "\n  <!-- more files not listed -->"
    resources = f"\n\n<skill_resources>\n{listed}\n</skill_resources>" if files else ""
    return (
        f'<skill_content name="{_xml(skill.name)}">\n{skill.body()}\n\n'
        f"Skill directory: {skill.folder}\n"
        f"Relative paths in this skill are relative to the skill directory.{resources}\n"
        "</skill_content>"
    )


def _xml(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def loaded(state: State | None, name: str) -> bool:
    """Whether the skill's instructions are in the conversation now (a summary drops them, so then they are not)."""
    if state is None:
        return False
    marker = f'<skill_content name="{_xml(name)}">'
    for message in state.messages:
        for block in message.content:
            if marker in _text_of(block):
                return True
    return False


def _text_of(block: Any) -> str:
    for attr in ("text", "content", "output"):
        value = getattr(block, attr, None)
        if isinstance(value, str):
            return value
        if isinstance(value, tuple):
            return "".join(_text_of(b) for b in value)
    return ""


class SkillTool(Tool):
    """Loads a skill's instructions into the conversation."""

    def __init__(self, skills: Sequence[Skill]) -> None:
        self._skills = {s.name: s for s in skills}
        super().__init__(
            name="skill",
            description=(
                "Load a skill's full instructions. Call it when the task matches a skill listed under Skills in the "
                "system prompt, before doing the task."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "enum": sorted(self._skills), "description": "The skill's name."}
                },
                "required": ["name"],
            },
            read_only=True,
            open_world=False,
        )

    def run(self, args: dict[str, Any], state: State) -> str:
        name = args.get("name")
        skill = self._skills.get(name) if isinstance(name, str) else None
        if skill is None:
            raise ToolInputError(f"No skill named {name!r}. Skills: {', '.join(sorted(self._skills))}")
        if loaded(state, skill.name):
            return f"The {skill.name} skill is already loaded earlier in this conversation; follow it."
        return skill_content(skill)


def expand_command(text: str, skills: Sequence[Skill]) -> tuple[Skill, str] | None:
    """For a message that starts with ``/<name>`` of one of ``skills``: the skill, and what the model gets (the
    skill's instructions, then the message)."""
    match = re.match(r"^/([A-Za-z0-9][A-Za-z0-9_:.-]*)(?:\s|$)", text)
    if not match:
        return None
    skill = next((s for s in skills if s.name == match.group(1)), None)
    if skill is None:
        return None
    rest = text[match.end() :].strip()
    request = rest or f"(The user asked for the {skill.name} skill without saying more.)"
    return skill, f"{skill_content(skill)}\n\n{text.strip() if rest else request}"
