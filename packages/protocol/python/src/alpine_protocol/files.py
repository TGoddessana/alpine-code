"""Workspace-scoped source viewing and navigation."""

from typing import Literal

from pydantic import Field

from .base import Message


class FilesReadParams(Message):
    cwd: str
    path: str
    line: int = Field(default=1, ge=1)
    start_line: int | None = Field(default=None, ge=1)
    limit: int = Field(default=400, ge=1, le=1000)


class FilesReadResult(Message):
    path: str
    relative_path: str
    content: str
    start_line: int
    total_lines: int
    line: int
    truncated: bool


class FilesActionParams(Message):
    cwd: str
    path: str
    line: int = Field(default=1, ge=1)
    action: Literal["editor", "reveal"]


class FilesActionResult(Message):
    ok: bool = True


class FilesSearchParams(Message):
    cwd: str
    query: str
    limit: int = Field(default=50, ge=1, le=100)


class FilesSearchResult(Message):
    paths: list[str]
    truncated: bool = False


class FilesListParams(Message):
    cwd: str
    path: str = ""
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=200, ge=1, le=500)


class FileEntry(Message):
    name: str
    path: str
    kind: Literal["directory", "file", "symlink"]


class FilesListResult(Message):
    entries: list[FileEntry]
    next_offset: int
    has_more: bool


FILE_METHODS = {
    "files/list": (FilesListParams, FilesListResult),
    "files/read": (FilesReadParams, FilesReadResult),
    "files/action": (FilesActionParams, FilesActionResult),
    "files/search": (FilesSearchParams, FilesSearchResult),
}
