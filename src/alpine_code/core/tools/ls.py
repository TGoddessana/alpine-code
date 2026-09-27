from __future__ import annotations

from alpineagents import tool

from ._common import IGNORED_DIRS, Workspace, error

MAX_ENTRIES = 500


class Ls:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="ls")
    def ls(self, path: str = ".") -> str:
        """List a directory. Directories end with /. Dependency and cache directories (node_modules, .venv,
        .git, ...) are listed but not descended into by the other search tools.

        Args:
            path: Directory path, absolute or relative to the working directory
        """
        directory = self.workspace.resolve(path)
        if not directory.exists():
            return error(f"{path} does not exist")
        if not directory.is_dir():
            return error(f"{path} is a file. Use read to read it")
        try:
            entries = sorted(directory.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError as e:
            return error(str(e))
        if not entries:
            return "(empty directory)"
        lines = []
        for entry in entries[:MAX_ENTRIES]:
            if entry.is_dir():
                note = "  (skipped by glob/grep)" if entry.name in IGNORED_DIRS else ""
                lines.append(f"{entry.name}/{note}")
            else:
                lines.append(entry.name)
        if len(entries) > MAX_ENTRIES:
            lines.append(f"[{len(entries) - MAX_ENTRIES} more entries]")
        return "\n".join(lines)
