"""``projects/create``: a project from a stack template, with the agent started on the idea.

Three steps, each announced as ``projects/createChanged`` when it is done: the template becomes a folder (committed, on
the rail); when signed in to Alpine and the template can be published, its app is made and the web address is announced
(``address``; a failure skips this step and the project is made anyway); then a session starts in it and gets the idea.
The request answers after the last step. Copying, git and the app's creation run in a thread.

The folder is picked by ``create_project``, which claims it with ``mkdir``, so two creations that run at once never get
the same one and the server keeps no list of folders being made.
"""

from __future__ import annotations

import asyncio
import shutil
import sys
import traceback
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
from alpine_core.cloud import (
    AlpineTokens,
    CloudClient,
    CloudError,
    SignedOut,
    account,
    app_name,
    create_app,
    links,
    read_description,
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

        address = await asyncio.to_thread(_make_app, folder)
        if address is not None:
            self._notify(ProjectsCreateChangedParams(id=params.id, step="address", project=project, address=address))

        # From here on the project stays whatever happens: a session that cannot start answers with its own error.
        started = await self._sessions.new(SessionNewParams(cwd=str(folder), agent=params.agent, mode=params.mode))
        session_id = started.info.id
        await self._sessions.send(SessionSendParams(session_id=session_id, text=params.idea))
        self._notify(ProjectsCreateChangedParams(id=params.id, step="agent", project=project))
        return ProjectsCreateResult(project=project, session_id=session_id, address=address)


def _make_app(folder: Path) -> str | None:
    """Makes the project's Alpine app and links it, returning its web address; ``None`` when there is nothing to do
    (signed out, not published by Alpine, a Pro template on Free) or the app could not be made. A taken name is tried
    once more with the API's suggestion. The project never fails on this: publishing later makes the app."""
    description = read_description(folder)
    if description is None or description.adapter is None:
        return None
    try:
        status = account.status()
        if not status.signed_in or not status.reachable:
            return None
        if description.kind == "web-pro" and not (status.limits or {}).get("web_pro"):
            return None  # the app shows the trial sheet first
        app = create_app(CloudClient(AlpineTokens()), app_name(folder.name), description.kind)
        links.link(folder, app.id)
        return app.address
    except (CloudError, SignedOut):  # no room, no network, a sign-in that just ended: skip the step
        return None
    except Exception:  # a bug: the project is still made
        traceback.print_exc(file=sys.stderr)
        return None


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
