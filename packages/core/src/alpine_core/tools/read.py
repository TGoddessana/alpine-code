from __future__ import annotations

from pathlib import Path

from alpineagents import Image, ToolError, tool

from ._common import WorkspaceTool, os_error

DEFAULT_LIMIT = 2000
MAX_LINE_CHARS = 2000
MAX_ENTRIES = 500
#: Largest image sent to the model, base64-encoded. Anthropic rejects images over 5MB.
MAX_IMAGE_BYTES = 5 * 1024 * 1024


class Read(WorkspaceTool):
    @tool(name="read", exception_handler=os_error, read_only=True, open_world=False)
    def read(self, path: str, offset: int | None = None, limit: int | None = None) -> str | Image:
        """Read a text file, view an image (PNG, JPEG, GIF, WebP) or list a directory. File lines are prefixed
        with their line numbers (starting at 1). A directory gives one entry per line, with / after subdirectories.

        Args:
            path: File or directory path, absolute or relative to the working directory
            offset: Line number to start from. Use it with limit for large files
            limit: Most lines to read (default 2000)
        """
        file = self.workspace.resolve(path)
        if not file.exists():
            raise ToolError(f"{path} does not exist")
        if file.is_dir():
            return list_directory(file)
        data = file.read_bytes()
        image = as_image(data)
        if image is not None:
            encoded = (len(data) + 2) // 3 * 4
            if encoded > MAX_IMAGE_BYTES:
                raise ToolError(
                    f"{path} is too large to view ({encoded / 1024 / 1024:.1f}MB encoded, the limit is 5MB). "
                    "Make a smaller copy with bash first"
                )
            return image
        if b"\0" in data[:8192]:
            raise ToolError(f"{path} looks like a binary file")
        return number_lines(data.decode("utf-8", errors="replace").splitlines(), offset, limit)


def number_lines(lines: list[str], offset: int | None, limit: int | None) -> str:
    """``limit`` lines from line ``offset`` on, each prefixed with its number and a tab."""
    if not lines:
        return "(empty file)"
    start = max((offset or 1) - 1, 0)
    end = start + (limit or DEFAULT_LIMIT)
    if start >= len(lines):
        raise ToolError(f"offset {offset} is past the end of the file ({len(lines)} lines)")
    width = len(str(min(end, len(lines))))
    out = []
    for number, line in enumerate(lines[start:end], start=start + 1):
        if len(line) > MAX_LINE_CHARS:
            line = line[:MAX_LINE_CHARS] + " [line truncated]"
        out.append(f"{number:>{width}}\t{line}")
    if end < len(lines):
        out.append(f"[{len(lines) - end} more lines. Read on with offset={end + 1}]")
    return "\n".join(out)


def as_image(data: bytes) -> Image | None:
    """``data`` as an image the model can see, or ``None`` when it is not a PNG, JPEG, GIF or WebP file."""
    try:
        return Image(data)
    except ValueError:
        return None


def list_directory(directory: Path) -> str:
    entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    if not entries:
        return "(empty directory)"
    lines = [f"{e.name}/" if e.is_dir() else e.name for e in entries[:MAX_ENTRIES]]
    if len(entries) > MAX_ENTRIES:
        lines.append(f"[{len(entries) - MAX_ENTRIES} more entries]")
    return "\n".join(lines)
