"""Understands a bash command well enough to decide permissions: which commands it runs and whether it writes
files through redirection. Parsed with tree-sitter, so pipelines, lists, subshells and command substitutions are
all seen (``echo $(rm -rf x)`` runs ``rm``)."""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache

import tree_sitter_bash
from tree_sitter import Language, Node, Parser

#: How many leading words (flags not counted) name a command, for "don't ask again" rules. ``git status -s`` is
#: remembered as ``git status``, ``npm run dev`` as ``npm run dev``. Commands not listed use their first word.
ARITY: dict[str, int] = {
    "git": 2, "gh": 3, "hg": 2, "svn": 2,
    "npm": 2, "npm run": 3, "pnpm": 2, "pnpm run": 3, "yarn": 2, "yarn run": 3, "bun": 2, "bun run": 3,
    "npx": 2, "pnpx": 2, "bunx": 2, "deno": 2,
    "uv": 2, "uv run": 3, "uv pip": 3, "uv tool": 3, "uvx": 2, "pip": 2, "pip3": 2, "poetry": 2, "poetry run": 3,
    "pipenv": 2, "hatch": 2, "pdm": 2, "conda": 2, "tox": 1, "nox": 1,
    "cargo": 2, "rustup": 2, "go": 2, "dotnet": 2, "mvn": 2, "gradle": 2, "./gradlew": 2, "swift": 2,
    "make": 2, "just": 2, "cmake": 1, "bazel": 2,
    "docker": 2, "docker compose": 3, "podman": 2, "kubectl": 2, "helm": 2, "terraform": 2,
    "brew": 2, "apt": 2, "apt-get": 2, "ruff": 2, "pre-commit": 2,
}

#: Commands that can run anything they are given (interpreters, shells, wrappers), delete files, or reach the
#: network. A rule like ``python *`` or ``sudo *`` would allow everything, so these are never remembered.
NEVER_REMEMBER = frozenset(
    {
        "bash", "sh", "zsh", "fish", "dash", "ksh", "eval", "exec", "source", ".", "command", "builtin",
        "sudo", "doas", "su", "env", "xargs", "nohup", "time", "timeout", "watch", "nice", "parallel",
        "python", "python3", "node", "ruby", "perl", "php", "lua", "osascript", "powershell", "pwsh",
        "ssh", "scp", "rsync", "curl", "wget", "nc",
        "rm", "rmdir", "dd", "mkfs", "shred", "chmod", "chown", "kill", "killall", "pkill",
    }
)

_WRITE_OPERATORS = {">", ">>", "&>", "&>>", ">|"}
_HARMLESS_TARGETS = {"/dev/null", "/dev/stdout", "/dev/stderr"}


@dataclass(frozen=True)
class Analysis:
    commands: tuple[tuple[str, ...], ...]
    """Each command the script runs, as its words without flags (``git -C x status`` -> ``git x status``)."""
    writes_files: bool
    """A redirection writes to a file (``> out.txt``)."""
    opaque: bool
    """Parts of the script cannot be understood statically: a syntax error, or a command name that is itself an
    expansion (``$CMD args``)."""


@cache
def _parser() -> Parser:
    return Parser(Language(tree_sitter_bash.language()))


def analyze(script: str) -> Analysis:
    tree = _parser().parse(script.encode())
    commands: list[tuple[str, ...]] = []
    state = {"writes": False, "opaque": tree.root_node.has_error}

    def visit(node: Node) -> None:
        if node.type == "command":
            words = _words(node)
            if words is None:
                state["opaque"] = True
            elif words:
                commands.append(words)
        elif node.type == "file_redirect" and _writes(node):
            state["writes"] = True
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return Analysis(tuple(commands), state["writes"], state["opaque"])


def prefix(words: tuple[str, ...]) -> tuple[str, ...]:
    """The words that name a command, by ``ARITY`` (longest listed prefix wins; default one word)."""
    for length in range(len(words), 0, -1):
        arity = ARITY.get(" ".join(words[:length]))
        if arity is not None:
            return words[:arity]
    return words[:1]


def rememberable(rule: tuple[str, ...]) -> bool:
    return bool(rule) and not any(word in NEVER_REMEMBER for word in rule)


def matches(words: tuple[str, ...], rule: tuple[str, ...]) -> bool:
    return words[: len(rule)] == rule


def _words(command: Node) -> tuple[str, ...] | None:
    """The command's words without flags, or ``None`` when its name is not a plain word."""
    words: list[str] = []
    for child in command.children:
        if child.type == "command_name":
            name = child.children[0] if child.children else child
            if name.type != "word":
                return None
            words.append(_text(name))
        elif words and child.type in ("word", "string", "raw_string", "number", "concatenation"):
            text = _unquote(child)
            if not text.startswith("-"):
                words.append(text)
        elif words and child.type in ("simple_expansion", "expansion", "command_substitution"):
            words.append(_text(child))
    return tuple(words)


def _writes(redirect: Node) -> bool:
    operator = next((c for c in redirect.children if c.type in _WRITE_OPERATORS), None)
    if operator is None:
        return False
    target = redirect.child_by_field_name("destination") or redirect.children[-1]
    return _unquote(target) not in _HARMLESS_TARGETS


def _unquote(node: Node) -> str:
    text = _text(node)
    if node.type in ("string", "raw_string") and len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def _text(node: Node) -> str:
    return (node.text or b"").decode(errors="replace")
