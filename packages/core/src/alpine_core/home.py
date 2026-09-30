"""The home folder: settings, keys, projects and sessions of every project, in one place."""

from __future__ import annotations

import os
from pathlib import Path


def home_dir() -> Path:
    """``$ALPINE_CODE_HOME``, or ``~/.alpine-code``.

    Holds ``config.toml`` (settings and connections), ``auth.json`` (API keys), ``projects.json`` (opened folders)
    and ``AGENTS.md`` (instructions for every project).
    """
    return Path(os.environ.get("ALPINE_CODE_HOME") or Path.home() / ".alpine-code")
