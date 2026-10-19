"""Judging what was sent on the new-session screen: work on the project, or a new app (decision 13 in
docs/alpine-cloud.md).

One question to the settings' model, with no tools. The model judges; this only checks the shape of its answer. The
one product rule: when the answer is unclear, it is work on the project, so a new project is never made by mistake.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from .config import Settings


@dataclass(frozen=True)
class WorkOnProject:
    """Work on the project the screen is on."""


@dataclass(frozen=True)
class NewApp:
    template: str
    """One of the templates offered."""
    reason: str
    """One sentence in the user's language."""
    name: str
    """A safe folder name (``templates.safe_name``)."""


Judgement = WorkOnProject | NewApp


class JudgeError(Exception):
    """The model call failed."""


def judge(
    settings: Settings, text: str, locale: str, templates: Sequence[str], project: Path | None = None
) -> Judgement:
    """Asks the settings' model whether ``text`` is work on ``project`` or a new app, and for a new app which of
    ``templates`` fits, why (in ``locale``'s language) and a folder name.

    Raises:
        ConfigError: The settings cannot make a model.
        JudgeError: The model call failed.
    """
    raise NotImplementedError
