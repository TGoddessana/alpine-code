from __future__ import annotations

from alpineagents import tool

from ._common import Workspace, error


class Edit:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="edit")
    def edit(self, path: str, old_string: str, new_string: str, replace_all: bool = False) -> str:
        """Replace an exact piece of text in a file. Read the file first.

        old_string must match the file exactly, including indentation, and appear only once unless
        replace_all is true. Include enough surrounding lines to make it unique.

        Args:
            path: File path, absolute or relative to the working directory
            old_string: The exact text to replace
            new_string: The text to put in its place
            replace_all: Replace every occurrence instead of exactly one
        """
        file = self.workspace.resolve(path)
        if not file.is_file():
            return error(f"{path} does not exist. Use write to create a file")
        if old_string == new_string:
            return error("old_string and new_string are the same")
        if not old_string:
            return error("old_string is empty. Use write to create or replace a whole file")
        try:
            text = file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as e:
            return error(str(e))
        count = text.count(old_string)
        if count == 0:
            return error(f"old_string was not found in {path}. Read the file and copy the text exactly")
        if count > 1 and not replace_all:
            return error(
                f"old_string appears {count} times in {path}. Add surrounding lines to make it unique, "
                "or set replace_all to true"
            )
        new_text = text.replace(old_string, new_string) if replace_all else text.replace(old_string, new_string, 1)
        try:
            file.write_text(new_text, encoding="utf-8")
        except OSError as e:
            return error(str(e))
        times = f"{count} occurrences" if replace_all and count > 1 else "1 occurrence"
        return f"Edited {self.workspace.display(file)} ({times} replaced)"


def preview_edit(workspace: Workspace, args: dict) -> tuple[str, str] | None:
    """``(before, after)`` file contents an edit call would produce, or ``None`` if it would fail."""
    file = workspace.resolve(str(args.get("path", "")))
    old, new = args.get("old_string"), args.get("new_string")
    if not file.is_file() or not isinstance(old, str) or not isinstance(new, str) or not old:
        return None
    before = file.read_text(encoding="utf-8", errors="replace")
    if old not in before:
        return None
    after = before.replace(old, new) if args.get("replace_all") else before.replace(old, new, 1)
    return before, after
