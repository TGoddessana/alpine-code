from __future__ import annotations

import asyncio
import os
import signal

from alpineagents import tool

from ._common import Workspace, error, truncate_tail

DEFAULT_TIMEOUT = 120
MAX_TIMEOUT = 600


class Bash:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="bash", parallel=False)
    async def bash(self, command: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        """Run a shell command in the working directory and return its output (stdout and stderr together)
        and exit code. Each call starts a fresh shell, so cd and variables do not carry over.

        Args:
            command: The command to run
            timeout: Seconds before the command is killed (default 120, max 600)
        """
        timeout = min(max(timeout, 1), MAX_TIMEOUT)
        try:
            process = await asyncio.create_subprocess_shell(
                command,
                cwd=self.workspace.root,
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                start_new_session=True,  # own process group, so the whole tree can be killed
            )
        except OSError as e:
            return error(str(e))
        try:
            output, _ = await asyncio.wait_for(process.communicate(), timeout)
        except TimeoutError:
            _kill(process)
            return error(f"command timed out after {timeout}s")
        except asyncio.CancelledError:
            _kill(process)
            raise
        text = truncate_tail(output.decode("utf-8", errors="replace").rstrip())
        code = process.returncode
        if not text:
            text = "(no output)"
        return text if code == 0 else f"{text}\n[exit code {code}]"


def _kill(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
