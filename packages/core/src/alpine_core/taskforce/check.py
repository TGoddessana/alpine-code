"""Checks a script before it runs, for the model's sake: a script must make the same calls when it runs again, so a
rerun can reuse finished agents (decision 8). Not a safety check: the sandbox is (decision 1)."""

from __future__ import annotations

import ast

#: Modules a script may import: they compute and never ask the clock, chance or the outside world.
ALLOWED_IMPORTS = frozenset(
    {
        "bisect",
        "collections",
        "copy",
        "dataclasses",
        "decimal",
        "difflib",
        "enum",
        "fractions",
        "functools",
        "heapq",
        "itertools",
        "json",
        "math",
        "operator",
        "re",
        "statistics",
        "string",
        "textwrap",
        "typing",
    }
)

#: Names the worker provides; the script must not define them over.
API = frozenset({"agent", "parallel", "pipeline", "phase", "log", "budget", "args"})


#: Calls that need what the sandbox refuses, or would run code the check never saw.
_UNAVAILABLE = frozenset({"open", "exec", "eval", "compile", "__import__"})


class ScriptError(ValueError):
    """What is wrong with a script, in sentences the model can act on."""


def check_script(source: str) -> None:
    """Raises ``ScriptError`` with every problem found."""
    try:
        tree = compile(source, "<script>", "exec", flags=ast.PyCF_ONLY_AST | ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    except SyntaxError as e:
        raise ScriptError(f"line {e.lineno}: {e.msg}") from e
    problems: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import | ast.ImportFrom):
            names = [alias.name for alias in node.names] if isinstance(node, ast.Import) else [node.module or ""]
            for name in names:
                if name.split(".")[0] not in ALLOWED_IMPORTS:
                    problems.append(
                        f"line {node.lineno}: `import {name}` is not available. A script only plans and combines: "
                        "reading files, running commands and fetching pages are agents' work (agent()). Allowed: "
                        + ", ".join(sorted(ALLOWED_IMPORTS))
                    )
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) and node.name in API:
            problems.append(f"line {node.lineno}: `{node.name}` is one of the script's built-in names")
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and node.id in API:
            problems.append(f"line {node.lineno}: `{node.id}` is one of the script's built-in names")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _UNAVAILABLE:
            problems.append(f"line {node.lineno}: `{node.func.id}()` is not available in a script")
    if not any(_calls_agent(node) for node in ast.walk(tree)):
        problems.append("the script never calls agent(): it has nothing to hand out")
    if problems:
        raise ScriptError("\n".join(problems))


def _calls_agent(node: ast.AST) -> bool:
    return isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "agent"
