"""Where memories are kept. The default is a folder per scope: one Markdown file per memory, plus ``index.md``.

A memory file::

    ---
    kind: rule
    ---
    # 화면 문구는 해요체로 쓴다

    이유: 사용자가 두 번 고쳐 말함 (버튼, 오류 메시지).

The files are the truth: ``index.md`` is rewritten from them on every change, for people browsing the folder. A file
people wrote by hand without the front matter is a rule, and its first line is its headline.
"""

from __future__ import annotations

import threading
from dataclasses import replace
from pathlib import Path
from typing import Protocol

from ..home import home_dir
from .model import Memory, Scope, file_name, project_key

INDEX = "index.md"


class MemoryStore(Protocol):
    def list(self, scope: Scope) -> list[Memory]:
        """The memories of one scope, with ``path`` set when they are files."""
        ...

    def put(self, memory: Memory) -> Memory:
        """Writes the memory under its id, replacing one with the same id. Returns it as stored."""
        ...

    def remove(self, scope: Scope, memory_id: str) -> None:
        """Removes one memory. Nothing happens when there is none."""
        ...


def scope_folders(project: Path, home: Path | None = None) -> dict[Scope, Path]:
    """Team memory is in the repository; the user's own memory never is, so it cannot be committed by mistake."""
    home = home or home_dir()
    return {
        "team": project / ".alpine" / "memory",
        "project_me": home / "projects" / project_key(project) / "memory",
        "me": home / "memory",
    }


class MarkdownStore:
    """``MemoryStore`` over the folders of ``scope_folders``. Safe to use from several threads."""

    def __init__(self, project: Path, home: Path | None = None) -> None:
        self.folders = scope_folders(project.expanduser().resolve(), home)
        self._lock = threading.Lock()

    def list(self, scope: Scope) -> list[Memory]:
        folder = self.folders[scope]
        if not folder.is_dir():
            return []
        memories = []
        for file in sorted(folder.glob("*.md")):
            if file.name == INDEX:
                continue
            try:
                text = file.read_text(encoding="utf-8")
            except OSError:
                continue
            memory = _parse(text, file.stem, scope)
            if memory is not None:
                memories.append(replace(memory, path=file))
        return memories

    def put(self, memory: Memory) -> Memory:
        name = file_name(memory.id)
        if name != memory.id:
            raise ValueError(f"not a memory id: {memory.id!r}")
        folder = self.folders[memory.scope]
        with self._lock:
            folder.mkdir(parents=True, exist_ok=True)
            file = folder / f"{name}.md"
            _write(file, _render(memory))
            self._write_index(memory.scope)
        return replace(memory, path=file)

    def remove(self, scope: Scope, memory_id: str) -> None:
        with self._lock:
            (self.folders[scope] / f"{file_name(memory_id)}.md").unlink(missing_ok=True)
            self._write_index(scope)

    def _write_index(self, scope: Scope) -> None:
        memories = self.list(scope)
        index = self.folders[scope] / INDEX
        if not memories:
            index.unlink(missing_ok=True)
            return
        lines = [f"- {m.kind}: {m.headline} → [{m.id}.md]({m.id}.md)" for m in memories]
        _write(index, "# Memory\n\n" + "\n".join(lines) + "\n")


def _render(memory: Memory) -> str:
    body = memory.body.strip()
    return f"---\nkind: {memory.kind}\n---\n# {memory.headline}\n" + (f"\n{body}\n" if body else "")


def _parse(text: str, memory_id: str, scope: Scope) -> Memory | None:
    kind = "rule"
    lines = text.splitlines()
    if lines and lines[0].strip() == "---" and "---" in (line.strip() for line in lines[1:]):
        end = next(i for i, line in enumerate(lines[1:], 1) if line.strip() == "---")
        for line in lines[1:end]:
            key, _, value = line.partition(":")
            if key.strip() == "kind" and value.strip():
                kind = value.strip()
        lines = lines[end + 1 :]
    while lines and not lines[0].strip():
        lines.pop(0)
    if not lines:
        return None
    headline = lines[0].strip().lstrip("#").strip()
    body = "\n".join(lines[1:]).strip()
    return Memory(memory_id, kind, scope, headline, body) if headline else None


def _write(file: Path, text: str) -> None:
    tmp = file.with_name(f".{file.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(file)
