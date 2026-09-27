from __future__ import annotations

import fnmatch
import re
import shutil
import subprocess
from pathlib import Path

from alpineagents import tool

from ._common import IGNORED_DIRS, Workspace, error, walk_files

MAX_MATCHES = 200
MAX_LINE_CHARS = 300


class Grep:
    def __init__(self, workspace: Workspace) -> None:
        self.workspace = workspace

    @tool(name="grep")
    def grep(self, pattern: str, path: str | None = None, glob: str | None = None, ignore_case: bool = False) -> str:
        """Search file contents with a regular expression. Returns matching lines as path:line:text.
        Uses ripgrep when installed (respects .gitignore). Skips dependency and cache directories.

        Args:
            pattern: Regular expression, e.g. "def \\w+_handler" or "TODO"
            path: File or directory to search in (default: the working directory)
            glob: Only search files matching this glob, e.g. "*.py"
            ignore_case: Match without regard to case
        """
        root = self.workspace.resolve(path or ".")
        if not root.exists():
            return error(f"{path} does not exist")
        try:
            re.compile(pattern)
        except re.error as e:
            return error(f"invalid regular expression: {e}")
        rg = shutil.which("rg")
        if rg:
            lines = self._ripgrep(rg, pattern, root, glob, ignore_case)
        else:
            lines = self._python(pattern, root, glob, ignore_case)
        if isinstance(lines, str):
            return lines
        if not lines:
            return f"No matches for {pattern}"
        shown = [line if len(line) <= MAX_LINE_CHARS else line[:MAX_LINE_CHARS] + "…" for line in lines[:MAX_MATCHES]]
        if len(lines) > MAX_MATCHES:
            shown.append(f"[{len(lines) - MAX_MATCHES} more matches. Narrow the pattern, path or glob]")
        return "\n".join(shown)

    def _ripgrep(self, rg: str, pattern: str, root: Path, glob: str | None, ignore_case: bool) -> list[str] | str:
        args = [rg, "--line-number", "--no-heading", "--color=never", "--hidden"]
        for name in sorted(IGNORED_DIRS):
            args += ["--glob", f"!{name}/"]
        if ignore_case:
            args.append("--ignore-case")
        if glob:
            args += ["--glob", glob]
        args += ["--regexp", pattern, str(root)]
        try:
            done = subprocess.run(args, capture_output=True, text=True, timeout=60, cwd=self.workspace.root)
        except subprocess.TimeoutExpired:
            return error("search timed out after 60s. Narrow the path or glob")
        if done.returncode == 2 and not done.stdout:
            return error(done.stderr.strip() or "ripgrep failed")
        return [self._relative(line) for line in done.stdout.splitlines()]

    def _relative(self, line: str) -> str:
        prefix = str(self.workspace.root) + "/"
        return line[len(prefix):] if line.startswith(prefix) else line

    def _python(self, pattern: str, root: Path, glob: str | None, ignore_case: bool) -> list[str]:
        regex = re.compile(pattern, re.IGNORECASE if ignore_case else 0)
        out: list[str] = []
        for file in walk_files(root):
            if glob and not _glob_matches(file, root, glob):
                continue
            try:
                with file.open(encoding="utf-8") as f:
                    for number, text in enumerate(f, start=1):
                        if regex.search(text):
                            out.append(f"{self.workspace.display(file)}:{number}:{text.rstrip()}")
                            if len(out) > MAX_MATCHES:
                                return out
            except (OSError, UnicodeDecodeError):
                continue
        return out


def _glob_matches(file: Path, root: Path, glob: str) -> bool:
    """Like ripgrep's --glob: a pattern without / matches the file name, one with / the path under root."""
    if "/" not in glob:
        return fnmatch.fnmatch(file.name, glob)
    return file.relative_to(root if root.is_dir() else root.parent).full_match(glob)
