"""Finds a ripgrep binary: the one on PATH, or a pinned release downloaded once into the cache.

The search tools (glob, grep) run ripgrep instead of reimplementing search: it respects .gitignore, skips binary
files, is fast on large trees, and behaves the same on every OS.
"""

from __future__ import annotations

import hashlib
import io
import os
import platform
import shutil
import stat
import tarfile
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

VERSION = "15.2.0"

#: (system, machine) -> (release target, sha256 of the archive). Checksums from the release's .sha256 files.
_ASSETS: dict[tuple[str, str], tuple[str, str]] = {
    ("Darwin", "arm64"): (
        "aarch64-apple-darwin.tar.gz", "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4"
    ),
    ("Darwin", "x86_64"): (
        "x86_64-apple-darwin.tar.gz", "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1"
    ),
    ("Linux", "aarch64"): (
        "aarch64-unknown-linux-musl.tar.gz", "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915"
    ),
    ("Linux", "x86_64"): (
        "x86_64-unknown-linux-musl.tar.gz", "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c"
    ),
    ("Windows", "AMD64"): (
        "x86_64-pc-windows-msvc.zip", "71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5"
    ),
    ("Windows", "ARM64"): (
        "aarch64-pc-windows-msvc.zip", "e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f"
    ),
}

_INSTALL_HINT = "Install ripgrep (https://github.com/BurntSushi/ripgrep#installation), e.g. `brew install ripgrep`"

_lock = threading.Lock()


class RipgrepUnavailable(Exception):
    """No ripgrep on PATH and it could not be downloaded. The message says how to install it."""


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache"
    return Path(base) / "alpine-code" / "ripgrep" / VERSION


def asset() -> tuple[str, str]:
    """The release archive's file name and its sha256 for this platform."""
    key = (platform.system(), platform.machine())
    if key not in _ASSETS:
        raise RipgrepUnavailable(f"No prebuilt ripgrep for {key[0]} {key[1]}. {_INSTALL_HINT}")
    target, sha256 = _ASSETS[key]
    return f"ripgrep-{VERSION}-{target}", sha256


def rg_path() -> str:
    """Path to a ripgrep binary. Downloads the pinned release on first use when none is on PATH.

    Raises:
        RipgrepUnavailable: The platform has no prebuilt release, or the download failed.
    """
    system = shutil.which("rg")
    if system:
        return system
    exe = "rg.exe" if platform.system() == "Windows" else "rg"
    cached = cache_dir() / exe
    if cached.is_file():
        return str(cached)
    with _lock:
        if not cached.is_file():
            _download(cached, exe)
    return str(cached)


def _download(dest: Path, exe: str) -> None:
    name, sha256 = asset()
    url = f"https://github.com/BurntSushi/ripgrep/releases/download/{VERSION}/{name}"
    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read()
    except OSError as e:
        raise RipgrepUnavailable(f"Could not download ripgrep from {url} ({e}). {_INSTALL_HINT}") from e
    binary = extract(data, sha256, exe)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as tmp:
        tmp.write(binary)
    os.chmod(tmp.name, os.stat(tmp.name).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    os.replace(tmp.name, dest)


def extract(archive: bytes, sha256: str, exe: str) -> bytes:
    """The ``rg`` binary inside a release archive, after checking the archive's sha256."""
    actual = hashlib.sha256(archive).hexdigest()
    if actual != sha256:
        raise RipgrepUnavailable(f"ripgrep download failed its checksum (got {actual}). {_INSTALL_HINT}")
    if archive[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            member = next(n for n in z.namelist() if n.endswith("/" + exe))
            return z.read(member)
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as t:
        member = next(m for m in t.getmembers() if m.name.endswith("/" + exe) and m.isfile())
        file = t.extractfile(member)
        assert file is not None
        return file.read()
