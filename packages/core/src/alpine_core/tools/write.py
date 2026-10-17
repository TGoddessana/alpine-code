from __future__ import annotations

from alpineagents import ToolError, tool

from ._common import WorkspaceTool, json_note, os_error
from ._file_write import atomic_write, file_lock


class Write(WorkspaceTool):
    @tool(name="write", parallel=False, exception_handler=os_error, read_only=False, idempotent=True, open_world=False)
    def write(self, path: str, content: str) -> str:
        """Write a file, replacing it if it exists. Creates missing parent directories.
        Prefer edit for changing part of an existing file.

        Args:
            path: File path, absolute or relative to the working directory
            content: The full new content of the file
        """
        with file_lock(self.workspace.resolve(path)) as file:
            if file.is_dir():
                raise ToolError(f"{path} is a directory")
            existed = file.exists()
            file.parent.mkdir(parents=True, exist_ok=True)
            before = file.read_bytes() if existed else None
            atomic_write(file, content, before)
            lines = content.count("\n") + (0 if content.endswith("\n") or not content else 1)
            verb = "Overwrote" if existed else "Created"
            return f"{verb} {self.workspace.display(file)} ({lines} lines)" + json_note(file, content)
