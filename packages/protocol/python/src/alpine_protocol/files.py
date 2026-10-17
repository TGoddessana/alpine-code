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


FILE_METHODS = {
    "files/read": (FilesReadParams, FilesReadResult),
    "files/action": (FilesActionParams, FilesActionResult),
    "files/search": (FilesSearchParams, FilesSearchResult),
}
