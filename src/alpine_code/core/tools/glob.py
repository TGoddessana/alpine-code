from __future__ import annotations

from alpineagents import tool

from ._common import Workspace, error, walk_files

MAX_RESULTS = 200


class Glob:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="glob")
    def glob(self, pattern: str, path: str | None = None) -> str:
        """Find files by name pattern, like "**/*.py" or "src/**/test_*.ts". Returns paths, most recently
        modified first. Skips dependency and cache directories.

        Args:
            pattern: Glob pattern. ** matches any number of directories
            path: Directory to search in (default: the working directory)
        """
        root = self.workspace.resolve(path or ".")
        if not root.is_dir():
            return error(f"{path} is not a directory")
        matches = []
        for file in walk_files(root):
            relative = file.relative_to(root)
            if relative.full_match(pattern):
                try:
                    matches.append((file.stat().st_mtime, file))
                except OSError:
                    continue
        if not matches:
            return f"No files match {pattern}"
        matches.sort(key=lambda m: m[0], reverse=True)
        lines = [self.workspace.display(file) for _, file in matches[:MAX_RESULTS]]
        if len(matches) > MAX_RESULTS:
            lines.append(f"[{len(matches) - MAX_RESULTS} more files. Use a narrower pattern]")
        return "\n".join(lines)
