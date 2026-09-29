"""Understands a bash command well enough to decide permissions: which commands it runs, which paths it touches,
and whether it writes files through redirection. Parsed with tree-sitter, so pipelines, lists, subshells and
command substitutions are all seen (``echo $(rm -rf x)`` runs ``rm``)."""

from __future__ import annotations

import posixpath
import re
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
_DEVICES = {"/dev/null", "/dev/stdin", "/dev/stdout", "/dev/stderr", "/dev/tty", "-"}
_ARGUMENTS = ("word", "string", "raw_string", "number", "concatenation", "simple_expansion", "expansion",
              "command_substitution", "process_substitution", "arithmetic_expansion")
_DYNAMIC = ("simple_expansion", "expansion", "command_substitution", "process_substitution", "arithmetic_expansion")
_URL = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://")
_GLOB = re.compile(r"[*?\[]")


@dataclass(frozen=True)
class Analysis:
    commands: tuple[tuple[str, ...], ...]
    """Each command the script runs, as its words without flags (``git -C x status`` -> ``git x status``)."""
    writes_files: bool
    """A redirection writes to a file (``> out.txt``)."""
    opaque: bool
    """Parts of the script cannot be understood statically: a syntax error, or a command name that is itself an
    expansion (``$CMD args``)."""
    paths: tuple[str, ...] = ()
    """Path-like arguments and redirection targets, joined onto the directory earlier ``cd`` commands moved to.
    Relative ones are relative to the directory the script starts in; ``~`` is not expanded yet."""
    unresolved_paths: tuple[str, ...] = ()
    """Path-like arguments whose value is only known at run time (``$HOME/.ssh``), or relative paths after a
    ``cd`` whose target is unknown."""


@cache
def _parser() -> Parser:
    return Parser(Language(tree_sitter_bash.language()))


def analyze(script: str) -> Analysis:
    tree = _parser().parse(script.encode())
    paths = _PathCollector()
    commands: list[tuple[str, ...]] = []
    state = {"writes": False, "opaque": tree.root_node.has_error}

    def visit(node: Node) -> None:
        # Pre-order, so commands are seen in the order they appear and cd affects the paths after it.
        if node.type == "command":
            words = _words(node)
            if words is None:
                state["opaque"] = True
            elif words:
                commands.append(words)
            paths.command(node)
        elif node.type == "file_redirect":
            if _writes(node):
                state["writes"] = True
            target = _destination(node)
            if target is not None:
                paths.argument(target)
        for child in node.children:
            visit(child)

    visit(tree.root_node)
    return Analysis(tuple(commands), state["writes"], state["opaque"], tuple(paths.paths), tuple(paths.unresolved))


class _PathCollector:
    """Collects the paths commands touch, following ``cd`` so relative paths are joined onto where the script is."""

    def __init__(self) -> None:
        self.cwd: str | None = ""
        """Where earlier cd commands moved to, relative to the start ("" = the start). ``None``: unknown."""
        self.paths: list[str] = []
        self.unresolved: list[str] = []

    def command(self, command: Node) -> None:
        name_node = next((c for c in command.children if c.type == "command_name"), None)
        name = _literal(name_node.children[0]) if name_node is not None and name_node.children else None
        if name and (name.startswith("~") or ("/" in name and not name.startswith("/"))):
            self._add(name)  # a script run by path: ./run.sh, ../other/run.sh, ~/bin/deploy
        args = [c for c in command.children if c.type in _ARGUMENTS]
        for arg in args:
            self.argument(arg)
        if name in ("cd", "pushd"):
            self._cd(next((a for a in args if not _is_flag(_literal(a))), None))

    def argument(self, node: Node) -> None:
        value = _literal(node)
        if value is None:
            text = _text(node)
            if _path_like(text):
                self.unresolved.append(text)
            return
        if value.startswith("-") and "=" in value:
            value = value.split("=", 1)[1]  # --output=/etc/x
        elif value.startswith("-"):
            return
        if _path_like(value):
            self._add(value)

    def _add(self, value: str) -> None:
        match = _GLOB.search(value)
        if match:
            value = value[: match.start()] or "."
        if value in _DEVICES:
            return
        if value.startswith(("/", "~")):
            self.paths.append(value)
        elif self.cwd is None:
            self.unresolved.append(value)
        else:
            self.paths.append(posixpath.join(self.cwd, value) if self.cwd else value)

    def _cd(self, target: Node | None) -> None:
        value = "~" if target is None else _literal(target)  # a bare cd goes home
        if value is None or value == "-":
            self.unresolved.append("cd " + (_text(target) if target is not None else ""))
            self.cwd = None
            return
        if target is None or not _path_like(value):
            self._add(value)  # "cd" and "cd sub" are not path-like arguments, but still where the script goes
        if value.startswith(("/", "~")):
            self.cwd = value
        elif self.cwd is not None:
            self.cwd = posixpath.join(self.cwd, value) if self.cwd else value


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
    target = _destination(redirect)
    return target is None or _literal(target) not in _DEVICES


def _destination(redirect: Node) -> Node | None:
    """The file a redirection reads or writes; ``None`` for ``2>&1`` and the like."""
    if any(c.type in (">&", "<&", ">&-", "<&-") for c in redirect.children):
        return None
    target = redirect.child_by_field_name("destination") or redirect.children[-1]
    return target if target.type in _ARGUMENTS else None


def _literal(node: Node) -> str | None:
    """The value bash gives this argument, or ``None`` when it depends on expansions. Single quotes are literal,
    so ``'$1/2'`` has a value."""
    if node.type in _DYNAMIC:
        return None
    if node.type == "raw_string":
        return _unquote(node)
    if node.type == "string":
        if any(c.type in _DYNAMIC for c in node.children):
            return None
        return _unquote(node)
    if node.type == "concatenation":
        parts = [_literal(c) for c in node.children]
        return None if any(p is None for p in parts) else "".join(p for p in parts if p is not None)
    text = _text(node)
    return None if "`" in text else text


def _is_flag(value: str | None) -> bool:
    """``-L``, ``--foo``; not ``-`` alone (``cd -`` goes back to the previous directory)."""
    return value is not None and value.startswith("-") and value != "-"


def _path_like(text: str) -> bool:
    if _URL.match(text):
        return False
    return text.startswith(("/", "~", ".")) or "/" in text  # "." also catches dotfiles like .env


def _unquote(node: Node) -> str:
    text = _text(node)
    if node.type in ("string", "raw_string") and len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    return text


def _text(node: Node) -> str:
    return (node.text or b"").decode(errors="replace")
