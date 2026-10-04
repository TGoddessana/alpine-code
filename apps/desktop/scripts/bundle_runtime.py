"""Builds the Python runtime a released desktop app carries: `src-tauri/runtime/`.

A bundled app runs the server as `runtime/python/bin/python3.14 -I -B -m alpine_server`, so it needs no Python or uv
on the user's machine. The runtime is a standalone CPython (python-build-standalone, through uv) with the server and
its locked dependencies installed, plus a uv binary that the toolbox uses to install packages for user tools.

    uv run python apps/desktop/scripts/bundle_runtime.py [--target aarch64-apple-darwin|x86_64-apple-darwin]

Set APPLE_SIGNING_IDENTITY to sign every binary for notarization (hardened runtime, timestamp). The app bundle itself
is signed afterwards by `tauri build`, which seals these signatures in.
"""

from __future__ import annotations

import argparse
import compileall
import hashlib
import os
import platform
import py_compile
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "apps/desktop/src-tauri/runtime"
ENTITLEMENTS = ROOT / "apps/desktop/src-tauri/runtime.entitlements"
PYTHON = "3.14"

TARGETS = {
    "aarch64-apple-darwin": "macos-aarch64",
    "x86_64-apple-darwin": "macos-x86_64",
}

# Never imported by the server or a user tool, and tkinter brings Tcl/Tk.
TRIM = [
    "bin/idle3",
    "bin/idle3.14",
    "bin/pip",
    "bin/pip3",
    "bin/pip3.14",
    "bin/pydoc3",
    "bin/pydoc3.14",
    "bin/python",
    "bin/python3",
    "bin/python3-config",
    "bin/python3.14-config",
    "include",
    "share",
    "lib/pkgconfig",
    "lib/libpython3.14.dylib",
    "lib/itcl4.3.8",
    "lib/libtcl9.0.dylib",
    "lib/libtcl9tk9.0.dylib",
    "lib/tcl9",
    "lib/tcl9.0",
    "lib/thread3.0.6",
    "lib/tk9.0",
    "lib/python3.14/EXTERNALLY-MANAGED",
    "lib/python3.14/ensurepip",
    "lib/python3.14/idlelib",
    "lib/python3.14/tkinter",
    "lib/python3.14/turtledemo",
    "lib/python3.14/site-packages/pip",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=TARGETS, default=host_target())
    target = parser.parse_args().target

    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    with tempfile.TemporaryDirectory() as tmp:
        python = install_python(target, Path(tmp))
        trim(python)
        install_server(python, target, Path(tmp))
        compile_all(python)
        fetch_uv(target, Path(tmp))

    identity = os.environ.get("APPLE_SIGNING_IDENTITY")
    if identity:
        sign(identity)
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"runtime for {target}: {OUT} ({size / 1e6:.0f} MB){', signed' if identity else ''}")


def host_target() -> str:
    return {"arm64": "aarch64-apple-darwin", "x86_64": "x86_64-apple-darwin"}.get(platform.machine(), "")


def install_python(target: str, tmp: Path) -> Path:
    """A standalone CPython for the target, copied without symlinks so the bundler copies it as is."""
    managed = tmp / "managed"
    run("uv", "python", "install", f"cpython-{PYTHON}-{TARGETS[target]}-none", "--install-dir", str(managed))
    source = next(p for p in managed.iterdir() if p.is_dir() and re.fullmatch(r"cpython-\d+\.\d+\.\d+-.*", p.name))
    python = OUT / "python"
    shutil.copytree(source, python, symlinks=True)
    for link in [p for p in python.rglob("*") if p.is_symlink()]:
        link.unlink()
    return python


def trim(python: Path) -> None:
    for name in TRIM:
        path = python / name
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    for cache in python.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
    for module in (python / "lib/python3.14/lib-dynload").glob("_tkinter*"):
        module.unlink()


def install_server(python: Path, target: str, tmp: Path) -> None:
    """The server and the exact versions in uv.lock, for the target's platform."""
    requirements = tmp / "requirements.txt"
    run(
        "uv", "export", "--package", "alpine-code-server", "--frozen", "--no-dev", "--no-editable", "--no-hashes",
        "--output-file", str(requirements), cwd=ROOT,
    )  # fmt: skip
    run(
        "uv", "pip", "install", "--no-deps", "--link-mode", "copy",
        "--target", str(python / "lib/python3.14/site-packages"),
        "--python-platform", target, "--python-version", PYTHON,
        "--requirements", str(requirements), cwd=ROOT,
    )  # fmt: skip


def compile_all(python: Path) -> None:
    """Bytecode that stays valid when the bundler changes file times; the app never writes into its own bundle."""
    ok = compileall.compile_dir(
        python / "lib/python3.14",
        quiet=1,
        workers=0,
        invalidation_mode=py_compile.PycInvalidationMode.UNCHECKED_HASH,
    )
    if not ok:
        sys.exit("compiling the runtime's Python files failed")


def fetch_uv(target: str, tmp: Path) -> None:
    """The uv release matching the one building this, checksum-verified."""
    version = re.search(r"\d+\.\d+\.\d+", run("uv", "--version")).group()
    name = f"uv-{target}.tar.gz"
    base = f"https://github.com/astral-sh/uv/releases/download/{version}/{name}"
    archive = tmp / name
    with urllib.request.urlopen(base) as response:
        archive.write_bytes(response.read())
    with urllib.request.urlopen(f"{base}.sha256") as response:
        expected = response.read().decode().split()[0]
    if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
        sys.exit(f"{name} does not match its published checksum")
    with tarfile.open(archive) as tar:
        member = tar.getmember(f"uv-{target}/uv")
        member.name = "uv"
        tar.extract(member, OUT / "bin", filter="data")


def sign(identity: str) -> None:
    """Every Mach-O file, so notarization accepts the app. Python gets entitlements for cffi and user packages."""
    python = OUT / "python/bin/python3.14"
    for path in sorted(p for p in OUT.rglob("*") if p.is_file() and is_macho(p) and p != python):
        codesign(identity, path)
    codesign(identity, python, "--entitlements", str(ENTITLEMENTS))


def codesign(identity: str, path: Path, *extra: str) -> None:
    run("codesign", "--force", "--timestamp", "--options", "runtime", "--sign", identity, *extra, str(path))


def is_macho(path: Path) -> bool:
    with path.open("rb") as f:
        magic = f.read(4)
    return magic in (b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xce\xfa\xed\xfe")


def run(*args: str, cwd: Path | None = None) -> str:
    done = subprocess.run(args, cwd=cwd, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit(f"{' '.join(args)} failed:\n{done.stderr}")
    return done.stdout


if __name__ == "__main__":
    main()
