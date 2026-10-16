"""Bringing a repository to this computer for the app: where it goes, whether it is already here, and a clone that
says how far it got and can be stopped.

The app never asks where a clone goes: it goes to one folder (``~/AlpineCode`` unless the user changed it), under the
repository's name, or ``<name>-2`` when another folder has that name. A repository that is already a project, or
already in that folder, is opened instead of cloned again.
"""

from __future__ import annotations

import asyncio
import itertools
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from .git import clone_url, repo_name

FailureKind = Literal["no_access", "unreachable", "failed"]


class CloneFailed(Exception):
    """git could not clone. ``kind`` says what the user can do about it; the message is git's own last line.

    ``no_access``: the address is wrong, or this computer is not signed in to see it (git cannot tell these apart:
    hosts answer "not found" to strangers). ``unreachable``: the host did not answer. ``failed``: anything else.
    """

    def __init__(self, kind: FailureKind, message: str) -> None:
        super().__init__(message)
        self.kind = kind


class CloneCancelled(Exception):
    """The clone was stopped before it finished; nothing of it is left on disk."""


@dataclass(frozen=True)
class Credentials:
    """A sign-in for an HTTPS address: a user name and a password or access token. Given to git only through
    ``GIT_ASKPASS``, never on the command line; git's own credential helper (the macOS keychain) keeps them when the
    clone succeeds, so later fetches and pushes need nothing from the app."""

    username: str
    password: str


@dataclass(frozen=True)
class Progress:
    percent: int
    """0 to 100 over the whole clone: receiving, then resolving, then writing the files."""
    received: int | None = None
    """Bytes received so far, while git says."""


def default_clone_folder() -> Path:
    """Not ``~/Documents``: macOS can sync it to iCloud, which breaks git folders and ``node_modules``."""
    return Path.home() / "AlpineCode"


# ------------------------------------------------------------ git itself


def git_tools_ready() -> bool:
    """Whether git can run. On macOS ``/usr/bin/git`` is only a stand-in until Apple's command line developer tools
    are installed; running it then opens Apple's installer instead."""
    git = shutil.which("git")
    if git is None:
        return False
    if sys.platform == "darwin" and os.path.realpath(git) == "/usr/bin/git":
        try:
            return subprocess.run(["xcode-select", "-p"], capture_output=True, timeout=10).returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False
    return True


def install_git_tools() -> bool:
    """Opens Apple's installer for the command line developer tools (git, and the compilers projects need to run).
    Returns at once; ``git_tools_ready`` turns true when the user finished. ``False`` where there is no such
    installer."""
    if sys.platform != "darwin":
        return False
    try:
        subprocess.Popen(["xcode-select", "--install"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError:
        return False
    return True


# ------------------------------------------------------------ where it goes


def repository_key(address: str) -> str:
    """The same string for every way of writing one repository's address: ``owner/repo``,
    ``https://github.com/Owner/repo.git``, ``git@github.com:owner/repo``, ``ssh://git@github.com:22/owner/repo``."""
    url = clone_url(address).strip().rstrip("/").removesuffix(".git")
    if url.startswith(("/", "~", ".")) or url.startswith("file://"):
        return str(Path(url.removeprefix("file://")).expanduser().resolve())
    match = re.fullmatch(r"(?:[a-z][a-z0-9+.-]*://)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+)", url)
    if match is None:
        return url.lower()
    host, path = match.groups()
    return f"{host.lower()}/{path.strip('/').lower()}"


def place(address: str, parent: Path, projects: Iterable[Path], taken: Iterable[Path] = ()) -> tuple[Path, bool]:
    """Where the clone of ``address`` goes, and whether the repository is already there.

    A project whose ``origin`` is the same repository wins. Otherwise ``parent/<name>``, ``parent/<name>-2``...: the
    first that does not exist, unless one before it already holds the repository with at least one commit. ``taken``
    are folders other clones are writing to right now.
    """
    key = repository_key(address)
    for folder in projects:
        remote = _origin(folder)
        if remote is not None and repository_key(remote) == key:
            return folder, True
    busy = {Path(p) for p in taken}
    name = repo_name(address)
    parent = parent.expanduser().resolve()
    for n in itertools.count(1):
        folder = parent / (name if n == 1 else f"{name}-{n}")
        if folder in busy:
            continue
        if not folder.exists():
            return folder, False
        remote = _origin(folder)
        if remote is not None and repository_key(remote) == key and _has_commit(folder):
            return folder, True
    raise AssertionError("unreachable")


def _origin(folder: Path) -> str | None:
    return _git_out(folder, "remote", "get-url", "origin")


def _has_commit(folder: Path) -> bool:
    return _git_out(folder, "rev-parse", "--verify", "--quiet", "HEAD") is not None


def _git_out(folder: Path, *args: str) -> str | None:
    if not folder.is_dir():
        return None
    try:
        result = subprocess.run(["git", "-C", str(folder), *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return (result.stdout.strip() or None) if result.returncode == 0 else None


# ------------------------------------------------------------ the clone


#: git's progress lines, with the share of the whole clone each phase covers.
_PHASES = {
    "Receiving objects": (0, 85),
    "Resolving deltas": (85, 95),
    "Updating files": (95, 100),
}
_PROGRESS = re.compile(r"(?:remote: )?([A-Z][a-z]+ [a-z]+):\s+(\d+)%")
_RECEIVED = re.compile(r"([\d.]+) (bytes|KiB|MiB|GiB)")
_UNITS = {"bytes": 1, "KiB": 1024, "MiB": 1024**2, "GiB": 1024**3}

_NO_ACCESS = (
    "could not read username",
    "could not read password",
    "authentication failed",
    "access denied",
    "permission denied",
    "host key verification failed",
    "not found",
    "does not exist",
    "does not appear to be a git repository",
    "returned error: 401",
    "returned error: 403",
    "terminal prompts disabled",
)
_UNREACHABLE = (
    "could not resolve host",
    "failed to connect",
    "connection timed out",
    "operation timed out",
    "network is unreachable",
    "connection refused",
    "could not resolve hostname",
)

#: Seconds git gets to stop after SIGTERM before it is killed.
_GRACE = 1.0
#: Seconds to read git's last lines after it exits.
_LAST_LINES = 2.0

_ASKPASS = """#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' "$ALPINE_GIT_USERNAME" ;;
  *) printf '%s\\n' "$ALPINE_GIT_PASSWORD" ;;
esac
"""


def failure_kind(message: str) -> FailureKind:
    lowered = message.lower()
    if any(sign in lowered for sign in _NO_ACCESS):
        return "no_access"
    if any(sign in lowered for sign in _UNREACHABLE):
        return "unreachable"
    return "failed"


class Clone:
    """``git clone --progress`` running in the background.

    ``contacted`` returns once the remote has answered (so the address and the sign-in were good) or git has ended;
    ``wait`` returns the folder or raises ``CloneFailed`` / ``CloneCancelled``. A clone that does not finish leaves
    nothing behind: the folder it was writing is removed.
    """

    def __init__(
        self,
        process: asyncio.subprocess.Process,
        dest: Path,
        on_progress: Callable[[Progress], None] | None,
        askpass: Path | None,
    ) -> None:
        self.dest = dest
        self.progress = Progress(0)
        self._process = process
        self._on_progress = on_progress
        self._askpass = askpass
        self._contacted = asyncio.Event()
        self._cancelled = False
        self._lines: list[str] = []
        self._task = asyncio.create_task(self._run())

    @classmethod
    async def start(
        cls,
        address: str,
        dest: Path,
        *,
        credentials: Credentials | None = None,
        on_progress: Callable[[Progress], None] | None = None,
    ) -> Clone:
        """Starts cloning ``address`` into ``dest``, which must not exist yet.

        Raises:
            CloneFailed: git cannot be started.
        """
        if dest.exists():
            raise CloneFailed("failed", f"{dest} is already there")
        dest.parent.mkdir(parents=True, exist_ok=True)
        # English, so its progress and errors can be read; the user's locale may translate them.
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "LC_ALL": "C", "LANGUAGE": ""}
        # SSH never asks either: no passphrase prompt, and a host seen for the first time is trusted, as typing "yes"
        # would. A user's own GIT_SSH_COMMAND wins.
        env.setdefault("GIT_SSH_COMMAND", "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new")
        askpass = None
        if credentials is not None:
            askpass = _write_askpass()
            env |= {
                "GIT_ASKPASS": str(askpass),
                "ALPINE_GIT_USERNAME": credentials.username,
                "ALPINE_GIT_PASSWORD": credentials.password,
            }
        try:
            process = await asyncio.create_subprocess_exec(
                "git",
                "clone",
                "--progress",
                clone_url(address),
                str(dest),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                start_new_session=True,  # its own process group, so stopping it stops ssh and the helpers too
            )
        except OSError as e:
            if askpass is not None:
                askpass.unlink(missing_ok=True)
            raise CloneFailed("failed", f"git could not start: {e}") from e
        return cls(process, dest, on_progress, askpass)

    @property
    def running(self) -> bool:
        return not self._task.done()

    async def contacted(self) -> None:
        await self._contacted.wait()

    async def wait(self) -> Path:
        return await asyncio.shield(self._task)

    def cancel(self) -> None:
        """Stops git; ``wait`` then raises ``CloneCancelled``."""
        if self.running:
            self._cancelled = True
            self._signal(signal.SIGTERM)
            # git cleans up on SIGTERM, which can mean waiting for its ssh; past a moment, it is killed.
            asyncio.get_running_loop().call_later(_GRACE, lambda: self.running and self._signal(signal.SIGKILL))

    async def _run(self) -> Path:
        reader = asyncio.create_task(self._read())
        try:
            code = await self._process.wait()
            # Whatever git started and left behind (ssh, a credential helper) goes with it, and stops holding stderr.
            self._signal(signal.SIGKILL)
            try:
                await asyncio.wait_for(reader, _LAST_LINES)
            except TimeoutError:
                pass
        except asyncio.CancelledError:
            self._signal(signal.SIGKILL)
            await self._process.wait()
            reader.cancel()
            self._remove()
            raise
        finally:
            self._contacted.set()
            if self._askpass is not None:
                self._askpass.unlink(missing_ok=True)
        if self._cancelled:
            self._remove()
            raise CloneCancelled()
        if code != 0:
            self._remove()
            message = self._message(code)
            raise CloneFailed(failure_kind(message), message)
        if self.progress.percent < 100:  # small repositories skip the last phases
            self._report(Progress(100, self.progress.received))
        return self.dest

    async def _read(self) -> None:
        stream = self._process.stderr
        assert stream is not None
        pending = ""
        while chunk := await stream.read(4096):
            pending += chunk.decode("utf-8", errors="replace")
            *lines, pending = re.split(r"[\r\n]", pending)
            for line in lines:
                self._line(line)
        if pending:
            self._line(pending)

    def _line(self, line: str) -> None:
        line = line.strip()
        if not line:
            return
        if line.startswith(("remote:", "Receiving objects")):
            self._contacted.set()
        match = _PROGRESS.match(line)
        if match is None or match[1] not in _PHASES:
            if match is None:
                self._lines.append(line)
            return
        start, end = _PHASES[match[1]]
        percent = start + (end - start) * int(match[2]) // 100
        received = self.progress.received
        if match[1] == "Receiving objects" and (size := _RECEIVED.search(line)):
            received = int(float(size[1]) * _UNITS[size[2]])
        if percent != self.progress.percent or received != self.progress.received:
            self._report(Progress(max(percent, self.progress.percent), received))

    def _report(self, progress: Progress) -> None:
        self.progress = progress
        if self._on_progress is not None:
            self._on_progress(progress)

    def _signal(self, sig: signal.Signals) -> None:
        try:
            os.killpg(self._process.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass

    def _message(self, code: int) -> str:
        for line in reversed(self._lines):
            if line.startswith(("fatal:", "error:", "ERROR:")):
                return line
        return self._lines[-1] if self._lines else f"git clone exited with {code}"

    def _remove(self) -> None:
        shutil.rmtree(self.dest, ignore_errors=True)


def _write_askpass() -> Path:
    handle, name = tempfile.mkstemp(prefix="alpine-askpass-", suffix=".sh")
    with os.fdopen(handle, "w") as file:
        file.write(_ASKPASS)
    path = Path(name)
    path.chmod(0o700)
    return path
