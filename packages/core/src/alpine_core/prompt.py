"""Builds the system prompt: the base instructions, the environment, and project instructions (AGENTS.md)."""

from __future__ import annotations

import platform
from datetime import date
from importlib.resources import files
from pathlib import Path

from .config import config_dir

#: Project instruction files, in order of preference within one directory. CLAUDE.md is read when there is no
#: AGENTS.md, so projects set up for Claude Code work as is.
INSTRUCTION_FILES = ("AGENTS.md", "CLAUDE.md")


def base_instructions() -> str:
    return files("alpine_core").joinpath("prompts/system.md").read_text(encoding="utf-8")


def find_git_root(start: Path) -> Path | None:
    for directory in (start, *start.parents):
        if (directory / ".git").exists():
            return directory
    return None


def instruction_files(cwd: Path) -> list[Path]:
    """The global instruction file, then one file per directory from the git root (or cwd) down to cwd."""
    found: list[Path] = []
    global_file = config_dir() / "AGENTS.md"
    if global_file.is_file():
        found.append(global_file)
    cwd = cwd.resolve()
    root = find_git_root(cwd) or cwd
    chain = [cwd, *cwd.parents]
    for directory in reversed(chain[: chain.index(root) + 1]):
        for name in INSTRUCTION_FILES:
            if (directory / name).is_file():
                found.append(directory / name)
                break
    return found


def environment(cwd: Path) -> str:
    return "\n".join(
        [
            f"Working directory: {cwd}",
            f"Is a git repository: {'yes' if find_git_root(cwd) else 'no'}",
            f"Platform: {platform.system()} {platform.release()}",
            f"Today's date: {date.today().isoformat()}",
        ]
    )


def build_system_prompt(cwd: Path) -> str:
    parts = [base_instructions().strip(), f"# Environment\n{environment(cwd)}"]
    for file in instruction_files(cwd):
        text = file.read_text(encoding="utf-8", errors="replace").strip()
        if text:
            parts.append(f"# Instructions from {file}\n{text}")
    return "\n\n".join(parts) + "\n"
