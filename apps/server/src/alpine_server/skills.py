"""The ``skills/*`` methods: the user's skills, and getting new ones from wherever the user found them."""

from __future__ import annotations

import re
from pathlib import Path

from alpine_core import Skill, SkillError, SkillFetcher, SkillLibrary, home_dir, search_skills
from alpine_protocol import (
    SkillCandidate,
    SkillHit,
    SkillInfo,
    SkillsAddParams,
    SkillsAddResult,
    SkillsGetParams,
    SkillsGetResult,
    SkillsListParams,
    SkillsListResult,
    SkillsRemoveParams,
    SkillsRemoveResult,
    SkillsSaveParams,
    SkillsSaveResult,
    SkillsSearchParams,
    SkillsSearchResult,
)

from .methods import APP_ERROR, INVALID_PARAMS, MethodError

_libraries: dict[Path, SkillLibrary] = {}
_fetcher = SkillFetcher()


def skills() -> SkillLibrary:
    """The skill library of the current home folder, made once, shared by every handler and session."""
    home = home_dir()
    if home not in _libraries:
        _libraries[home] = SkillLibrary(home)
    return _libraries[home]


def list_skills(params: SkillsListParams) -> SkillsListResult:
    library = skills()
    found = library.for_project(Path(params.cwd)) if params.cwd else library.installed()
    return SkillsListResult(skills=[skill_info(s) for s in found], folder=str(library.folder))


def add_skills(params: SkillsAddParams) -> SkillsAddResult:
    """Finds the skills at the source and installs them: all of them when there is one or the source names it,
    else the ones in ``names``, else none, and the choices go back."""
    library = skills()
    try:
        found = _fetcher.find(params.source)
    except SkillError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e
    have = {s.name for s in library.installed()}
    if params.names is None and len(found.skills) > 1:
        choices = [
            SkillCandidate(name=s.name, description=s.description, has_scripts=s.has_scripts, installed=s.name in have)
            for s in found.skills
        ]
        return SkillsAddResult(source=found.source, added=[], choices=choices)
    picked = [s for s in found.skills if params.names is None or s.name in params.names]
    if not picked:
        raise MethodError(APP_ERROR, f"None of {params.names} in {found.source}", "no_skills")
    added = []
    for skill in picked:
        # Recorded so the same skill can be fetched again: a repository with several gets the skill's name.
        several = len(found.skills) > 1 and re.fullmatch(r"[\w.-]+/[\w.-]+", found.source)
        source = f"{found.source}/{skill.name}" if several else found.source
        try:
            added.append(skill_info(library.install(skill.folder, source)))
        except SkillError as e:
            raise MethodError(APP_ERROR, str(e), e.reason) from e
    return SkillsAddResult(source=found.source, added=added, choices=[])


def get_skill(params: SkillsGetParams) -> SkillsGetResult:
    skill = skills().get(params.name, Path(params.cwd) if params.cwd else None)
    if skill is None:
        raise MethodError(INVALID_PARAMS, f"No skill named {params.name}", "not_found")
    try:
        text = skill.file.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise MethodError(APP_ERROR, str(e), "not_found") from e
    files, _ = skill.files(limit=200)
    return SkillsGetResult(skill=skill_info(skill), text=text, files=files)


def save_skill(params: SkillsSaveParams) -> SkillsSaveResult:
    try:
        return SkillsSaveResult(skill=skill_info(skills().write(params.name, params.text, new=params.new)))
    except SkillError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e


def remove_skill(params: SkillsRemoveParams) -> SkillsRemoveResult:
    try:
        skills().remove(params.name)
    except SkillError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e
    return SkillsRemoveResult()


def search(params: SkillsSearchParams) -> SkillsSearchResult:
    try:
        hits = search_skills(params.query)
    except SkillError as e:
        raise MethodError(APP_ERROR, str(e), e.reason) from e
    return SkillsSearchResult(
        hits=[SkillHit(name=h.name, source=h.source, id=h.id, installs=h.installs) for h in hits]
    )


def skill_info(skill: Skill) -> SkillInfo:
    return SkillInfo(
        name=skill.name,
        description=skill.description,
        origin=skill.origin,
        source=skill.source,
        folder=str(skill.folder),
        has_scripts=skill.has_scripts,
        notes=list(skill.notes),
    )


HANDLERS = {
    "skills/list": list_skills,
    "skills/add": add_skills,
    "skills/get": get_skill,
    "skills/save": save_skill,
    "skills/remove": remove_skill,
    "skills/search": search,
}
