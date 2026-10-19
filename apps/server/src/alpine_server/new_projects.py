"""``projects/create``: a project from a stack template, with the agent started on the idea.

Stub until creating is built (see the Alpine Cloud stage 2 work).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from alpine_protocol import ProjectsCreateChangedParams, ProjectsCreateParams, ProjectsCreateResult

from .methods import APP_ERROR, MethodError
from .sessions import SessionManager

Notify = Callable[[ProjectsCreateChangedParams], None]


class NewProjects:
    def __init__(self, notify: Notify, sessions: SessionManager) -> None:
        self._notify = notify
        self._sessions = sessions

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {"projects/create": self.create}

    async def create(self, params: ProjectsCreateParams) -> ProjectsCreateResult:
        raise MethodError(APP_ERROR, "Not built yet", "unsupported")
