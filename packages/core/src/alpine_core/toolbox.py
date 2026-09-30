"""Tools the user writes: Python files in the home folder whose ``@tool`` functions join the agent's tools.

Each file in ``~/.alpine-code/tools/`` is imported in this process, and the ``Tool`` objects it defines are given to
``Agent(tools=...)`` as they are, so everything alpineagents offers (``state: State``, ``hints_for``, images) works.

Only what the user saved through the app runs. ``save`` records the file's SHA-256 in ``tools.json``; a file whose
content does not match (changed by an editor, by ``bash``, or new) is ``unconfirmed`` and is not imported until
``confirm``. The recorded content is what gets executed: the bytes are hashed and compiled from the same read.

Packages come from the file's inline script metadata (PEP 723)::

    # /// script
    # dependencies = ["httpx"]
    # ///

Packages on the reviewed list install when needed. Any other package must be approved first (``install``), which
the app asks as a risky action. Only wheels are installed (no build scripts), into ``tools/.packages``, pinned to the
versions this process already uses so a tool cannot swap a package out from under the app.
"""

from __future__ import annotations

import contextlib
import difflib
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import types
import urllib.request
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any, Literal

import tomllib
from alpineagents import Agent, AlpineAgentsError, State, Tool
from alpineagents.tool import collect_tools, format_result

from .config import Settings
from .home import home_dir
from .models import make_model
from .permissions import kind_of
from .tools import Workspace, default_tools

#: Names of the built-in tools, which a user tool may not take.
BUILTIN = ("read", "glob", "grep", "write", "edit", "bash")

#: Packages Alpine has reviewed: installed without asking. Normalized names (PEP 503).
REVIEWED = frozenset(
    {
        "beautifulsoup4",
        "feedparser",
        "html2text",
        "httpx",
        "lxml",
        "markdown",
        "numpy",
        "openpyxl",
        "pandas",
        "pillow",
        "pydantic",
        "pypdf",
        "python-dateutil",
        "python-docx",
        "pyyaml",
        "requests",
        "tabulate",
        "xlrd",
    }
)

#: Longest a test run may take before the app stops waiting for it.
TEST_TIMEOUT = 30.0

FileStatus = Literal["ready", "unconfirmed", "error"]
Ask = Literal["never", "edit", "ask"]
"""When a call asks, from the tool's hints: ``never`` (reads local files), ``edit`` (as editing files) or ``ask``."""

_SCRIPT_BLOCK = re.compile(r"(?m)^# /// (?P<type>[a-zA-Z0-9-]+)$\s(?P<content>(^#(| .*)$\s)+)^# ///$")
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*")
_FILE_NAME = re.compile(r"^[a-z_][a-z0-9_]{0,63}$")


class DraftError(Exception):
    """The model could not write a draft; the message says why."""


class ToolboxError(Exception):
    """A tool file cannot be saved or checked; the message says why."""

    def __init__(self, message: str, reason: str = "tool_error") -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class Param:
    name: str
    type: str
    """The JSON Schema type, e.g. ``string``."""
    description: str
    required: bool
    default: Any = None


@dataclass(frozen=True)
class ToolSummary:
    """A tool as the model sees it, and when calling it asks."""

    name: str
    description: str
    params: tuple[Param, ...]
    read_only: bool
    open_world: bool
    ask: Ask


@dataclass(frozen=True)
class ToolFile:
    """One file in the tools folder."""

    name: str
    """The file name without ``.py``."""
    status: FileStatus
    error: str | None = None
    """Why an ``error`` file cannot be loaded."""
    missing_package: str | None = None
    """A module the file imports that is not installed."""
    changed_at: str | None = None
    """UTC, ISO 8601: when the file last changed on disk."""
    tools: tuple[ToolSummary, ...] = ()
    packages: tuple[str, ...] = ()


@dataclass(frozen=True)
class PackageInfo:
    """What the approval of an unreviewed package shows."""

    name: str
    first_release: str | None = None
    """``YYYY-MM`` of the first upload to PyPI; ``None`` if unknown."""
    last_month_downloads: int | None = None
    similar: tuple[str, ...] = ()
    """Reviewed packages with a look-alike name (``reqeusts`` → ``requests``)."""


@dataclass(frozen=True)
class Check:
    """An unsaved source, loaded: its tools, or why it cannot load, or the packages to approve first."""

    tools: tuple[ToolSummary, ...] = ()
    packages: tuple[str, ...] = ()
    error: str | None = None
    missing_package: str | None = None
    needs_approval: tuple[PackageInfo, ...] = ()


@dataclass(frozen=True)
class TestResult:
    ok: bool
    output: str
    seconds: float


@dataclass
class _Loaded:
    sha: str
    tools: dict[str, Tool] = field(default_factory=dict)
    error: str | None = None
    missing_package: str | None = None


class Toolbox:
    """The user's tool files in ``home/tools``, what was approved in ``home/tools.json``."""

    def __init__(self, home: Path | None = None) -> None:
        self.home = home or home_dir()
        self.folder = self.home / "tools"
        self.packages_dir = self.folder / ".packages"
        self._record = self.home / "tools.json"
        self._lock = threading.Lock()
        self._cache: dict[str, _Loaded] = {}

    # ------------------------------------------------------------ reading

    def list(self) -> list[ToolFile]:
        """Every tool file, by name."""
        return [self._describe(path) for path in self._files()]

    def source(self, name: str) -> str:
        """The file's text.

        Raises:
            LookupError: There is no such file.
        """
        path = self._path(name)
        if not path.is_file():
            raise LookupError(name)
        return path.read_text("utf-8")

    def load(self, names: Iterable[str]) -> list[Tool]:
        """The tools with these names from the ready files, for a new session. Unknown names are skipped."""
        wanted = set(names)
        found: list[Tool] = []
        for path in self._files():
            loaded = self._load_saved(path)
            if loaded is None:
                continue
            found += [tool for name, tool in loaded.tools.items() if name in wanted]
        return found

    # ------------------------------------------------------------ changing

    def check(self, source: str) -> Check:
        """Loads ``source`` without saving it: the tools it defines, as the model will see them. Installs missing
        reviewed packages first; unreviewed ones that were never approved come back in ``needs_approval`` and
        nothing is loaded. This runs the code, like saving does."""
        packages = dependencies(source)
        pending = self._unapproved(packages)
        if pending:
            return Check(packages=packages, needs_approval=tuple(package_info(name) for name in pending))
        self._install(packages)
        loaded = self._execute(source, "alpine_user_tool_check", "<check>")
        return Check(
            tools=tuple(summarize(tool) for tool in loaded.tools.values()),
            packages=packages,
            error=loaded.error,
            missing_package=loaded.missing_package,
        )

    def save(self, name: str, source: str) -> ToolFile:
        """Writes ``tools/<name>.py`` and marks this content as the user's. Installs its packages first.

        Raises:
            ToolboxError: The name is not a valid file name (``invalid_name``), a package needs approval
                (``package_not_approved``), a package failed to install (``install_failed``), or a tool takes the
                name of a built-in tool or of a tool in another file (``name_taken``).
        """
        if not _FILE_NAME.fullmatch(name):
            raise ToolboxError("Use lowercase letters, digits and _ for the file name", "invalid_name")
        packages = dependencies(source)
        pending = self._unapproved(packages)
        if pending:
            raise ToolboxError("Approve these packages first: " + ", ".join(pending), "package_not_approved")
        self._install(packages)
        loaded = self._execute(source, f"alpine_user_tool_{name}_check", "<check>")
        taken = self._taken_names(exclude=name)
        clash = sorted(set(loaded.tools) & taken)
        if clash:
            raise ToolboxError("These tool names are taken: " + ", ".join(clash), "name_taken")
        data = source.encode("utf-8")
        with self._lock:
            self.folder.mkdir(parents=True, exist_ok=True)
            _write_atomic(self._path(name), data)
            record = self._read_record()
            record.setdefault("files", {})[name] = _sha(data)
            self._write_record(record)
        return self._describe(self._path(name))

    def confirm(self, name: str) -> ToolFile:
        """Marks the file's current content as the user's, after they looked at what changed.

        Raises:
            LookupError: There is no such file.
        """
        path = self._path(name)
        if not path.is_file():
            raise LookupError(name)
        with self._lock:
            record = self._read_record()
            record.setdefault("files", {})[name] = _sha(path.read_bytes())
            self._write_record(record)
        return self._describe(path)

    def delete(self, name: str) -> None:
        """Removes the file and its record. Does nothing if there is none."""
        with self._lock:
            self._path(name).unlink(missing_ok=True)
            record = self._read_record()
            record.get("files", {}).pop(name, None)
            self._write_record(record)

    def install(self, packages: Iterable[str]) -> None:
        """Approves and installs packages, reviewed or not.

        Raises:
            ToolboxError: ``install_failed``.
        """
        names = [normalize(p) for p in packages]
        self._install(names, approve=True)

    def test(self, source: str, tool_name: str, args: dict[str, Any]) -> TestResult:
        """Runs one tool of ``source`` once with ``args``, as the agent would. Waits at most ``TEST_TIMEOUT``."""
        started = time.monotonic()
        loaded = self._execute(source, "alpine_user_tool_test", "<test>")
        if loaded.error:
            return TestResult(False, loaded.error, time.monotonic() - started)
        tool = loaded.tools.get(tool_name)
        if tool is None:
            return TestResult(False, f"No tool named {tool_name}", time.monotonic() - started)
        outcome: dict[str, Any] = {}

        def target() -> None:
            try:
                value = tool.run(args, State("test"))
                if tool.is_async:
                    import asyncio

                    value = asyncio.run(value)
                outcome["value"] = format_result(value)
            except BaseException as e:  # the tool's own failure is the result
                outcome["error"] = f"{type(e).__name__}: {e}"

        worker = threading.Thread(target=target, name="alpine-tool-test", daemon=True)
        worker.start()
        worker.join(TEST_TIMEOUT)
        seconds = time.monotonic() - started
        if worker.is_alive():
            return TestResult(False, f"Still running after {TEST_TIMEOUT:.0f}s", seconds)
        if "error" in outcome:
            return TestResult(False, outcome["error"], seconds)
        return TestResult(True, _as_text(outcome["value"]), seconds)

    # ------------------------------------------------------------ internals

    def _files(self) -> list[Path]:
        if not self.folder.is_dir():
            return []
        return sorted(p for p in self.folder.glob("*.py") if _FILE_NAME.fullmatch(p.stem))

    def _path(self, name: str) -> Path:
        if not _FILE_NAME.fullmatch(name):
            raise LookupError(name)
        return self.folder / f"{name}.py"

    def _describe(self, path: Path) -> ToolFile:
        data = path.read_bytes()
        changed = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
        packages = dependencies(data.decode("utf-8", errors="replace"))
        if self._read_record().get("files", {}).get(path.stem) != _sha(data):
            return ToolFile(path.stem, "unconfirmed", changed_at=changed, packages=packages)
        loaded = self._load_saved(path)
        assert loaded is not None
        if loaded.error:
            return ToolFile(
                path.stem,
                "error",
                error=loaded.error,
                missing_package=loaded.missing_package,
                changed_at=changed,
                packages=packages,
            )
        return ToolFile(
            path.stem,
            "ready",
            changed_at=changed,
            tools=tuple(summarize(t) for t in loaded.tools.values()),
            packages=packages,
        )

    def _load_saved(self, path: Path) -> _Loaded | None:
        """The file's tools, if its content is the one the user saved. Loaded once per content."""
        data = path.read_bytes()
        sha = _sha(data)
        if self._read_record().get("files", {}).get(path.stem) != sha:
            return None
        with self._lock:
            cached = self._cache.get(path.stem)
            if cached is not None and cached.sha == sha:
                return cached
        loaded = self._execute(data.decode("utf-8"), f"alpine_user_tools.{path.stem}_{sha[:12]}", str(path))
        with self._lock:
            self._cache[path.stem] = loaded
        return loaded

    def _execute(self, source: str, module_name: str, filename: str) -> _Loaded:
        """Runs ``source`` as a new module and collects its tools. Failures become ``error``, never exceptions."""
        loaded = _Loaded(_sha(source.encode("utf-8")))
        self._add_packages_to_path()
        try:
            code = compile(source, filename, "exec", dont_inherit=True)
        except SyntaxError as e:
            loaded.error = f"Line {e.lineno}: {e.msg}"
            return loaded
        module = types.ModuleType(module_name)
        module.__file__ = filename
        sys.modules[module_name] = module
        try:
            exec(code, module.__dict__)
            tools = collect_tools(v for v in vars(module).values() if isinstance(v, Tool))
        except ModuleNotFoundError as e:
            loaded.error = f"The package for {e.name} is not installed. Add it to the dependencies at the top"
            loaded.missing_package = e.name
            return loaded
        except BaseException as e:  # the user's code: any failure is a message, even SystemExit
            loaded.error = _error_text(e, filename)
            return loaded
        finally:
            if module_name.endswith("_check") or module_name.endswith("_test"):
                sys.modules.pop(module_name, None)
        clash = sorted(set(tools) & set(BUILTIN))
        if clash:
            loaded.error = "These names are taken by built-in tools: " + ", ".join(clash)
            return loaded
        loaded.tools = tools
        return loaded

    def _taken_names(self, *, exclude: str) -> set[str]:
        taken = set(BUILTIN)
        for path in self._files():
            if path.stem == exclude:
                continue
            loaded = self._load_saved(path)
            if loaded is not None:
                taken |= set(loaded.tools)
        return taken

    def _unapproved(self, packages: Iterable[str]) -> list[str]:
        approved = set(self._read_record().get("packages", []))
        return [p for p in packages if p not in REVIEWED and p not in approved]

    def _install(self, packages: Iterable[str], *, approve: bool = False) -> None:
        names = list(dict.fromkeys(packages))
        if approve:
            with self._lock:
                record = self._read_record()
                record["packages"] = sorted(set(record.get("packages", [])) | set(names))
                self._write_record(record)
        missing = [n for n in names if not _installed(n, self.packages_dir)]
        if not missing:
            return
        uv = shutil.which("uv")
        if uv is None:
            raise ToolboxError("uv is not installed, so packages cannot be installed", "install_failed")
        self.packages_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as constraints:
            constraints.write(_constraints())
        try:
            done = subprocess.run(
                [
                    uv,
                    "pip",
                    "install",
                    "--quiet",
                    "--python",
                    sys.executable,
                    "--target",
                    str(self.packages_dir),
                    "--only-binary",
                    ":all:",
                    "--constraint",
                    constraints.name,
                    *missing,
                ],
                capture_output=True,
                text=True,
                timeout=300,
            )
        except (OSError, subprocess.TimeoutExpired) as e:
            raise ToolboxError(f"Installing {', '.join(missing)} failed: {e}", "install_failed") from e
        finally:
            Path(constraints.name).unlink(missing_ok=True)
        if done.returncode != 0:
            message = done.stderr.strip().splitlines()[-1] if done.stderr.strip() else "uv failed"
            raise ToolboxError(f"Installing {', '.join(missing)} failed: {message}", "install_failed")

    def _add_packages_to_path(self) -> None:
        """The packages folder goes last on ``sys.path``, so the app's own packages always win."""
        folder = str(self.packages_dir)
        if folder not in sys.path:
            sys.path.append(folder)

    def _read_record(self) -> dict[str, Any]:
        try:
            data = json.loads(self._record.read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def _write_record(self, record: dict[str, Any]) -> None:
        self.home.mkdir(parents=True, exist_ok=True)
        _write_atomic(self._record, json.dumps(record, indent=2, sort_keys=True).encode("utf-8"))


def builtin_summaries() -> list[ToolSummary]:
    """The built-in tools, described like user tools."""
    return [summarize(t) for t in collect_tools(default_tools(Workspace(Path.home()))).values()]


def draft(settings: Settings, description: str) -> str:
    """Asks the settings' model, with no tools, for a tool file that does what ``description`` says. Nothing runs
    and nothing is saved: the app puts the code in its editor.

    Raises:
        ConfigError: The settings cannot make a model.
        DraftError: The model call failed.
    """
    agent = Agent(make_model(settings), system=draft_prompt(), tools=[], human=None)
    try:
        answer = agent.run(description)
    except AlpineAgentsError as e:
        raise DraftError(str(e)) from e
    return extract_code(answer if isinstance(answer, str) else str(answer))


def summarize(tool: Tool) -> ToolSummary:
    schema = tool.input_schema
    properties = schema.get("properties", {})
    required = set(schema.get("required", ()))
    params = tuple(
        Param(
            name=name,
            type=_type_of(prop),
            description=str(prop.get("description", "")),
            required=name in required,
            default=prop.get("default"),
        )
        for name, prop in properties.items()
    )
    hints = tool.hints_for({})
    kind = kind_of(tool, {})
    ask: Ask = "never" if kind == "read" else "edit" if kind == "edit" else "ask"
    return ToolSummary(tool.name, tool.description, params, hints.read_only, hints.open_world, ask)


def dependencies(source: str) -> tuple[str, ...]:
    """The normalized package names in the source's ``# /// script`` block. Malformed blocks give none."""
    for match in _SCRIPT_BLOCK.finditer(source):
        if match.group("type") != "script":
            continue
        content = "".join(
            line[2:] if line.startswith("# ") else line[1:] for line in match.group("content").splitlines(True)
        )
        try:
            data = tomllib.loads(content)
        except tomllib.TOMLDecodeError:
            return ()
        names = []
        for requirement in data.get("dependencies", []):
            found = _NAME.match(str(requirement).strip())
            if found:
                names.append(normalize(found.group(0)))
        return tuple(dict.fromkeys(names))
    return ()


def normalize(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def package_info(name: str) -> PackageInfo:
    """What PyPI says about a package, for its approval. Missing facts stay ``None`` when offline."""
    similar = tuple(difflib.get_close_matches(name, sorted(REVIEWED), n=3, cutoff=0.8))
    first = downloads = None
    with contextlib.suppress(Exception):
        data = _get_json(f"https://pypi.org/pypi/{name}/json")
        uploads = [f["upload_time"] for files in data.get("releases", {}).values() for f in files if "upload_time" in f]
        if uploads:
            first = min(uploads)[:7]
    with contextlib.suppress(Exception):
        downloads = int(_get_json(f"https://pypistats.org/api/packages/{name}/recent")["data"]["last_month"])
    return PackageInfo(name, first, downloads, tuple(s for s in similar if s != name))


def draft_prompt() -> str:
    return (
        "Write one Python file that defines a tool for an AI agent, for the task the user describes. Rules:\n"
        "- Import `tool` from `alpineagents` and decorate one function with `@tool(...)`.\n"
        "- Say what it does in the hints: `read_only=True` if it changes nothing, `open_world=True` if it reaches "
        "the network or another system.\n"
        "- Type every parameter (str, int, float, bool, list[...], dict[str, ...]) and write a docstring with a "
        "one-line summary and an `Args:` section describing each parameter.\n"
        "- Raise `alpineagents.ToolError` with a clear message when the call cannot succeed.\n"
        "- If you need packages beyond the standard library, list them in an inline script metadata block at the "
        'very top:\n# /// script\n# dependencies = ["httpx"]\n# ///\n'
        "- Prefer these packages: " + ", ".join(sorted(REVIEWED)) + ".\n"
        "Answer with the file only, in one ```python block."
    )


def extract_code(answer: str) -> str:
    """The first fenced code block of a model's answer, or the answer itself."""
    match = re.search(r"```(?:python|py)?\s*\n(.*?)```", answer, re.DOTALL)
    return (match.group(1) if match else answer).strip() + "\n"


def _type_of(prop: dict[str, Any]) -> str:
    if "type" in prop:
        return str(prop["type"])
    for key in ("anyOf", "oneOf"):
        kinds = [str(p.get("type")) for p in prop.get(key, []) if p.get("type") not in (None, "null")]
        if kinds:
            return kinds[0]
    return "any"


def _error_text(error: BaseException, filename: str) -> str:
    """The error with the line of the user's file it came from."""
    line = None
    tb = error.__traceback__
    while tb is not None:
        if tb.tb_frame.f_code.co_filename == filename:
            line = tb.tb_lineno
        tb = tb.tb_next
    message = f"{type(error).__name__}: {error}".rstrip(": ")
    return f"Line {line}: {message}" if line else message


def _as_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(part if isinstance(part, str) else getattr(part, "text", "[image]") for part in content)
    return str(content)


def _installed(name: str, folder: Path) -> bool:
    """Installed in this process's environment or in the packages folder."""
    with contextlib.suppress(metadata.PackageNotFoundError):
        metadata.distribution(name)
        return True
    if not folder.is_dir():
        return False
    return any(metadata.distributions(name=name, path=[str(folder)]))


def _constraints() -> str:
    """``name==version`` of every package this process runs with."""
    lines = {}
    for dist in metadata.distributions():
        name = dist.metadata["Name"]
        if name:
            lines[normalize(name)] = f"{name}=={dist.version}"
    return "\n".join(sorted(lines.values())) + "\n"


def _get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "alpine-code"})
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_atomic(path: Path, data: bytes) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
