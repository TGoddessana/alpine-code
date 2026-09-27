from __future__ import annotations

from alpineagents import tool

from ._common import Workspace, error

DEFAULT_LIMIT = 2000
MAX_LINE_CHARS = 2000


class Read:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="read")
    def read(self, path: str, offset: int | None = None, limit: int | None = None) -> str:
        """Read a text file. Returns lines prefixed with their line numbers (starting at 1).

        Args:
            path: File path, absolute or relative to the working directory
            offset: Line number to start from. Use it with limit for large files
            limit: Most lines to read (default 2000)
        """
        file = self.workspace.resolve(path)
        if not file.exists():
            return error(f"{path} does not exist")
        if file.is_dir():
            return error(f"{path} is a directory. Use bash (ls) to list it")
        try:
            data = file.read_bytes()
        except OSError as e:
            return error(str(e))
        if b"\0" in data[:8192]:
            return error(f"{path} looks like a binary file")
        lines = data.decode("utf-8", errors="replace").splitlines()
        if not lines:
            return "(empty file)"

        start = max((offset or 1) - 1, 0)
        end = start + (limit or DEFAULT_LIMIT)
        if start >= len(lines):
            return error(f"offset {offset} is past the end of the file ({len(lines)} lines)")
        width = len(str(min(end, len(lines))))
        out = []
        for number, line in enumerate(lines[start:end], start=start + 1):
            if len(line) > MAX_LINE_CHARS:
                line = line[:MAX_LINE_CHARS] + " [line truncated]"
            out.append(f"{number:>{width}}\t{line}")
        if end < len(lines):
            out.append(f"[{len(lines) - end} more lines. Read on with offset={end + 1}]")
        return "\n".join(out)
