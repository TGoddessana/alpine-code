from __future__ import annotations

import re

from alpineagents import tool

from ._common import RG_EXCLUDES, Workspace, error, run_rg

MAX_MATCHES = 200
MAX_LINE_CHARS = 300


class Grep:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="grep")
    def grep(self, pattern: str, path: str | None = None, glob: str | None = None, ignore_case: bool = False) -> str:
        """Search file contents with a regular expression (ripgrep syntax). Returns matching lines as
        path:line:text. Respects .gitignore.

        Args:
            pattern: Regular expression, e.g. "def \\w+_handler" or "TODO"
            path: File or directory to search in (default: the working directory)
            glob: Only search files matching this glob, e.g. "*.py" or "src/**/*.ts"
            ignore_case: Match without regard to case
        """
        target = self.workspace.resolve(path or ".")
        if not target.exists():
            return error(f"{path} does not exist")
        try:
            re.compile(pattern)
        except re.error as e:
            return error(f"invalid regular expression: {e}")
        args = ["--line-number", "--no-heading", "--color=never", "--hidden", *RG_EXCLUDES]
        if ignore_case:
            args.append("--ignore-case")
        if glob:
            args.append(f"--glob={glob}")
        args += ["--regexp", pattern, str(target)]
        lines, failure = run_rg(args, cwd=self.workspace.root)
        if failure:
            return error(failure)
        if not lines:
            return f"No matches for {pattern}"
        prefix = str(self.workspace.root) + "/"
        shown = []
        for line in lines[:MAX_MATCHES]:
            line = line.removeprefix(prefix)
            shown.append(line if len(line) <= MAX_LINE_CHARS else line[:MAX_LINE_CHARS] + "…")
        if len(lines) > MAX_MATCHES:
            shown.append(f"[{len(lines) - MAX_MATCHES} more matches. Narrow the pattern, path or glob]")
        return "\n".join(shown)
