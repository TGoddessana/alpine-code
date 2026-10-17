from __future__ import annotations

import asyncio
import json
import os
import signal

from alpineagents import ToolError, tool

from ._common import MAX_OUTPUT_CHARS, WorkspaceTool, os_error, truncate_tail

DEFAULT_TIMEOUT = 120
MAX_TIMEOUT = 600


class Bash(WorkspaceTool):
    @tool(name="bash", parallel=False, exception_handler=os_error, open_world=True)
    async def bash(self, command: str, timeout: int = DEFAULT_TIMEOUT) -> str:
        """Run a shell command in the working directory. Return JSON with stdout, stderr, exit_code,
        timed_out and cancelled. A nonzero exit or timeout is an error result, not a successful check.
        Each call starts a fresh shell, so cd and variables do not carry over.

        Args:
            command: The command to run
            timeout: Seconds before the command is killed (default 120, max 600)
        """
        timeout = min(max(timeout, 1), MAX_TIMEOUT)
        process = await asyncio.create_subprocess_shell(
            command,
            cwd=self.workspace.root,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        # Shield communicate so timeout does not discard already collected output.
        collected = asyncio.create_task(process.communicate())
        timed_out = False
        try:
            output, errors = await asyncio.wait_for(asyncio.shield(collected), timeout)
        except TimeoutError:
            timed_out = True
            _kill(process)
            output, errors = await collected
        except asyncio.CancelledError:
            _kill(process)
            await collected
            raise
        stdout = output.decode("utf-8", errors="replace").rstrip()
        stderr = errors.decode("utf-8", errors="replace").rstrip()
        stderr_budget = (
            min(len(stderr), MAX_OUTPUT_CHARS - min(len(stdout), MAX_OUTPUT_CHARS // 2))
            if len(stdout) + len(stderr) > MAX_OUTPUT_CHARS
            else len(stderr)
        )
        result = json.dumps(
            {
                "stdout": truncate_tail(stdout, MAX_OUTPUT_CHARS - stderr_budget),
                "stderr": truncate_tail(stderr, stderr_budget),
                "exit_code": process.returncode,
                "timed_out": timed_out,
                "cancelled": False,
                "message": f"command timed out after {timeout}s" if timed_out else None,
            },
            ensure_ascii=False,
        )
        if timed_out or process.returncode != 0:
            raise ToolError(result)
        return result


def _kill(process: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
