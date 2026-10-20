"""Node.js for the projects that need it (web apps build with it). Most people have none, so Alpine finds a usable one
or installs its own copy after one question (section 6.3 of the contract).

Usable means Node 22.12 or newer. ``find_node`` looks on ``PATH`` and in the places a GUI app's ``PATH`` misses
(Homebrew, nvm, Volta, fnm), then at Alpine's copy in ``~/.alpine-code/runtimes/node``. ``use_node`` puts the right
``bin`` first on this process's ``PATH``, which sessions, dev servers and builds inherit. ``install`` downloads the
official Node 22 archive from nodejs.org (a tarball on macOS and Linux, a zip on Windows), checks it against
``SHASUMS256.txt`` of the same release and unpacks it into Alpine's folder. No admin password, nothing outside
Alpine's folder; a system install later takes over by itself.
"""

from __future__ import annotations

import hashlib
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from ..home import home_dir

WINDOWS = sys.platform == "win32"
NODE_EXE = "node.exe" if WINDOWS else "node"

REQUIRED = (22, 12)
REQUIRED_TEXT = "22.12"
#: Node 22's latest release: ``SHASUMS256.txt`` and the tarballs are in this folder.
DIST_URL = "https://nodejs.org/dist/latest-v22.x"

Fetch = Callable[[str, "Callable[[float], None] | None"], Path]
"""``(url, progress) -> file``: downloads ``url`` to a file in a temporary folder; ``progress`` gets 0..1."""


class NodeInstallError(Exception):
    """Alpine's copy of Node.js could not be installed. ``kind`` says why, so an app can word it."""

    def __init__(self, kind: str, message: str) -> None:
        super().__init__(message)
        self.kind = kind  # "unsupported" | "download" | "checksum" | "unpack"


@dataclass(frozen=True)
class NodeInfo:
    path: Path
    """The ``node`` executable."""
    version: tuple[int, int, int]
    alpine_managed: bool

    @property
    def bin(self) -> Path:
        return self.path.parent

    @property
    def version_text(self) -> str:
        return ".".join(map(str, self.version))


@dataclass(frozen=True)
class NodeStatus:
    ready: bool
    version: str | None
    required: str
    alpine_managed: bool


def runtime_dir() -> Path:
    """Alpine's own copy: ``~/.alpine-code/runtimes/node``."""
    return home_dir() / "runtimes" / "node"


def _own_bin() -> Path:
    """Where Alpine's copy keeps ``node``: ``bin`` on macOS and Linux, the folder itself on Windows."""
    return runtime_dir() if WINDOWS else runtime_dir() / "bin"


def node_version(executable: Path) -> tuple[int, int, int] | None:
    """What ``node --version`` says, or ``None`` when it does not run."""
    try:
        done = subprocess.run([str(executable), "--version"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)\s*", done.stdout) if done.returncode == 0 else None
    return (int(match[1]), int(match[2]), int(match[3])) if match else None


def usable(version: tuple[int, int, int] | None) -> bool:
    return version is not None and version[:2] >= REQUIRED


def _extra_bins() -> list[Path]:
    """Places a GUI app's ``PATH`` misses, best first."""
    home = Path.home()
    if WINDOWS:
        program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
        local = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        nvm = Path(os.environ.get("NVM_SYMLINK", program_files / "nodejs"))  # nvm-windows' current version
        found = [program_files / "nodejs", local / "Volta" / "bin", nvm]
        roots: tuple[tuple[str, str], ...] = (("AppData/Roaming/fnm/node-versions", "installation"),)
    else:
        found = [Path("/opt/homebrew/bin"), Path("/usr/local/bin"), home / ".volta" / "bin"]
        roots = ((".nvm/versions/node", "bin"), (".fnm/node-versions", "installation/bin"))
    for pattern, tail in roots:
        root = home / pattern
        if root.is_dir():
            versions = sorted(root.iterdir(), key=lambda p: _numbers(p.name), reverse=True)
            found.extend(v / tail for v in versions)
    return found


def _numbers(name: str) -> tuple[int, ...]:
    return tuple(int(n) for n in re.findall(r"\d+", name))


def find_node(search_path: str | None = None) -> NodeInfo | None:
    """A usable system Node (on ``search_path``, default this process's ``PATH``, or in the usual places), else
    Alpine's own copy, else ``None``. Alpine's own bin on ``PATH`` is not a system Node."""
    own = _own_bin()
    seen: set[Path] = set()
    dirs = [
        Path(d) for d in (search_path if search_path is not None else os.environ.get("PATH", "")).split(os.pathsep) if d
    ]
    for directory in [*dirs, *_extra_bins()]:
        if directory in seen or directory == own:
            continue
        seen.add(directory)
        executable = directory / NODE_EXE
        if executable.is_file() and os.access(executable, os.X_OK):
            version = node_version(executable)
            if usable(version):
                return NodeInfo(executable, version, False)  # type: ignore[arg-type]
    executable = own / NODE_EXE
    if executable.is_file():
        version = node_version(executable)
        if usable(version):
            return NodeInfo(executable, version, True)  # type: ignore[arg-type]
    return None


def status(search_path: str | None = None) -> NodeStatus:
    node = find_node(search_path)
    return NodeStatus(
        node is not None, node.version_text if node else None, REQUIRED_TEXT, bool(node and node.alpine_managed)
    )


def use_node() -> NodeInfo | None:
    """Puts the chosen Node's ``bin`` first on this process's ``PATH``, so sessions, dev servers and builds find it.
    A system Node wins over Alpine's copy; when one appears later, Alpine's ``bin`` leaves ``PATH``."""
    own = str(_own_bin())
    parts = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p and p != own]
    node = find_node(os.pathsep.join(parts))
    if node is not None and (node.alpine_managed or str(node.bin) not in parts):
        parts.insert(0, str(node.bin))
    os.environ["PATH"] = os.pathsep.join(parts)
    return node


# ---------------------------------------------------------------- installing


def download(url: str, progress: Callable[[float], None] | None = None, timeout: float = 60) -> Path:
    """Downloads ``url`` into a new temporary folder and returns the file. The caller removes the folder."""
    folder = Path(tempfile.mkdtemp(prefix="alpine-node-"))
    target = folder / (url.rsplit("/", 1)[-1] or "download")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response, target.open("wb") as out:
            total = int(response.headers.get("Content-Length") or 0)
            received = 0
            while chunk := response.read(256 * 1024):
                out.write(chunk)
                received += len(chunk)
                if progress and total:
                    progress(min(received / total, 1.0))
    except (urllib.error.URLError, OSError, TimeoutError):
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return target


def _target() -> str:
    machine = platform.machine().lower()
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "amd64": "x64"}.get(machine)
    system = {"darwin": "darwin", "linux": "linux", "win32": "win"}.get(sys.platform)
    if arch is None or system is None:
        raise NodeInstallError("unsupported", f"Alpine cannot install Node.js on {sys.platform}/{machine}.")
    return f"{system}-{arch}"


def install(
    progress: Callable[[float], None] | None = None, *, fetch: Fetch = download, dist_url: str = DIST_URL
) -> NodeInfo:
    """Installs Alpine's copy of Node 22 into ``runtime_dir()`` and returns it.

    Raises:
        NodeInstallError: Unsupported computer, the download failed, the checksum did not match (nothing is
            unpacked), or the archive could not be unpacked.
    """
    target = _target()
    suffix = ".zip" if target.startswith("win-") else ".tar.gz"
    sums = _fetch_text(fetch, f"{dist_url}/SHASUMS256.txt")
    match = re.search(
        rf"^([0-9a-f]{{64}})\s+(node-v\d+\.\d+\.\d+-{re.escape(target)}{re.escape(suffix)})\s*$", sums, re.MULTILINE
    )
    if match is None:
        raise NodeInstallError("download", f"The Node.js release has no download for {target}.")
    expected, name = match[1], match[2]
    archive = _fetch(fetch, f"{dist_url}/{name}", progress)
    try:
        if _sha256(archive) != expected:
            raise NodeInstallError(
                "checksum", "The downloaded Node.js does not match its published checksum. Nothing was installed."
            )
        _unpack(archive, name.removesuffix(suffix))
    finally:
        shutil.rmtree(archive.parent, ignore_errors=True)
    own = _own_bin() / NODE_EXE
    version = node_version(own)
    if version is None or not usable(version):
        raise NodeInstallError("unpack", "The installed Node.js did not run.")
    return NodeInfo(own, version, True)


def _fetch(fetch: Fetch, url: str, progress: Callable[[float], None] | None) -> Path:
    try:
        return fetch(url, progress)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise NodeInstallError("download", f"Downloading Node.js failed: {e}") from e


def _fetch_text(fetch: Fetch, url: str) -> str:
    file = _fetch(fetch, url, None)
    try:
        return file.read_text(encoding="utf-8", errors="replace")
    finally:
        shutil.rmtree(file.parent, ignore_errors=True)


def _sha256(file: Path) -> str:
    digest = hashlib.sha256()
    with file.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _unpack(archive: Path, top: str) -> None:
    """Unpacks the archive beside the final folder, then swaps it in, so a half-written copy is never used."""
    final = runtime_dir()
    final.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="node-", dir=final.parent))
    try:
        if archive.name.endswith(".zip"):
            with zipfile.ZipFile(archive) as zf:
                zf.extractall(staging)  # zipfile drops ".." and absolute parts of member names
        else:
            with tarfile.open(archive) as tar:
                tar.extractall(staging, filter="data")  # refuses paths outside the folder, links out of it, devices
        unpacked = staging / top
        if not (unpacked / ("node.exe" if archive.name.endswith(".zip") else "bin/node")).is_file():
            raise NodeInstallError("unpack", "The Node.js archive had an unexpected layout.")
        old = final.with_name(final.name + ".old")
        shutil.rmtree(old, ignore_errors=True)
        if final.exists():
            final.rename(old)
        unpacked.rename(final)
        shutil.rmtree(old, ignore_errors=True)
    except (tarfile.TarError, zipfile.BadZipFile, OSError) as e:
        raise NodeInstallError("unpack", f"Unpacking Node.js failed: {e}") from e
    finally:
        shutil.rmtree(staging, ignore_errors=True)
