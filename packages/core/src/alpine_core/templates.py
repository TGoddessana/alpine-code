"""Stack templates new projects start from (decisions 6, 13 and 22 in docs/alpine-cloud.md).

A template is a folder in the templates folder, named by its id (``web-lite``, ``blank``...). Its project gets
everything in it: the code, ``AGENTS.md`` for the agent, and ``.alpine-code/cloud.toml``, which says how Alpine Cloud
publishes it. Nothing in it depends on Alpine, so a project is an ordinary folder that runs without Alpine.

The templates folder is the one setting below. It is a local folder for now; fetching the latest from the public
``alpine-templates`` repository later only changes ``templates_dir``.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable
from pathlib import Path

#: Overrides where the templates are.
TEMPLATES_ENV = "ALPINE_TEMPLATES"

#: The templates the app knows, in the order it shows them. Only those in the templates folder can be made.
KNOWN = ("blank", "web-lite", "web-pro", "mobile")

#: A project name when the model's suggestion has nothing usable in it.
FALLBACK_NAME = "new-app"


class TemplateNotFound(Exception):
    """The templates folder has no template with that id."""


def templates_dir() -> Path:
    """``$ALPINE_TEMPLATES``, else ``~/Developments/alpine-templates``."""
    return Path(os.environ.get(TEMPLATES_ENV) or Path.home() / "Developments" / "alpine-templates").expanduser()


def available_templates(root: Path | None = None) -> list[str]:
    """The known templates the templates folder has, in ``KNOWN`` order."""
    root = root or templates_dir()
    return [template for template in KNOWN if (root / template).is_dir()]


def safe_name(name: str) -> str:
    """A folder name from a suggested one: lowercase ASCII letters, digits and single ``-``, at most 40 characters.
    ``FALLBACK_NAME`` when nothing is left."""
    cleaned = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return cleaned[:40].rstrip("-") or FALLBACK_NAME


def create_project(template: str, parent: Path, name: str, taken: Iterable[Path] = ()) -> Path:
    """Copies the template into a new folder in ``parent`` and makes it a git repository with the template as its
    first commit. Returns the folder.

    Raises:
        TemplateNotFound: The templates folder has no such template.
    """
    raise NotImplementedError
