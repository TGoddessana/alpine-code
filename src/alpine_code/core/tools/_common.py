"""Helpers shared by the built-in tools."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from .ripgrep import RipgrepUnavailable, rg_path

#: Most characters of tool output sent back to the model.
MAX_OUTPUT_CHARS = 30_000

#: Globs every ripgrep search adds: never show VCS internals or secret env files (``.env``, ``.env.local``).
RG_EXCLUDES = ("--glob=!**/.git/**", "--glob=!.env", "--glob=!.env.*")


@dataclass(frozen=True)
class Workspace:
    """The directory the agent works in. Relative tool paths resolve against ``root``."""

    root: Path

    def resolve(self, path: str) -> Path:
        p = Path(path).expanduser()
        return p if p.is_absolute() else (self.root / p)

    def display(self, path: Path) -> str:
        """``path`` relative to the root when inside it, absolute otherwise."""
        try:
            return str(path.resolve().relative_to(self.root.resolve()))
        except ValueError:
            return str(path)


def truncate_tail(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    """Keeps the end of ``text`` (where errors usually are) and says how much was cut."""
    if len(text) <= limit:
        return text
    cut = len(text) - limit
    return f"[{cut} characters truncated]\n" + text[-limit:]


def error(message: str) -> str:
    """A tool result the model reads as a failure. Tools return this instead of raising, because an exception
    from a tool ends the whole run."""
    return f"Error: {message}"


def run_rg(args: list[str], cwd: Path, timeout: int = 60) -> tuple[list[str], str | None]:
    """Runs ripgrep with ``args`` (no shell) and returns ``(output lines, error)``. No match is not an error."""
    try:
        rg = rg_path()
    except RipgrepUnavailable as e:
        return [], str(e)
    try:
        done = subprocess.run([rg, *args], capture_output=True, text=True, timeout=timeout, cwd=cwd)
    except subprocess.TimeoutExpired:
        return [], f"search timed out after {timeout}s. Narrow the path or pattern"
    except OSError as e:
        return [], str(e)
    if done.returncode == 2 and not done.stdout:
        return [], done.stderr.strip() or "ripgrep failed"
    return done.stdout.splitlines(), None
