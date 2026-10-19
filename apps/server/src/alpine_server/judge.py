"""``projects/judge``: is what was sent on the new-session screen work on the project, or a new app?

One question to the default model, with no tools (see ``alpine_core.judge``). Only the templates this machine has are
offered. The app treats any error here as "work on the project", which starts the session and shows the real problem.
"""

from __future__ import annotations

from pathlib import Path

from alpine_core import ConfigError, JudgeError, NewApp, available_templates, judge
from alpine_protocol import JudgedChange, JudgedNew, ProjectsJudgeParams, ProjectsJudgeResult

from .methods import APP_ERROR, MethodError, _settings


def judge_project(params: ProjectsJudgeParams) -> ProjectsJudgeResult:
    templates = available_templates()
    if not templates or not params.text.strip():  # nothing to make, or nothing written: nothing to ask
        return ProjectsJudgeResult(judgement=JudgedChange())
    settings = _settings()
    project = Path(params.cwd).expanduser() if params.cwd else None
    if project is not None and not project.is_dir():
        project = None
    try:
        judgement = judge(settings, params.text, params.locale, templates, project)
    except ConfigError as e:
        raise MethodError(APP_ERROR, str(e), "invalid_config") from e
    except JudgeError as e:
        raise MethodError(APP_ERROR, str(e), "model_failed") from e
    if isinstance(judgement, NewApp):
        return ProjectsJudgeResult(
            judgement=JudgedNew(template=judgement.template, reason=judgement.reason, name=judgement.name)
        )
    return ProjectsJudgeResult(judgement=JudgedChange())


HANDLERS = {"projects/judge": judge_project}
