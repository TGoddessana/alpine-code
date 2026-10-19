"""``projects/create``: a project from a stack template, with the agent started on the idea.

Two steps, each announced as ``projects/createChanged`` when it is done: the template becomes a folder (committed, on
the rail), then a session starts in it and gets the idea. Nothing makes the ``address`` step yet; it comes with Alpine
sign-in. The request answers after the last step. Copying and git run in a thread.

The folder is picked by ``create_project``, which claims it with ``mkdir``, so two creations that run at once never get
the same one and the server keeps no list of folders being made.
"""

from __future__ import annotations

import asyncio
import shutil
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from alpine_core import (
    ConfigError,
    ProjectList,
    Settings,
    TemplateNotFound,
    available_templates,
    create_project,
    safe_name,
)
from alpine_protocol import (
    ProjectsCreateChangedParams,
    ProjectsCreateParams,
    ProjectsCreateResult,
    SessionNewParams,
    SessionSendParams,
)

from .methods import APP_ERROR, INVALID_PARAMS, MethodError, project_info
from .sessions import SessionManager

Notify = Callable[[ProjectsCreateChangedParams], None]


class NewProjects:
    def __init__(self, notify: Notify, sessions: SessionManager) -> None:
        self._notify = notify
        self._sessions = sessions
        self._creating: set[str] = set()

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {"projects/create": self.create}

    async def create(self, params: ProjectsCreateParams) -> ProjectsCreateResult:
        if params.id in self._creating:
            raise MethodError(INVALID_PARAMS, f"A project with id {params.id!r} is already being made")
        self._creating.add(params.id)
        try:
            return await self._create(params)
        finally:
            self._creating.discard(params.id)

    async def _create(self, params: ProjectsCreateParams) -> ProjectsCreateResult:
        if params.template not in await asyncio.to_thread(available_templates):
            raise MethodError(APP_ERROR, f"No template named {params.template!r}", "not_found")
        parent = _settings().clone_folder
        try:
            folder = await asyncio.to_thread(create_project, params.template, parent, safe_name(params.name))
        except TemplateNotFound as e:  # taken away since the check above
            raise MethodError(APP_ERROR, f"No template named {params.template!r}", "not_found") from e
        except OSError as e:
            raise MethodError(APP_ERROR, f"The project could not be made: {e}", "other") from e
        # Until the app hears about the folder it believes nothing was made, so if putting it on the rail fails
        # (a full disk, a cancelled request), what was made goes again: the error then says what is true.
        # ``projects.json`` is read and written whole, so two writers at once can lose each other's change. This
        # write runs on the loop's thread, which only keeps it apart from other creations and from sessions adding
        # their project; the handlers that open, archive or delete a project write it from a thread of their own.
        try:
            project = await asyncio.to_thread(project_info, ProjectList.default().open(folder))
        except BaseException as e:
            await asyncio.to_thread(_discard, folder)
            if isinstance(e, Exception):
                raise MethodError(APP_ERROR, f"The project could not be made: {e}", "other") from e
            raise
        self._notify(ProjectsCreateChangedParams(id=params.id, step="folder", project=project))

        # From here on the project stays whatever happens: a session that cannot start answers with its own error.
        started = await self._sessions.new(SessionNewParams(cwd=str(folder), agent=params.agent, mode=params.mode))
        session_id = started.info.id
        await self._sessions.send(SessionSendParams(session_id=session_id, text=params.idea))
        self._notify(ProjectsCreateChangedParams(id=params.id, step="agent", project=project))
        return ProjectsCreateResult(project=project, session_id=session_id)


def _discard(folder: Path) -> None:
    """Takes back a folder that was made and not announced: off the rail if it got on, and off the disk."""
    try:
        ProjectList.default().delete(folder)
    except Exception:  # the list is what failed, or it was never written
        pass
    shutil.rmtree(folder, ignore_errors=True)


def _settings() -> Settings:
    try:
        return Settings.load()
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
