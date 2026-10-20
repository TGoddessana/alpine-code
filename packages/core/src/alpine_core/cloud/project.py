"""A project's ``.alpine-code/cloud.toml``: how Alpine Cloud publishes it (decision 22), and which of its files
changed since the last publish. Everything else in the folder is the project's own business."""

from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import tomllib

from . import runtimes
from .links import Published


@dataclass(frozen=True)
class CloudDescription:
    version: int
    kind: str
    """The template kind: ``web-lite``, ``web-pro``, ``blank``..."""
    adapter: str | None
    """How the project builds for Alpine Cloud (``cloudflare-workers``); ``None`` when it is not published."""
    database_kind: str | None = None
    migrations: str | None = None
    build_command: str | None = None
    """Run in the project folder to make the output (``npm run build``)."""
    build_output: str | None = None
    """The folder the build leaves for the adapter (``dist``)."""

    @property
    def needs_node(self) -> bool:
        """Whether building runs through Node.js, so a missing Node means no publishing."""
        words = (self.build_command or "").split()
        return bool(words) and Path(words[0]).name in NODE_COMMANDS


#: Build commands that need Node.js on the computer.
NODE_COMMANDS = frozenset({"npm", "npx", "node", "pnpm", "yarn", "corepack", "bun"})
#: The adapters core knows how to build and read.
ADAPTERS = frozenset({"cloudflare-workers"})


def cloud_toml(project: Path) -> Path:
    return project / ".alpine-code" / "cloud.toml"


def read_description(project: Path) -> CloudDescription | None:
    """The project's description, or ``None`` when it has none or it cannot be read."""
    try:
        data = tomllib.loads(cloud_toml(project).read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return None
    database = data.get("database") if isinstance(data.get("database"), dict) else {}
    adapter = data.get("adapter")
    build = data.get("build") if isinstance(data.get("build"), dict) else {}
    return CloudDescription(
        version=data.get("version") if isinstance(data.get("version"), int) else 1,
        kind=str(data.get("kind") or "blank"),
        adapter=adapter if isinstance(adapter, str) and adapter else None,
        database_kind=database.get("kind") if isinstance(database.get("kind"), str) else None,
        migrations=database.get("migrations") if isinstance(database.get("migrations"), str) else None,
        build_command=build.get("command") if isinstance(build.get("command"), str) else None,
        build_output=build.get("output") if isinstance(build.get("output"), str) else None,
    )


def not_publishable(project: Path) -> str | None:
    """Why Alpine Cloud cannot publish this project, or ``None``: ``no_description`` (no ``cloud.toml``) or
    ``not_web`` (it describes nothing core can build, like a ``blank`` project)."""
    description = read_description(project)
    if description is None:
        return "no_description"
    if description.adapter not in ADAPTERS:
        return "not_web"
    return None


def node_missing(description: CloudDescription) -> bool:
    return description.needs_node and runtimes.find_node() is None


# ---------------------------------------------------------------- what changed since the last publish


def source(project: Path) -> Published | None:
    """The project's source now: ``git rev-parse HEAD`` and a tree of the working files, made with a temporary index
    (``GIT_INDEX_FILE``) so dirty and untracked work counts and the real index and history are left alone. Ignored
    files (``node_modules``, ``dist``) are not in it. ``None`` outside a git repository.

    Blocking: runs git.
    """
    top = _git(project, "rev-parse", "--show-toplevel")
    if top is None:
        return None
    commit = _git(project, "rev-parse", "--verify", "--quiet", "HEAD") or ""  # empty before the first commit
    with tempfile.TemporaryDirectory(prefix="alpine-index-") as scratch:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(scratch) / "index")}
        if _git(project, "add", "-A", "--", ".", env=env) is None:
            return None
        tree = _git(project, "write-tree", env=env)
    return None if tree is None else Published(commit, tree)


def changed_paths(project: Path, published: Published, now: Published | None = None) -> list[str]:
    """The paths (relative to ``project``) that differ between the last published tree and the working files now
    (``now``, when the caller already has it)."""
    now = now or source(project)
    if now is None or now.tree == published.tree:
        return []
    out = _git(project, "diff-tree", "-r", "--name-only", "-z", "--relative", published.tree, now.tree)
    return [path for path in (out or "").split("\0") if path]


def _git(project: Path, *args: str, env: dict[str, str] | None = None) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(project), *args], capture_output=True, text=True, timeout=60, env=env, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    return result.stdout.strip() if result.returncode == 0 else None
