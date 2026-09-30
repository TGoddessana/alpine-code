from __future__ import annotations

from alpineagents import ToolError, tool

from ._common import RG_EXCLUDES, WorkspaceTool, run_rg

MAX_RESULTS = 200


class Glob(WorkspaceTool):
    @tool(name="glob", read_only=True, open_world=False)
    def glob(self, pattern: str, path: str | None = None) -> str:
        """Find files by name pattern, like "*.py" (any depth), "src/**/test_*.ts" or "**/package.json".
        Returns paths, most recently modified first. Respects .gitignore.

        Args:
            pattern: Glob pattern. A pattern without / matches file names at any depth
            path: Directory to search in (default: the working directory)
        """
        root = self.workspace.resolve(path or ".")
        if not root.is_dir():
            raise ToolError(f"{path} is not a directory")
        args = ["--files", "--hidden", "--sortr=modified", f"--glob={pattern}", *RG_EXCLUDES]
        lines = run_rg(args, cwd=root)
        if not lines:
            return f"No files match {pattern}"
        shown = [self.workspace.display(root / line) for line in lines[:MAX_RESULTS]]
        if len(lines) > MAX_RESULTS:
            shown.append(f"[{len(lines) - MAX_RESULTS} more files. Use a narrower pattern or path]")
        return "\n".join(shown)
