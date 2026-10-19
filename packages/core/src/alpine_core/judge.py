"""Judging what was sent on the new-session screen: work on the project, or a new app (decision 13 in
docs/alpine-cloud.md).

One question to the settings' model, with no tools. The model judges; this only checks the shape of its answer. The
one product rule: when the answer is unclear, it is work on the project, so a new project is never made by mistake.

When the person chose to make a new project (``new_project``), it is certainly new: the model is asked only for the
template, the reason and the name and is never offered "change", so the answer is always a ``NewApp``. When its answer
cannot be used, that is the plain ``web-lite`` (else the first template offered) with no reason, so the person still
gets a project to start from.

The model may be a weaker or a reasoning one, so its answer can come with text or thinking around the JSON. The answer
is the last JSON object in the reply that parses.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Sequence
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any

from alpineagents import Agent, AlpineAgentsError

from .config import ConfigError, Settings
from .models import make_model
from .templates import safe_name


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


#: What the model is told about each setup, as the screen names it: ``(names, what it is for)``. A template the
#: prompt does not describe is offered by its id alone.
_SETUPS = {
    "blank": (
        "Empty project / 빈 프로젝트",
        "Nothing is set up. For whatever is not a web page with sign-in and saved data: scripts, automations, "
        "command-line tools, bots, data work, libraries, or a stack the other setups do not cover.",
    ),
    "web-lite": (
        "Web app Lite / 웹앱 Lite",
        "A web app with sign-in and saved data, ready to run. Fits most apps: bookings, notes, lists, dashboards, "
        "small shops, tools for a team. Comfortable up to thousands of visitors a day.",
    ),
    "web-pro": (
        "Web app Pro / 웹앱 Pro",
        "A web app for heavier needs: live updates (chat, editing together, live dashboards), lots of photos or "
        "videos, records that keep piling up, many people saving at the same time, or AI search.",
    ),
    "mobile": ("Mobile app / 모바일 앱", "An app people install on their phone."),
}

#: Longest message sent to the model, in characters; a pasted log or spec past this is cut.
TEXT_LIMIT = 8000
#: Most top-level names of the open project the model is shown.
LISTED_NAMES = 40
#: How much of the open project's README the model is shown.
README_LINES = 20
README_CHARS = 1500
#: Names that tell the model nothing about the open project.
_NOISE = frozenset({".git", ".DS_Store", "node_modules", "__pycache__"})
#: How far back from the end of the reply to look for the answer, in characters.
_ANSWER_WINDOW = 20000
#: Seconds the model gets to answer. A model that stalls is a failed call, which the app treats as work on the
#: project, instead of the screen waiting for the SDK to give up. Replies of a slow model take up to half a minute, and
#: a late answer is worth more than a wrong "work on the project", so this is well past that.
TIMEOUT = 45


def judge(
    settings: Settings,
    text: str,
    locale: str,
    templates: Sequence[str],
    project: Path | None = None,
    *,
    new_project: bool = False,
) -> Judgement:
    """Asks the settings' model whether ``text`` is work on ``project`` or a new app, and for a new app which of
    ``templates`` fits, why (in ``locale``'s language) and a folder name.

    With ``new_project`` the person chose to make a new project: ``project`` is not shown, the model only picks the
    template, and the answer is a ``NewApp`` whatever the model says. A model answer that cannot be used gives the
    fallback template (``web-lite`` if offered, else the first offered) with an empty reason.

    With no templates there is nothing to make, and with nothing written there is nothing to decide, so it is work on
    the project and the model is not asked.

    Raises:
        ConfigError: The settings cannot make a model.
        JudgeError: The model call failed, or took longer than ``TIMEOUT`` seconds.
    """
    offered = list(dict.fromkeys(templates))
    if not offered or not text.strip():
        return WorkOnProject()
    try:
        agent = Agent(make_model(settings), system=_system(offered, new_project), tools=[], human=None, reporter=None)
    except ValueError as e:  # a model name alpineagents cannot resolve
        raise ConfigError(str(e)) from e
    except AlpineAgentsError as e:
        raise JudgeError(str(e)) from e
    try:
        answer = _run(agent, _message(text, locale, project, shown=not new_project))
    except AlpineAgentsError as e:
        raise JudgeError(str(e)) from e
    answer = answer if isinstance(answer, str) else str(answer)
    return _parse_new(answer, offered) if new_project else _parse(answer, offered)


def _run(agent: Agent, message: str) -> Any:
    """``agent.run(message)``, given up on after ``TIMEOUT`` seconds. The call cannot be interrupted, so it goes on in
    a thread of its own that nothing waits for, and its late answer is dropped."""
    outcome: list[Any] = []

    def call() -> None:
        try:
            outcome.append((True, agent.run(message)))
        except BaseException as e:  # handed to the caller below
            outcome.append((False, e))

    thread = threading.Thread(target=call, name="judge", daemon=True)
    thread.start()
    thread.join(TIMEOUT)
    if not outcome:
        raise JudgeError(f"The model did not answer within {TIMEOUT} seconds.")
    ok, value = outcome[0]
    if not ok:
        raise value
    return value


def _parse(answer: str, templates: Sequence[str]) -> Judgement:
    """The judgement in a model's reply: the last JSON object in it. Anything that is not clearly a new app with a
    template among ``templates`` and a reason is work on the project."""
    found = _last_object(answer)
    if found is None:
        return WorkOnProject()
    kind = found.get("kind")
    if not isinstance(kind, str) or kind.strip().lower() != "new":
        return WorkOnProject()
    template = found.get("template")
    offered = {t.lower(): t for t in templates}
    if not isinstance(template, str) or template.strip().lower() not in offered:
        return WorkOnProject()
    reason = found.get("reason")
    reason = " ".join(reason.split()) if isinstance(reason, str) else ""
    if not reason:
        return WorkOnProject()
    name = found.get("name")
    return NewApp(offered[template.strip().lower()], reason, safe_name(name if isinstance(name, str) else ""))


def _parse_new(answer: str, templates: Sequence[str]) -> NewApp:
    """The new app in a model's reply, when the person chose to make a new project: the last JSON object in it. A
    template among ``templates`` is taken with its reason, which may be empty. Anything else (no JSON, "change", a
    template not offered) is the fallback template with no reason, and the name is still the model's."""
    found = _last_object(answer) or {}
    name = found.get("name")
    name = safe_name(name if isinstance(name, str) else "")
    kind, template, reason = found.get("kind"), found.get("template"), found.get("reason")
    offered = {t.lower(): t for t in templates}
    chosen = offered.get(template.strip().lower()) if isinstance(template, str) else None
    if chosen is None or (isinstance(kind, str) and kind.strip().lower() == "change"):
        # The template a new project starts from when the model gave none: the one that fits most ideas, else the first.
        return NewApp(offered.get("web-lite", templates[0]), "", name)
    return NewApp(chosen, " ".join(reason.split()) if isinstance(reason, str) else "", name)


def _last_object(answer: str) -> dict[str, Any] | None:
    """The last top-level JSON object in ``answer`` that parses, wherever it sits in the text (after thinking, inside a
    fenced block, with a sentence around it). An object inside another one does not count on its own."""
    tail = answer[-_ANSWER_WINDOW:]
    decoder = json.JSONDecoder()
    last = None
    position = tail.find("{")
    while position != -1:
        try:
            value, end = decoder.raw_decode(tail, position)
        except (ValueError, RecursionError):
            position = tail.find("{", position + 1)
            continue
        if isinstance(value, dict):
            last = value
        position = tail.find("{", end)
    return last


def _system(templates: Sequence[str], new_project: bool = False) -> str:
    """The prompt: the one for a new project or the one that also decides, with the setups offered and the rules for
    the reason and the name (``prompts/judge_fields.md``) that both share."""
    prompt = _prompt("judge_new" if new_project else "judge").replace("{{fields}}", _prompt("judge_fields").strip())
    return prompt.replace("{{templates}}", "\n".join(_setup(template) for template in templates))


def _prompt(name: str) -> str:
    return files("alpine_core").joinpath(f"prompts/{name}.md").read_text(encoding="utf-8")


def _setup(template: str) -> str:
    described = _SETUPS.get(template)
    if described is None:
        return f"- `{template}`"
    names, about = described
    return f'- `{template}` (shown as "{names}"): {about}'


def _message(text: str, locale: str, project: Path | None, shown: bool = True) -> str:
    """The locale, the open project (left out when ``shown`` is off: a new project has nothing to tell apart) and the
    text."""
    text = text.strip()
    if len(text) > TEXT_LIMIT:
        text = text[:TEXT_LIMIT].rstrip() + "…"
    glimpse = f"{_glimpse(project)}\n\n" if shown else ""
    return f"<locale>{locale}</locale>\n\n{glimpse}<message>\n{text}\n</message>"


def _glimpse(project: Path | None) -> str:
    """What the model is shown of the open project: its folder name, its top-level names and the start of its
    README. Only what can be read; an unreadable folder shows less."""
    if project is None or not project.is_dir():
        return "<open_project>\nNo project is open.\n</open_project>"
    try:
        name = project.resolve().name
    except OSError:
        name = project.name
    lines = [f"name: {name}"]
    try:
        entries = sorted((p for p in project.iterdir() if p.name not in _NOISE), key=lambda p: p.name.lower())
    except OSError:
        entries = []
    if entries:
        shown = [p.name + "/" if p.is_dir() else p.name for p in entries[:LISTED_NAMES]]
        more = f" (and {len(entries) - LISTED_NAMES} more)" if len(entries) > LISTED_NAMES else ""
        lines.append("top-level files and folders: " + ", ".join(shown) + more)
    readme = _readme(entries)
    if readme:
        lines.append("start of the README:\n" + readme)
    return "<open_project>\n" + "\n".join(lines) + "\n</open_project>"


def _readme(entries: Sequence[Path]) -> str:
    for entry in entries:
        if entry.name.lower().startswith("readme") and entry.is_file():
            try:
                with entry.open("rb") as file:
                    head = file.read(README_CHARS * 4).decode("utf-8", errors="replace")
            except OSError:
                return ""
            return "\n".join(head.splitlines()[:README_LINES])[:README_CHARS].strip()
    return ""
