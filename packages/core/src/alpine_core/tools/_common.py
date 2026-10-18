"""Helpers shared by the built-in tools."""

from __future__ import annotations

import json
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path

from alpineagents import ToolError

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


class WorkspaceTool:
    """Base of the built-in tools: an object whose ``@tool`` method works in ``workspace``."""

    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace


def truncate_tail(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    """Keeps the end of ``text`` (where errors usually are) and says how much was cut."""
    if len(text) <= limit:
        return text
    cut = len(text) - limit
    return f"[{cut} characters truncated]\n" + text[-limit:]


def os_error(e: OSError) -> str:
    """``exception_handler`` for the file tools: a failed file operation (permission denied, not a directory...) is
    an error result the model can act on, not a reason to stop the run."""
    return str(e)


def run_rg(args: list[str], cwd: Path, timeout: int = 60, limit: int | None = None) -> list[str]:
    """Runs ripgrep with ``args`` (no shell) and returns its output lines. No match is not an error.

    With ``limit``, ripgrep is stopped once it has printed that many lines, so a broad search in a huge tree (a
    common word across the Linux kernel) ends at once instead of reading millions of lines. Ask for one more line
    than you show to know whether there were more.

    Raises:
        ToolError: ripgrep is unavailable, timed out or failed.
    """
    try:
        rg = rg_path()
    except RipgrepUnavailable as e:
        raise ToolError(str(e)) from e
    lines: list[str] = []
    expired = threading.Event()
    # stderr goes to a file, not a pipe: ripgrep can print many warnings (unreadable files) while stdout is read.
    with tempfile.TemporaryFile() as err:
        try:
            proc = subprocess.Popen(
                [rg, *args], stdout=subprocess.PIPE, stderr=err, text=True, errors="replace", cwd=cwd
            )
        except OSError as e:
            raise ToolError(str(e)) from e

        def expire() -> None:
            expired.set()
            proc.kill()

        timer = threading.Timer(timeout, expire)
        timer.start()
        try:
            assert proc.stdout is not None
            with proc.stdout:
                for line in proc.stdout:
                    lines.append(line.rstrip("\n"))
                    if limit is not None and len(lines) >= limit:
                        proc.kill()
                        return lines
        finally:
            timer.cancel()
            if proc.poll() is None:
                proc.kill()
            proc.wait()
        if expired.is_set():
            raise ToolError(f"search timed out after {timeout}s. Narrow the path or pattern")
        if proc.returncode == 2 and not lines:
            err.seek(0)
            raise ToolError(err.read().decode(errors="replace").strip() or "ripgrep failed")
    return lines


def json_note(file: Path, text: str) -> str:
    """For a ``.json`` file, a line saying the text written is not valid JSON, else ``""``. Models editing JSON by
    exact-text replacement sometimes leave a duplicated tail; telling them at once lets them fix it in the same run."""
    if file.suffix.lower() != ".json":
        return ""
    try:
        json.loads(text)
    except ValueError as e:
        where = f" (line {e.lineno}, column {e.colno})" if isinstance(e, json.JSONDecodeError) else ""
        msg = e.msg if isinstance(e, json.JSONDecodeError) else str(e)
        return f"\nThe file is not valid JSON now: {msg}{where}. Read it and fix it."
    return ""
