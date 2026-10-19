"""``projects/judge``: is what was sent on the new-session screen work on the project, or a new app?

Stub until the judging is built (see the Alpine Cloud stage 2 work).
"""

from __future__ import annotations

from alpine_protocol import ProjectsJudgeParams, ProjectsJudgeResult

from .methods import APP_ERROR, MethodError


def judge_project(params: ProjectsJudgeParams) -> ProjectsJudgeResult:
    raise MethodError(APP_ERROR, "Not built yet", "unsupported")


HANDLERS = {"projects/judge": judge_project}
