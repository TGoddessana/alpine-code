"""Read-only source navigation, confined to the selected workspace."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from alpine_protocol.files import (
    FilesActionParams,
    FilesActionResult,
    FilesReadParams,
    FilesReadResult,
    FilesSearchParams,
    FilesSearchResult,
)

from .methods import APP_ERROR, MethodError

MAX_BYTES = 2 * 1024 * 1024
SKIP = {".git", "node_modules", ".venv", "dist", "storybook-static", "__pycache__"}


def _root(cwd: str) -> Path:
    root = Path(cwd).expanduser().resolve()
    if not root.is_dir():
        raise MethodError(APP_ERROR, "Workspace folder does not exist", "not_a_folder")
    return root


def _file(cwd: str, name: str) -> tuple[Path, Path]:
    root = _root(cwd)
    candidate = Path(name).expanduser()
    path = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if not path.is_relative_to(root):
        raise MethodError(APP_ERROR, "File is outside this workspace", "no_access")
    if not path.is_file():
        raise MethodError(APP_ERROR, "File does not exist", "not_found")
    return root, path


def read_file(params: FilesReadParams) -> FilesReadResult:
    root, path = _file(params.cwd, params.path)
    try:
        with path.open("rb") as source:
            data = source.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise MethodError(APP_ERROR, "File exceeds the 2 MiB viewer limit", "too_big")
        if b"\0" in data:
            raise MethodError(APP_ERROR, "Binary files cannot be shown as source", "unsupported")
        lines = data.decode("utf-8-sig").splitlines()
    except UnicodeDecodeError as exc:
        raise MethodError(APP_ERROR, "File is not UTF-8 text", "unsupported") from exc
    except OSError as exc:
        raise MethodError(APP_ERROR, "Cannot read this file", "no_access") from exc
    total = len(lines)
    line = min(params.line, max(1, total))
    start = min(params.start_line or max(1, line - params.limit // 2), max(1, total))
    end = min(total, start - 1 + params.limit)
    return FilesReadResult(
        path=str(path),
        relative_path=str(path.relative_to(root)),
        content="\n".join(lines[start - 1 : end]),
        start_line=start,
        total_lines=total,
        line=line,
        truncated=start > 1 or end < total,
    )


def file_action(params: FilesActionParams) -> FilesActionResult:
    _, path = _file(params.cwd, params.path)
    if params.action == "editor" and (editor := shutil.which("code") or shutil.which("cursor")):
        command = [editor, "--goto", f"{path}:{params.line}"]
    elif sys.platform == "darwin":
        command = ["open", "-R", str(path)] if params.action == "reveal" else ["open", str(path)]
    elif sys.platform == "win32":
        command = ["explorer", "/select,", str(path)] if params.action == "reveal" else ["explorer", str(path)]
    else:
        command = ["xdg-open", str(path.parent if params.action == "reveal" else path)]
    try:
        subprocess.run(command, check=True, timeout=10, capture_output=True)
    except (OSError, subprocess.SubprocessError) as exc:
        raise MethodError(APP_ERROR, "Could not open this file in an external application", "other") from exc
    return FilesActionResult()


def search_files(params: FilesSearchParams) -> FilesSearchResult:
    root = _root(params.cwd)
    query = params.query.casefold().strip()
    paths: list[str] = []
    visited = 0
    for folder, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not (Path(folder) / d).is_symlink())
        for name in sorted(names):
            visited += 1
            path = Path(folder) / name
            relative = str(path.relative_to(root))
            if query in relative.casefold() and not path.is_symlink():
                paths.append(relative)
                if len(paths) > params.limit:
                    return FilesSearchResult(paths=paths[: params.limit], truncated=True)
            if visited >= 20000:
                return FilesSearchResult(paths=paths, truncated=True)
    return FilesSearchResult(paths=paths)


FILE_HANDLERS = {"files/read": read_file, "files/action": file_action, "files/search": search_files}
