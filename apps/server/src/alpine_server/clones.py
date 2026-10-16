"""The ``projects/*`` methods that wait on git: listing projects with the clones in progress, cloning, and getting git
installed.

``projects/clone`` answers once the host has answered, so a wrong address or a missing sign-in fails the request while
the app's dialog is still open; the rest of the clone runs as a task and goes out as ``projects/cloneChanged``.
"""

from __future__ import annotations

import asyncio
import sys
import time
import traceback
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from alpine_core import (
    Clone,
    CloneCancelled,
    CloneFailed,
    ConfigError,
    Credentials,
    ProjectList,
    Settings,
    git_tools_ready,
    install_git_tools,
    place,
)
from alpine_protocol import (
    CloneInfo,
    ProjectsCancelCloneParams,
    ProjectsCancelCloneResult,
    ProjectsCloneChangedParams,
    ProjectsCloneParams,
    ProjectsCloneResult,
    ProjectsGitToolsParams,
    ProjectsGitToolsResult,
    ProjectsInstallGitToolsParams,
    ProjectsInstallGitToolsResult,
    ProjectsListParams,
    ProjectsListResult,
)

from .methods import APP_ERROR, INVALID_PARAMS, MethodError, project_info

Notify = Callable[[ProjectsCloneChangedParams], None]

#: Progress goes out at most this often per clone, besides each new percent.
_PROGRESS_EVERY = 0.5

_REASONS = {"no_access": "no_access", "unreachable": "unreachable", "failed": "clone_failed"}


class Clones:
    """Clones in progress and failed ones not yet dismissed, by the id the app gave them."""

    def __init__(self, notify: Notify) -> None:
        self._notify = notify
        self._infos: dict[str, CloneInfo] = {}
        self._running: dict[str, Clone] = {}
        self._tasks: set[asyncio.Task[None]] = set()
        self._sent_at: dict[str, float] = {}

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "projects/list": self.list,
            "projects/clone": self.clone,
            "projects/cancelClone": self.cancel,
            "projects/gitTools": self.git_tools,
            "projects/installGitTools": self.install_git_tools,
        }

    async def shutdown(self) -> None:
        for clone in list(self._running.values()):
            clone.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    async def list(self, params: ProjectsListParams) -> ProjectsListResult:
        projects = await asyncio.to_thread(lambda: [project_info(p) for p in ProjectList.default().list()])
        return ProjectsListResult(projects=projects, clones=list(self._infos.values()))

    async def clone(self, params: ProjectsCloneParams) -> ProjectsCloneResult:
        address = params.address.strip()
        if not address:
            raise MethodError(INVALID_PARAMS, "No address")
        if params.id in self._infos:
            raise MethodError(INVALID_PARAMS, f"A clone with id {params.id!r} is already there")
        if not await asyncio.to_thread(git_tools_ready):
            raise MethodError(APP_ERROR, "git is not installed", "no_git_tools")
        parent = _settings().clone_folder
        taken = [Path(info.path) for info in self._infos.values()]
        known = await asyncio.to_thread(lambda: [p.path for p in ProjectList.default().list()])
        folder, existing = await asyncio.to_thread(place, address, parent, known, taken)
        if existing:
            return ProjectsCloneResult(project=await asyncio.to_thread(_open, folder), existing=True)

        credentials = Credentials(params.username, params.password) if params.username and params.password else None
        info = CloneInfo(
            id=params.id, address=address, name=folder.name, path=str(folder), state="receiving", percent=0
        )
        self._infos[params.id] = info
        try:
            clone = await Clone.start(
                address, folder, credentials=credentials, on_progress=lambda p: self._progress(params.id, p)
            )
        except CloneFailed as e:
            self._infos.pop(params.id, None)
            raise MethodError(APP_ERROR, str(e), _REASONS[e.kind]) from e
        if params.id not in self._infos:  # cancelled while git was starting
            clone.cancel()
        self._running[params.id] = clone
        await clone.contacted()

        if clone.running:  # the host answered: the rest goes on in the background
            task = asyncio.create_task(self._finish(params.id, clone))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            return ProjectsCloneResult(clone=self._infos[params.id])
        try:
            folder = await clone.wait()
        except CloneFailed as e:
            raise MethodError(APP_ERROR, str(e), _REASONS[e.kind]) from e
        except CloneCancelled as e:
            raise MethodError(APP_ERROR, "Cancelled", "clone_failed") from e
        finally:
            self._forget(params.id)
            self._infos.pop(params.id, None)
        return ProjectsCloneResult(project=await asyncio.to_thread(_open, folder))

    async def cancel(self, params: ProjectsCancelCloneParams) -> ProjectsCancelCloneResult:
        clone = self._running.get(params.id)
        if clone is not None:
            clone.cancel()  # its task announces "cancelled"
        elif (info := self._infos.pop(params.id, None)) is not None:
            self._notify(ProjectsCloneChangedParams(clone=info.model_copy(update={"state": "cancelled"})))
        return ProjectsCancelCloneResult()

    async def git_tools(self, params: ProjectsGitToolsParams) -> ProjectsGitToolsResult:
        ready = await asyncio.to_thread(git_tools_ready)
        return ProjectsGitToolsResult(ready=ready, installable=sys.platform == "darwin")

    async def install_git_tools(self, params: ProjectsInstallGitToolsParams) -> ProjectsInstallGitToolsResult:
        await asyncio.to_thread(install_git_tools)
        return ProjectsInstallGitToolsResult()

    def _progress(self, clone_id: str, progress: Any) -> None:
        info = self._infos.get(clone_id)
        if info is None:
            return
        now = time.monotonic()
        new_percent = progress.percent != info.percent
        self._infos[clone_id] = info = info.model_copy(
            update={"percent": progress.percent, "received": progress.received}
        )
        if clone_id in self._running and (new_percent or now - self._sent_at.get(clone_id, 0) >= _PROGRESS_EVERY):
            self._sent_at[clone_id] = now
            self._notify(ProjectsCloneChangedParams(clone=info))

    async def _finish(self, clone_id: str, clone: Clone) -> None:
        info = self._infos[clone_id]
        try:
            folder = await clone.wait()
            project = await asyncio.to_thread(_open, folder)
            self._forget(clone_id)
            done = self._infos.pop(clone_id, info).model_copy(update={"state": "done", "percent": 100})
            self._notify(ProjectsCloneChangedParams(clone=done, project=project))
        except CloneCancelled:
            self._forget(clone_id)
            cancelled = self._infos.pop(clone_id, info).model_copy(update={"state": "cancelled"})
            self._notify(ProjectsCloneChangedParams(clone=cancelled))
        except CloneFailed as e:
            self._forget(clone_id)
            failed = self._infos[clone_id].model_copy(
                update={"state": "failed", "reason": _REASONS[e.kind], "message": str(e)}
            )
            self._infos[clone_id] = failed
            self._notify(ProjectsCloneChangedParams(clone=failed))
        except Exception as e:  # a bug: the clone still must not hang on the rail
            traceback.print_exc(file=sys.stderr)
            self._forget(clone_id)
            failed = info.model_copy(
                update={"state": "failed", "reason": "clone_failed", "message": f"{type(e).__name__}: {e}"}
            )
            self._infos[clone_id] = failed
            self._notify(ProjectsCloneChangedParams(clone=failed))

    def _forget(self, clone_id: str) -> None:
        self._running.pop(clone_id, None)
        self._sent_at.pop(clone_id, None)


def _open(folder: Path) -> Any:
    return project_info(ProjectList.default().open(folder))


def _settings() -> Settings:
    try:
        return Settings.load()
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
