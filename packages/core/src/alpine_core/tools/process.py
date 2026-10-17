"""Follow-up tools for handles returned by background bash commands."""

from __future__ import annotations

import json

from alpineagents import ToolError, tool

from alpine_core.cancellation import current_session
from alpine_core.processes import ManagedProcess, process_manager

from ._common import MAX_OUTPUT_CHARS, WorkspaceTool, os_error


class Processes(WorkspaceTool):
    def _visible(self, process: ManagedProcess) -> bool:
        root = self.workspace.root.resolve()
        session = current_session.get()
        return process.cwd.resolve().is_relative_to(root) and (
            session is None or process.session_id is None or process.session_id == session
        )

    def _get(self, process_id: str) -> ManagedProcess:
        try:
            process = process_manager().get(process_id)
        except LookupError as exc:
            raise ToolError("No accessible process with that ID in this workspace/session") from exc
        if not self._visible(process):
            raise ToolError("No accessible process with that ID in this workspace/session")
        return process

    @tool(name="process_list", read_only=True, open_world=False)
    async def process_list(self, offset: int = 0, limit: int = 50) -> str:
        """List managed background jobs and terminals in this workspace/session, including process IDs and status.

        Args:
            offset: Index of the first process to return
            limit: Maximum processes per page (1 to 100)
        """
        if offset < 0 or not 1 <= limit <= 100:
            raise ToolError("offset must be nonnegative and limit must be between 1 and 100")
        processes = [p for p in process_manager().list() if self._visible(p)]
        page = processes[offset : offset + limit]
        return json.dumps(
            dict(processes=[p.snapshot() for p in page], next_offset=offset + len(page), total=len(processes)),
            ensure_ascii=False,
        )

    @tool(name="process_read", read_only=True, open_world=False)
    async def process_read(self, process_id: str, offset: int = 0, limit: int = MAX_OUTPUT_CHARS) -> str:
        """Read one page of a managed process's retained stdout/stderr log and its current status.
        Log offsets are UTF-8 byte positions. Pass next_offset back as offset to continue; logs remain after exit.

        Args:
            process_id: Handle returned by bash(background=True) or process_list
            offset: UTF-8 byte offset; start at 0 for the beginning
            limit: Bytes per page (4 to 30000)
        """
        if offset < 0 or not 4 <= limit <= MAX_OUTPUT_CHARS:
            raise ToolError("offset must be nonnegative and limit must be between 4 and 30000")
        process = self._get(process_id)
        return json.dumps(dict(**process.read(offset, limit), process=process.snapshot()), ensure_ascii=False)

    @tool(name="process_write", parallel=False, exception_handler=os_error, open_world=True, read_only=False)
    async def process_write(self, process_id: str, data: str) -> str:
        """Send input to a running managed process. This can execute commands and requires execution permission.
        Include a trailing newline to submit a line to an interactive shell or input prompt.

        Args:
            process_id: Handle returned by bash(background=True) or process_list
            data: Input text, at most 65536 characters
        """
        if len(data) > 65536:
            raise ToolError("input must be at most 65536 characters")
        process = self._get(process_id)
        try:
            await process.write(data)
        except ValueError as exc:
            raise ToolError(str(exc)) from exc
        return json.dumps(dict(process=process.snapshot()), ensure_ascii=False)

    @tool(name="process_stop", parallel=False, exception_handler=os_error, open_world=True, read_only=False)
    async def process_stop(self, process_id: str, force: bool = False) -> str:
        """Stop a managed process group, preserving its logs. Graceful stop waits briefly;
        status stopping means it has not exited and can be inspected or explicitly force-stopped.

        Args:
            process_id: Handle returned by bash(background=True) or process_list
            force: Immediately kill the process group instead of requesting graceful termination
        """
        process = self._get(process_id)
        await process.stop(force=force)
        return json.dumps(dict(process=process.snapshot()), ensure_ascii=False)
