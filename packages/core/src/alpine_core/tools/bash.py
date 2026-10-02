from __future__ import annotations

import asyncio
import os
import signal
from collections.abc import Callable
from pathlib import Path

from alpineagents import ToolError, tool

from ._common import Workspace, WorkspaceTool, os_error, truncate_tail

DEFAULT_TIMEOUT = 120
MAX_TIMEOUT = 600

#: Told what a ``bash`` call ran and how it exited (``None``: it timed out), so the plan can count it as a check.
CommandObserver = Callable[[str, int | None], None]


class Bash(WorkspaceTool):
    def __init__(self, workspace: Workspace, on_command: CommandObserver | None = None) -> None:
        super().__init__(workspace)
        self.on_command = on_command

    @tool(name="bash", parallel=False, exception_handler=os_error, open_world=True)
    async def bash(self, command: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        """Run a shell command in the working directory and return its output (stdout and stderr together)
        and exit code. Each call starts a fresh shell, so cd and variables do not carry over.

        Args:
            command: The command to run
            timeout: Seconds before the command is killed (default 120, max 600)
        """
        try:
            text, code = await run_command(self.workspace.root, command, timeout)
        except ToolError:
            if self.on_command is not None:
                self.on_command(command, None)
            raise
        if self.on_command is not None:
            self.on_command(command, code)
        return text if code == 0 else f"{text}\n[exit code {code}]"


async def run_command(cwd: Path, command: str, timeout: int = DEFAULT_TIMEOUT) -> tuple[str, int]:
    """Runs ``command`` in a shell in ``cwd`` and returns its output (stdout and stderr together, the end kept when
    long, ``(no output)`` when empty) and exit code. The whole process tree is killed on timeout or cancel.

    Raises:
        ToolError: The command timed out.
        OSError: The shell could not start.
    """
    timeout = min(max(timeout, 1), MAX_TIMEOUT)
    process = await asyncio.create_subprocess_shell(
        command,
        cwd=cwd,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,  # own process group, so the whole tree can be killed
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout)
    except TimeoutError as e:
        _kill(process)
        raise ToolError(f"command timed out after {timeout}s") from e
    except asyncio.CancelledError:
        _kill(process)
        raise
    text = truncate_tail(output.decode("utf-8", errors="replace").rstrip())
    return text or "(no output)", process.returncode if process.returncode is not None else -1


def _kill(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
