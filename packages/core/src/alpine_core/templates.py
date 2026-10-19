"""Stack templates new projects start from (decisions 6, 13 and 22 in docs/alpine-cloud.md).

A template is a folder in the templates folder, named by its id (``web-lite``, ``blank``...). Its project gets
everything in it: the code, ``AGENTS.md`` for the agent, and ``.alpine-code/cloud.toml``, which says how Alpine Cloud
publishes it. Nothing in it depends on Alpine, so a project is an ordinary folder that runs without Alpine.

The templates folder is the one setting below (``templates_dir``): ``$ALPINE_TEMPLATES``, else the local
``~/Developments/alpine-templates`` while it exists, else a copy fetched from the public ``alpine-templates``
repository into ``~/.alpine-code/templates/<commit>``. Until that repository exists (``TEMPLATES_REPO`` is ``None``)
nothing is fetched.
"""

from __future__ import annotations

import itertools
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Iterable
from pathlib import Path

from .cloning import git_tools_ready
from .home import home_dir

#: Overrides where the templates are.
TEMPLATES_ENV = "ALPINE_TEMPLATES"

#: The public repository the templates are fetched from when no local folder has them. ``None`` until the user
#: creates it; with ``None`` nothing is fetched.
TEMPLATES_REPO: str | None = None

#: The templates the app knows, in the order it shows them. Only those in the templates folder can be made.
KNOWN = ("blank", "web-lite", "web-pro", "mobile")

#: A project name when the model's suggestion has nothing usable in it.
FALLBACK_NAME = "new-app"

#: Left out of the copy, wherever they are in the template: git's own folder, what installing, building and running
#: write (the local database, the dev sign-in's cookie file, build caches), and a developer's local secrets. The
#: templates folder is a working copy that is run in place, so whatever a template's own ``.gitignore`` keeps out of git
#: belongs here too; a copied cookie file would carry a session of the template's local database into a project.
_NOT_COPIED = (".git", "node_modules", ".wrangler", "dist", ".dev.vars*", ".dev.jar", "*.tsbuildinfo", ".DS_Store")

#: Who the first commit is by. Only that commit: it is given to git for that one call and written nowhere.
_AUTHOR_NAME = "Alpine Code"
_AUTHOR_EMAIL = "noreply@alpinecode.app"

#: Seconds one git command gets.
_GIT_TIMEOUT = 120


class TemplateNotFound(Exception):
    """The templates folder has no template with that id."""


def templates_dir() -> Path:
    """``$ALPINE_TEMPLATES``, else ``~/Developments/alpine-templates`` while it exists, else the newest fetched copy
    (``~/.alpine-code/templates/<commit>``). With none of them, the local path above: nothing is there, and
    ``available_templates`` says so."""
    if os.environ.get(TEMPLATES_ENV):
        return Path(os.environ[TEMPLATES_ENV]).expanduser()
    local = Path.home() / "Developments" / "alpine-templates"
    if local.is_dir():
        return local
    return fetched_templates() or local


def fetched_templates() -> Path | None:
    """The newest copy ``fetch_templates`` made, or ``None``."""
    root = home_dir() / "templates"
    copies = [p for p in root.glob("*") if p.is_dir()] if root.is_dir() else []
    return max(copies, key=lambda p: p.stat().st_mtime, default=None)


def fetch_templates(repo: str | None = None) -> Path | None:
    """Fetches the public templates repository into ``~/.alpine-code/templates/<commit>`` (the latest commit, no
    history) and returns the folder; the copy already there when it is the latest. ``None`` while there is no
    repository address (``TEMPLATES_REPO``) or git cannot run.

    Raises:
        OSError: git failed.
    """
    repo = repo or TEMPLATES_REPO
    if repo is None or not git_tools_ready():
        return None
    root = home_dir() / "templates"
    root.mkdir(parents=True, exist_ok=True)
    scratch = Path(tempfile.mkdtemp(prefix="fetch-", dir=root))
    try:
        _git(scratch.parent, "clone", "-q", "--depth", "1", repo, str(scratch))
        commit = _git(scratch, "rev-parse", "HEAD").strip()
        shutil.rmtree(scratch / ".git", ignore_errors=True)
        folder = root / commit
        if folder.is_dir():
            return folder
        scratch.rename(folder)
        return folder
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _git(cwd: Path, *args: str) -> str:
    try:
        done = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, timeout=_GIT_TIMEOUT)
    except subprocess.TimeoutExpired as e:
        raise OSError(f"git {args[0]} took too long") from e
    if done.returncode != 0:
        lines = (done.stderr or done.stdout).strip().splitlines()
        raise OSError(f"git {args[0]} failed: {lines[-1] if lines else done.returncode}")
    return done.stdout


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

    The folder is ``parent/<name>``, or ``<name>-2``, ``<name>-3``... when taken: the first that does not exist (the
    rule clones follow) and is not in ``taken``, the folders other creations are writing to. It is claimed with
    ``mkdir`` before anything is copied, so two creations that run at once, even in two processes, never get the same
    one. ``name`` goes through ``safe_name`` again, so it cannot name anything outside ``parent``.

    The copy leaves out ``.git``, ``node_modules``, ``.wrangler``, ``dist``, ``.dev.vars*``, ``.dev.jar``,
    ``*.tsbuildinfo`` and ``.DS_Store``. The commit is on branch ``main``, by ``Alpine Code <noreply@alpinecode.app>``
    and with no signing or hooks, whatever the user's git is set up to do; the user's git config is not touched, so the
    agent's later changes show as changes against the template. Where git cannot run (``git_tools_ready``) the folder
    is made without it.

    Raises:
        TemplateNotFound: The templates folder has no such template.
        OSError: The folder could not be written, or git failed. Nothing of the folder is left.
    """
    source = templates_dir() / template
    if template in ("", ".", "..") or Path(template).name != template or not source.is_dir():
        raise TemplateNotFound(template)
    folder = _claim(Path(parent), safe_name(name), taken)
    try:
        shutil.copytree(source, folder, symlinks=True, dirs_exist_ok=True, ignore=shutil.ignore_patterns(*_NOT_COPIED))
        if git_tools_ready():
            _commit_template(folder, template)
    except BaseException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return folder


def _claim(parent: Path, name: str, taken: Iterable[Path]) -> Path:
    """Makes the first free folder of ``name``, ``name-2``... in ``parent`` and returns it."""
    parent = parent.expanduser().resolve()
    busy = {Path(p).expanduser().resolve() for p in taken}
    parent.mkdir(parents=True, exist_ok=True)
    for n in itertools.count(1):
        folder = parent / (name if n == 1 else f"{name}-{n}")
        if folder in busy:
            continue
        try:
            folder.mkdir()
        except FileExistsError:
            continue
        return folder
    raise AssertionError("unreachable")


def _commit_template(folder: Path, template: str) -> None:
    # An author in the user's environment would win over -c, and a language other than English would change what
    # git's last line says.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("GIT_AUTHOR_", "GIT_COMMITTER_"))}
    env["LC_ALL"] = "C"
    # Given to the commit alone, so the repository's config stays empty. Not signed, because the user's key is not
    # Alpine's to use (and signing may ask for a passphrase); no hooks, because the user's are for their own commits.
    author = ("-c", f"user.name={_AUTHOR_NAME}", "-c", f"user.email={_AUTHOR_EMAIL}", "-c", "commit.gpgsign=false")
    # ``symbolic-ref`` rather than ``init -b``: older git has no -b, and init.defaultBranch is the user's to set.
    steps = (
        ("init", "-q"),
        ("symbolic-ref", "HEAD", "refs/heads/main"),
        ("add", "-A"),
        ("commit", "-q", "--allow-empty", "--no-verify", "-m", f"Start from the {template} template"),
    )
    for verb, *args in steps:
        command = ["git", "-C", str(folder), *(author if verb == "commit" else ()), verb, *args]
        try:
            done = subprocess.run(command, capture_output=True, text=True, env=env, timeout=_GIT_TIMEOUT)
        except subprocess.TimeoutExpired as e:
            raise OSError(f"git {verb} took too long") from e
        if done.returncode != 0:
            lines = (done.stderr or done.stdout).strip().splitlines()
            raise OSError(f"git {verb} failed: {lines[-1] if lines else done.returncode}")
