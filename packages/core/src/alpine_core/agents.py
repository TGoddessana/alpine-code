"""Agents: a model, instructions and the tools it may use, with a name and a face.

The user builds agents on one screen and puts one to work on a project, the way a new hire is put on a team. A
session starts with the agent the user picked, else the one its project used last, else the default agent, which
always exists. Safety belongs to the session and memory to the project, so an agent holds neither. Nothing picks an
agent by project or model. See ``docs/agents.md``.

Kept in ``~/.alpine-code/agents.json``. Tool names cover built-in and user tools alike. Profiles from before agents
(``profiles.json``) become agents the first time the list is read; that file is left where it is.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from dataclasses import dataclass, replace
from pathlib import Path

from .home import home_dir
from .projects import ProjectList
from .tools import BUILTIN

DEFAULT_ID = "default"

#: The figures Alpine draws for an agent: antenna, hard hat, glasses, beret, headphones, cap, chef's hat, sprout,
#: ribbon, beanie, bow tie, graduation cap.
LOOKS = (
    "antenna",
    "hardhat",
    "glasses",
    "beret",
    "headphones",
    "cap",
    "chef",
    "sprout",
    "ribbon",
    "beanie",
    "bowtie",
    "grad",
)

#: 1 to 5 are the avatar colours (green, blue, purple, ochre, pink), then teal, grey and apricot.
COLORS = range(1, 9)


@dataclass(frozen=True)
class AgentConfig:
    id: str
    name: str
    """Empty for the default agent until it is renamed; the app shows its own name for it."""
    description: str = ""
    model: str | None = None
    """``<connection>/<model>``; ``None`` for the default model."""
    instructions: str = ""
    tools: tuple[str, ...] = BUILTIN
    look: str = "antenna"
    """One of ``LOOKS``."""
    color: int = 2
    """One of ``COLORS``."""

    @property
    def is_default(self) -> bool:
        return self.id == DEFAULT_ID


def free_character(taken: set[tuple[str, int]], look: str = "antenna", color: int = 1) -> tuple[str, int]:
    """The first look and colour no one has, searching from the given ones: the next colours of the same look, then
    the next looks. When all 96 are taken, the given ones."""
    start = LOOKS.index(look) if look in LOOKS else 0
    for i in range(len(LOOKS)):
        candidate = LOOKS[(start + i) % len(LOOKS)]
        for j in range(len(COLORS)):
            c = (color - 1 + j) % len(COLORS) + 1
            if (candidate, c) not in taken:
                return candidate, c
    return look, color


_locks: dict[Path, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(file: Path) -> threading.Lock:
    """One lock per file, shared by every ``AgentList`` on it, so separate instances cannot lose each other's
    updates."""
    key = file.resolve()
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


class AgentList:
    """The agents in ``home/agents.json``. Safe to use from several threads, also through several instances."""

    def __init__(self, home: Path | None = None) -> None:
        self._home = home or home_dir()
        self._file = self._home / "agents.json"
        self._lock = _lock_for(self._file)

    def list(self) -> list[AgentConfig]:
        """The default agent first, then the others in the order they were made."""
        with self._lock:
            return self._read()

    def get(self, agent_id: str) -> AgentConfig | None:
        return next((a for a in self.list() if a.id == agent_id), None)

    def default(self) -> AgentConfig:
        return self.list()[0]

    def save(self, agent: AgentConfig) -> AgentConfig:
        """Adds an agent (an empty ``id`` gets a new one, and a look and colour no other agent has if the ones given
        are taken) or replaces the one with its id."""
        look = agent.look if agent.look in LOOKS else "antenna"
        color = agent.color if agent.color in COLORS else 1
        agent = replace(
            agent,
            name=agent.name.strip(),
            description=agent.description.strip(),
            tools=tuple(dict.fromkeys(agent.tools)),
            look=look,
            color=color,
        )
        with self._lock:
            agents = self._read()
            if not agent.id:
                taken = {(a.look, a.color) for a in agents}
                if (look, color) in taken:
                    look, color = free_character(taken, look, color)
                agent = replace(agent, id=uuid.uuid4().hex[:12], look=look, color=color)
            index = next((i for i, a in enumerate(agents) if a.id == agent.id), None)
            if index is None:
                agents.append(agent)
            else:
                agents[index] = agent
            self._write(agents)
        return agent

    def delete(self, agent_id: str) -> None:
        """Removes an agent. The default agent cannot be removed; nothing happens."""
        if agent_id == DEFAULT_ID:
            return
        with self._lock:
            self._write([a for a in self._read() if a.id != agent_id])

    def enable(self, agent_id: str, tool: str) -> None:
        """Turns one tool on in one agent."""
        with self._lock:
            self._write(
                [
                    replace(a, tools=(*a.tools, tool)) if a.id == agent_id and tool not in a.tools else a
                    for a in self._read()
                ]
            )

    def forget_tools(self, tools: set[str]) -> None:
        """Turns these tools off everywhere, after their file was deleted."""
        with self._lock:
            self._write([replace(a, tools=tuple(t for t in a.tools if t not in tools)) for a in self._read()])

    def _read(self) -> list[AgentConfig]:
        try:
            data = json.loads(self._file.read_text("utf-8"))
        except FileNotFoundError:
            return self._migrate()
        except (OSError, ValueError):
            data = {}
        items = data.get("agents") if isinstance(data, dict) else None
        agents = [
            _agent_from(item)
            for item in (items if isinstance(items, list) else [])
            if isinstance(item, dict) and item.get("id")
        ]
        return _default_first(agents)

    def _migrate(self) -> list[AgentConfig]:
        """Turns ``profiles.json`` into agents (decision 11 of ``docs/agents.md``), once. Without it, the default."""
        try:
            data = json.loads((self._home / "profiles.json").read_text("utf-8"))
        except (OSError, ValueError):
            return _default_first([])
        profiles = data.get("profiles") if isinstance(data, dict) else None
        if not isinstance(profiles, list):
            return _default_first([])
        profiles = [p for p in profiles if isinstance(p, dict) and p.get("id")]
        agents: list[AgentConfig] = []
        taken: set[tuple[str, int]] = {("antenna", 2)}
        for profile in profiles:
            is_default = str(profile["id"]) == DEFAULT_ID
            look, color = "antenna", 2
            if not is_default:
                k = sum(1 for a in agents if not a.is_default)
                look, color = free_character(taken, LOOKS[k % len(LOOKS)], k % len(COLORS) + 1)
                taken.add((look, color))
            agents.append(
                AgentConfig(
                    id=str(profile["id"]),
                    name="" if is_default else str(profile.get("name", "")),
                    model=_model_of(profile.get("model")),
                    tools=_tools_of(profile.get("tools")),
                    look=look,
                    color=color,
                )
            )
        agents = _default_first(agents)
        self._write(agents)
        chosen: dict[str, dict] = {}  # project folder -> the profile that stays its last agent
        for profile in profiles:
            project = profile.get("project")
            if project and (project not in chosen or (profile.get("model") is None and chosen[project].get("model"))):
                chosen[project] = profile
        projects = ProjectList(self._home / "projects.json")
        for project, profile in chosen.items():
            projects.set_agent(Path(project), str(profile["id"]))
        return agents

    def _write(self, agents: list[AgentConfig]) -> None:
        self._file.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "agents": [
                {
                    "id": a.id,
                    "name": a.name,
                    "description": a.description,
                    "model": a.model,
                    "instructions": a.instructions,
                    "tools": list(a.tools),
                    "look": a.look,
                    "color": a.color,
                }
                for a in agents
            ]
        }
        fd, name = tempfile.mkstemp(dir=self._file.parent, prefix=".agents.json.", suffix=".tmp")
        tmp = Path(name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(data, indent=2, ensure_ascii=False))
            tmp.replace(self._file)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise


def _default_first(agents: list[AgentConfig]) -> list[AgentConfig]:
    default = next((a for a in agents if a.is_default), AgentConfig(DEFAULT_ID, ""))
    return [default, *(a for a in agents if not a.is_default)]


def _tools_of(value: object) -> tuple[str, ...]:
    if isinstance(value, list) and all(isinstance(t, str) for t in value):
        return tuple(value)
    return BUILTIN


def _model_of(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _agent_from(item: dict) -> AgentConfig:
    """An agent from a stored entry, with anything of the wrong shape replaced by its default."""
    look, color = item.get("look"), item.get("color")
    return AgentConfig(
        id=str(item["id"]),
        name=str(item.get("name", "")),
        description=str(item.get("description", "")),
        model=_model_of(item.get("model")),
        instructions=str(item.get("instructions", "")),
        tools=_tools_of(item.get("tools", BUILTIN)),
        look=look if isinstance(look, str) and look in LOOKS else "antenna",
        color=color if isinstance(color, int) and not isinstance(color, bool) and color in COLORS else 2,
    )
