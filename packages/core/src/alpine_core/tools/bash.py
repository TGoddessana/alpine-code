from __future__ import annotations

import asyncio
import json

from alpineagents import ToolError, tool

from alpine_core.processes import process_manager

from ._common import MAX_OUTPUT_CHARS, WorkspaceTool, os_error, truncate_tail

DEFAULT_TIMEOUT = 120
MAX_TIMEOUT = 600


class Bash(WorkspaceTool):
    @tool(name="bash", parallel=False, exception_handler=os_error, open_world=True)
    async def bash(self, command: str, timeout: int = DEFAULT_TIMEOUT, background: bool = False) -> str:
        """Run a shell command in the working directory. Return JSON with stdout, stderr, exit_code,
        timed_out and cancelled. A nonzero exit or timeout is an error result, not a successful check.
        Each call starts a fresh shell, so cd and variables do not carry over.
        With background=True, return a managed process handle immediately for servers or long jobs.
        Use process_read to inspect retained logs/status, process_write for input, and process_stop to stop it.
        A background launch confirms only that the process started; inspect its status/output before claiming success.

        Args:
            command: The command to run
            timeout: Seconds before a foreground command is killed (default 120, max 600)
            background: Keep running beyond this call; no command timeout, explicit process_stop or session stop ends it
        """
        timeout = min(max(timeout, 1), MAX_TIMEOUT)
        process = await process_manager().start(command, self.workspace.root, pty=False)
        if background:
            return json.dumps(
                {"process_id": process.id, "process": process.snapshot(), "background": True}, ensure_ascii=False
            )
        timed_out = False
        try:
            await asyncio.wait_for(process.wait(), timeout)
        except TimeoutError:
            timed_out = True
            await process.stop(force=True)
            await process.wait()
            # A timeout is an execution failure; it was not a user's cancellation.
            process.cancelled = False
            process.status = "failed"
        except asyncio.CancelledError:
            # Preserve the log and leave uncooperative children visible for explicit escalation.
            await process.stop()
            raise
        stdout = process.output("stdout").rstrip()
        stderr = process.output("stderr").rstrip()
        stderr_budget = (
            min(len(stderr), MAX_OUTPUT_CHARS - min(len(stdout), MAX_OUTPUT_CHARS // 2))
            if len(stdout) + len(stderr) > MAX_OUTPUT_CHARS
            else len(stderr)
        )
        result = json.dumps(
            {
                "stdout": truncate_tail(stdout, MAX_OUTPUT_CHARS - stderr_budget),
                "stderr": truncate_tail(stderr, stderr_budget),
                "exit_code": process.process.returncode,
                "timed_out": timed_out,
                "cancelled": process.cancelled,
                "process_id": process.id,
                "message": f"command timed out after {timeout}s" if timed_out else None,
            },
            ensure_ascii=False,
        )
        if timed_out or process.cancelled or process.process.returncode != 0:
            raise ToolError(result)
        return result
