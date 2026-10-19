"""Building a project for Alpine Cloud and listing what the build left (the ``cloudflare-workers`` adapter).

``[build].command`` runs in the project folder. The Cloudflare Vite plugin then leaves ``.wrangler/deploy/config.json``,
which points (relative to its own folder) at the generated ``wrangler.json`` inside the build output. That file says
what the Worker's ``main`` is, where the static ``assets.directory`` is, and the compatibility date and flags. Nothing
else is read from the project's own ``wrangler.jsonc``. Migrations come from ``[database].migrations``.

Everything is listed with its sha256 so the API only asks for what it does not have yet.
"""

from __future__ import annotations

import fnmatch
import hashlib
import json
import mimetypes
import os
import subprocess
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .project import CloudDescription

#: How many lines of a failed build's output the error carries (the app offers them to the agent).
TAIL_LINES = 40
BUILD_TIMEOUT = 600

_CONTENT_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".html": "text/html",
    ".json": "application/json",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
    ".txt": "text/plain",
    ".xml": "application/xml",
}
_MODULE_TYPES = {".js": "esm", ".mjs": "esm", ".cjs": "commonjs"}


class BuildFailed(Exception):
    """The build did not give something to publish. ``tail`` is the last lines of its output."""

    def __init__(self, message: str, tail: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.tail = tail


class BuildCancelled(Exception):
    pass


@dataclass(frozen=True)
class Module:
    name: str
    file: Path
    type: str
    hash: str
    size: int


@dataclass(frozen=True)
class Asset:
    path: str
    """The URL path, ``/assets/index-1a2b.js``."""
    file: Path
    hash: str
    size: int
    content_type: str


@dataclass(frozen=True)
class Migration:
    name: str
    file: Path
    hash: str


@dataclass(frozen=True)
class Built:
    main: str
    compatibility_date: str | None
    compatibility_flags: list[str]
    modules: list[Module]
    assets: list[Asset]
    assets_dir: Path | None
    migrations: list[Migration]
    expects: dict[str, list[str]] = field(default_factory=dict)
    """``{"secrets": [...], "d1": ["DB"]}``, from the generated config."""

    def worker(self) -> dict[str, Any]:
        return {
            "main": self.main,
            "compatibility_date": self.compatibility_date,
            "compatibility_flags": self.compatibility_flags,
            "modules": [{"name": m.name, "type": m.type, "hash": m.hash, "size": m.size} for m in self.modules],
            "expects": self.expects,
        }

    def files_by_hash(self) -> dict[str, Path]:
        """Every file to upload, by hash (the same bytes are one upload)."""
        files = {m.hash: m.file for m in self.modules}
        files |= {a.hash: a.file for a in self.assets}
        files |= {m.hash: m.file for m in self.migrations}
        return files


def build(
    project: Path,
    description: CloudDescription,
    *,
    on_output: Callable[[str], None] | None = None,
    cancel: threading.Event | None = None,
) -> Built:
    """Runs the build, then reads its output.

    Blocking; run it on a thread. The Node that ``runtimes.use_node`` chose is already first on ``PATH``.

    Raises:
        BuildFailed: The command failed or left nothing readable.
        BuildCancelled: ``cancel`` was set meanwhile.
    """
    if description.build_command:
        if _needs_install(project, description):
            _run(["npm", "install", "--no-audit", "--no-fund"], project, on_output, cancel)
        _run(description.build_command, project, on_output, cancel, shell=True)
    return read_output(project, description)


def _needs_install(project: Path, description: CloudDescription) -> bool:
    """A project fresh from a clone has no ``node_modules``; the build would fail on its first import."""
    words = (description.build_command or "").split()
    return (
        bool(words)
        and words[0] == "npm"
        and (project / "package.json").is_file()
        and not (project / "node_modules").exists()
    )


def _run(
    command: str | list[str],
    project: Path,
    on_output: Callable[[str], None] | None,
    cancel: threading.Event | None,
    *,
    shell: bool = False,
) -> None:
    tail: deque[str] = deque(maxlen=TAIL_LINES)
    try:
        child = subprocess.Popen(
            command,
            cwd=project,
            shell=shell,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            errors="replace",
            env={**os.environ, "CI": "1", "NO_COLOR": "1"},
        )
    except OSError as e:
        raise BuildFailed(f"Could not start the build: {e}") from e

    def read() -> None:
        assert child.stdout is not None
        for line in child.stdout:
            line = line.rstrip("\n")
            tail.append(line)
            if on_output is not None:
                on_output(line)

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    waited = 0.0
    while True:
        try:
            child.wait(timeout=0.2)
            break
        except subprocess.TimeoutExpired:
            waited += 0.2
        if cancel is not None and cancel.is_set():
            child.kill()
            child.wait()
            raise BuildCancelled
        if waited > BUILD_TIMEOUT:
            child.kill()
            child.wait()
            reader.join(2)
            raise BuildFailed("The build took too long.", "\n".join(tail))
    reader.join(5)
    if child.returncode != 0:
        raise BuildFailed(f"The build failed (exit {child.returncode}).", "\n".join(tail))


# ---------------------------------------------------------------- reading the output


def read_output(project: Path, description: CloudDescription) -> Built:
    """What the build left, from ``.wrangler/deploy/config.json`` and the ``wrangler.json`` it points at.

    Raises:
        BuildFailed: A file is missing or does not say what is needed.
    """
    project = project.resolve()
    pointer = project / ".wrangler" / "deploy" / "config.json"
    generated = _generated_config(project, pointer, description)
    config = _json(generated)
    folder = generated.parent
    main = config.get("main")
    if not isinstance(main, str) or not (folder / main).is_file():
        raise BuildFailed("The build did not make a Worker script (no main in the generated wrangler.json).")
    main_file = _inside(project, folder / main)
    modules = _modules(main_file.parent, main_file)
    assets_dir = None
    assets_config = config.get("assets")
    if isinstance(assets_config, dict) and isinstance(assets_config.get("directory"), str):
        assets_dir = _inside(project, folder / assets_config["directory"])
        if not assets_dir.is_dir():
            raise BuildFailed("The build did not make the folder of static files it names.")
    flags = config.get("compatibility_flags")
    return Built(
        main=main_file.relative_to(main_file.parent).as_posix(),
        compatibility_date=config.get("compatibility_date")
        if isinstance(config.get("compatibility_date"), str)
        else None,
        compatibility_flags=[f for f in flags if isinstance(f, str)] if isinstance(flags, list) else [],
        modules=modules,
        assets=_assets(assets_dir) if assets_dir is not None else [],
        assets_dir=assets_dir,
        migrations=_migrations(project, description),
        expects=_expects(config),
    )


def _generated_config(project: Path, pointer: Path, description: CloudDescription) -> Path:
    if pointer.is_file():
        relative = _json(pointer).get("configPath")
        if not isinstance(relative, str):
            raise BuildFailed("The build's .wrangler/deploy/config.json does not name a configPath.")
        found = _inside(project, (pointer.parent / relative))
    elif description.build_output:
        # The Vite plugin writes the pointer on every build; without it, look in the output folder.
        candidates = sorted(_inside(project, project / description.build_output).glob("*/wrangler.json"))
        if len(candidates) != 1:
            raise BuildFailed("The build left no .wrangler/deploy/config.json, so there is nothing to publish.")
        found = candidates[0]
    else:
        raise BuildFailed("The build left no .wrangler/deploy/config.json, so there is nothing to publish.")
    if not found.is_file():
        raise BuildFailed("The build's wrangler.json is missing.")
    return found


def _json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise BuildFailed(f"Could not read {path.name} from the build: {e}") from e
    if not isinstance(data, dict):
        raise BuildFailed(f"{path.name} from the build is not an object.")
    return data


def _inside(project: Path, path: Path) -> Path:
    """``path`` resolved, which must stay in the project: a build config never sends files from elsewhere."""
    resolved = path.resolve()
    if not resolved.is_relative_to(project.resolve()):
        raise BuildFailed("The build points outside the project folder.")
    return resolved


def _modules(folder: Path, main: Path) -> list[Module]:
    """Every script under the Worker's folder (the entry and its chunks); source maps and the config are not modules."""
    found = [
        path
        for path in sorted(folder.rglob("*"))
        if path.is_file() and not path.is_symlink() and path.suffix in _MODULE_TYPES
    ]
    if main not in found:
        raise BuildFailed("The Worker's main script is not a JavaScript module.")
    return [
        Module(path.relative_to(folder).as_posix(), path, _MODULE_TYPES[path.suffix], *_digest(path)) for path in found
    ]


def _assets(folder: Path) -> list[Asset]:
    ignore = _ignore_patterns(folder)
    assets: list[Asset] = []
    for path in sorted(folder.rglob("*")):
        relative = path.relative_to(folder).as_posix()
        if path.is_symlink() or not path.is_file() or relative == ".assetsignore" or _ignored(relative, ignore):
            continue
        assets.append(Asset("/" + relative, path, *_digest(path), content_type=_content_type(path)))
    return assets


def _ignore_patterns(folder: Path) -> list[str]:
    try:
        lines = (folder / ".assetsignore").read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    return [line.strip() for line in lines if line.strip() and not line.startswith("#")]


def _ignored(relative: str, patterns: list[str]) -> bool:
    """The simple subset of gitignore that ``.assetsignore`` files use: names, globs and ``folder/``."""
    name = relative.rsplit("/", 1)[-1]
    for pattern in patterns:
        anchored = pattern.lstrip("/")
        if anchored.endswith("/"):
            if relative.startswith(anchored) or f"/{anchored}" in f"/{relative}":
                return True
        elif fnmatch.fnmatch(relative, anchored) or fnmatch.fnmatch(name, anchored):
            return True
    return False


def _content_type(path: Path) -> str:
    return _CONTENT_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def _migrations(project: Path, description: CloudDescription) -> list[Migration]:
    if description.database_kind != "d1" or not description.migrations:
        return []
    folder = _inside(project, project / description.migrations)
    if not folder.is_dir():
        return []
    return [Migration(path.name, path, _digest(path)[0]) for path in sorted(folder.glob("*.sql")) if path.is_file()]


def _expects(config: dict[str, Any]) -> dict[str, list[str]]:
    secrets = config.get("secrets")
    required = secrets.get("required") if isinstance(secrets, dict) else None
    d1 = config.get("d1_databases")
    return {
        "secrets": [s for s in required if isinstance(s, str)] if isinstance(required, list) else [],
        "d1": [b["binding"] for b in d1 if isinstance(b, dict) and isinstance(b.get("binding"), str)]
        if isinstance(d1, list)
        else [],
    }


def _digest(path: Path) -> tuple[str, int]:
    """``(sha256 hex, size)``."""
    sha = hashlib.sha256()
    size = 0
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            sha.update(chunk)
            size += len(chunk)
    return sha.hexdigest(), size
