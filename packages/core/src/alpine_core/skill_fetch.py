"""Getting skills from wherever the user found them: a GitHub link, a skills.sh page, the ``npx skills add`` line
such a page shows, ``owner/repo/skill``, a link to a zip or a ``SKILL.md``, or a file or folder on this computer
(a ``.zip``, a ``.skill``, a folder). Whatever it is, it becomes a folder to look in for skills.

Downloads go to a temporary folder kept for a few minutes, so picking from a repository with many skills does not
download it again. GitHub repositories come as one archive from codeload.github.com, which needs no API key and has
no rate limit for public repositories.
"""

from __future__ import annotations

import io
import re
import shlex
import shutil
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .skills import SKILL_FILE, Skill, SkillError, find_skill_folders, read_skill, slug

#: Largest download, in bytes.
MAX_DOWNLOAD = 100 * 1024 * 1024
#: Largest unpacked archive, in bytes.
MAX_UNPACKED = 300 * 1024 * 1024
#: How long a download is kept for picking from it.
KEEP_SECONDS = 600

SEARCH_URL = "https://skills.sh/api/search"


@dataclass(frozen=True)
class Where:
    """Where a source points: a GitHub repository (and a folder in it, or a skill by name), a web address, or a
    path on this computer."""

    kind: str
    """``github``, ``url`` or ``path``."""
    owner: str = ""
    repo: str = ""
    ref: str = "HEAD"
    subdir: str = ""
    want: str = ""
    """A skill picked by name (skills.sh links, ``--skill``, ``owner/repo/skill``)."""
    url: str = ""
    path: str = ""

    @property
    def label(self) -> str:
        """The source as Alpine records it, to show and to fetch again."""
        if self.kind == "github":
            parts = [self.owner, self.repo]
            if self.subdir:
                return f"https://github.com/{self.owner}/{self.repo}/tree/{self.ref}/{self.subdir}"
            if self.want:
                parts.append(self.want)
            return "/".join(parts)
        return self.url or self.path


_GH_NAME = r"[A-Za-z0-9_.-]+"


def parse_source(text: str) -> Where:
    """What ``text`` points at.

    Raises:
        SkillError: ``unknown_source``, it is none of the kinds above.
    """
    text = text.strip().strip("<>").strip()
    if not text:
        raise SkillError("Nothing to add", "unknown_source")
    want = ""
    if re.match(r"^(npx|pnpx|bunx)\s", text) or text.startswith("skills add "):
        try:
            words = shlex.split(text)
        except ValueError:
            words = text.split()
        args = [w for w in words if w not in ("npx", "pnpx", "bunx", "-y", "--yes", "skills", "add", "skills@latest")]
        rest: list[str] = []
        i = 0
        while i < len(args):
            if args[i] in ("--skill", "-s") and i + 1 < len(args):
                want = args[i + 1]
                i += 2
                continue
            if not args[i].startswith("-"):
                rest.append(args[i])
            i += 1
        if not rest:
            raise SkillError(f"No source in {text!r}", "unknown_source")
        where = parse_source(rest[0])
        return Where(**{**where.__dict__, "want": want or where.want})
    if text.startswith(("~", "/", "./", "../")) or re.match(r"^[A-Za-z]:\\", text):
        return Where("path", path=str(Path(text).expanduser()))
    if text.startswith("file://"):
        return Where("path", path=urllib.parse.unquote(urllib.parse.urlsplit(text).path))
    if re.match(rf"^{_GH_NAME}/{_GH_NAME}(/{_GH_NAME})?$", text) and "." not in text.split("/")[0]:
        parts = text.split("/")
        return Where("github", owner=parts[0], repo=_repo(parts[1]), want=parts[2] if len(parts) > 2 else "")
    if not re.match(r"^https?://", text):
        if re.match(r"^(www\.)?(github\.com|skills\.sh)/", text):
            text = "https://" + text
        else:
            raise SkillError(f"Not a link, a path or owner/repo: {text!r}", "unknown_source")
    url = urllib.parse.urlsplit(text)
    host = url.netloc.lower().removeprefix("www.")
    parts = [urllib.parse.unquote(p) for p in url.path.split("/") if p]
    if host == "github.com" and len(parts) >= 2:
        owner, repo = parts[0], _repo(parts[1])
        if len(parts) >= 4 and parts[2] in ("tree", "blob"):
            ref, sub = parts[3], parts[4:]
            if sub and sub[-1] == SKILL_FILE:
                sub = sub[:-1]
            return Where("github", owner=owner, repo=repo, ref=ref, subdir="/".join(sub))
        return Where("github", owner=owner, repo=repo)
    if host == "raw.githubusercontent.com" and len(parts) >= 4:
        sub = parts[3:]
        if sub and sub[-1] == SKILL_FILE:
            sub = sub[:-1]
        return Where("github", owner=parts[0], repo=parts[1], ref=parts[2], subdir="/".join(sub))
    if host == "skills.sh" and len(parts) >= 2:
        return Where("github", owner=parts[0], repo=parts[1], want=parts[2] if len(parts) > 2 else "")
    return Where("url", url=text)


def _repo(name: str) -> str:
    return name.removesuffix(".git")


@dataclass(frozen=True)
class Found:
    """What a source holds: its skills, read from the downloaded or local copy."""

    source: str
    skills: tuple[Skill, ...]


Download = Callable[[str], bytes]


def download(url: str, limit: int = MAX_DOWNLOAD, timeout: float = 60) -> bytes:
    """The body at ``url``.

    Raises:
        SkillError: ``not_found`` (404), ``too_big``, or ``offline`` (any other network failure).
    """
    request = urllib.request.Request(url, headers={"User-Agent": "alpine-code"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(limit + 1)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise SkillError(f"Nothing at {url}", "not_found") from e
        raise SkillError(f"{url}: HTTP {e.code}", "offline") from e
    except (OSError, urllib.error.URLError) as e:
        raise SkillError(f"Cannot reach {url}: {e}", "offline") from e
    if len(data) > limit:
        raise SkillError(f"{url} is larger than {limit // (1024 * 1024)} MB", "too_big")
    return data


class SkillFetcher:
    """Turns sources into skills to install, keeping each download for ``KEEP_SECONDS``. Safe to use from several
    threads."""

    def __init__(self, get: Download = download, keep: float = KEEP_SECONDS) -> None:
        self._get = get
        self._keep = keep
        self._cache: dict[tuple[str, ...], tuple[float, Path]] = {}
        self._lock = threading.Lock()

    def find(self, text: str) -> Found:
        """The skills ``text`` points at. A source that names one skill (a folder link, ``--skill``) gives that
        one; otherwise every skill in it.

        Raises:
            SkillError: ``unknown_source``, ``not_found``, ``offline``, ``too_big``, ``bad_archive``, or
                ``no_skills`` (it holds none, or not the one it names).
        """
        where = parse_source(text)
        root = self._root(where)
        folders = find_skill_folders(root)
        skills = [s for s in (read_skill(f, "alpine") for f in folders) if s is not None]
        if where.want:
            picked = [s for s in skills if where.want in (s.name, s.folder.name, slug(s.name), slug(s.folder.name))]
            if not picked:
                picked = [s for s in skills if slug(where.want) in (slug(s.name), slug(s.folder.name))]
            skills = picked[:1]
        if not skills:
            raise SkillError(f"No skills in {where.label}", "no_skills")
        return Found(where.label, tuple(skills))

    def _root(self, where: Where) -> Path:
        if where.kind == "path":
            return self._local(Path(where.path))
        key = (where.kind, where.owner, where.repo, where.ref, where.url)
        with self._lock:
            self._sweep()
            cached = self._cache.get(key)
            if cached is not None:
                folder = cached[1]
            else:
                folder = None
        if folder is None:
            folder = Path(tempfile.mkdtemp(prefix="alpine-skill-"))
            try:
                if where.kind == "github":
                    data = self._github(where)
                    _untar(data, folder)
                else:
                    data = self._get(where.url)
                    _unpack_download(data, where.url, folder)
            except BaseException:
                shutil.rmtree(folder, ignore_errors=True)
                raise
            with self._lock:
                self._cache[key] = (time.monotonic(), folder)
        if where.kind == "github":
            tops = [p for p in folder.iterdir() if p.is_dir()]
            top = tops[0] if len(tops) == 1 else folder
            root = (top / where.subdir).resolve() if where.subdir else top.resolve()
            if not root.is_relative_to(folder.resolve()) or not root.is_dir():
                raise SkillError(f"No folder {where.subdir} in {where.owner}/{where.repo}", "no_skills")
            return root
        return folder

    def _github(self, where: Where) -> bytes:
        url = f"https://codeload.github.com/{where.owner}/{where.repo}/tar.gz/{urllib.parse.quote(where.ref)}"
        return self._get(url)

    def _local(self, path: Path) -> Path:
        if not path.exists():
            raise SkillError(f"No such file or folder: {path}", "not_found")
        if path.is_dir():
            return path
        if path.name == SKILL_FILE:
            return path.parent
        folder = Path(tempfile.mkdtemp(prefix="alpine-skill-"))
        try:
            data = path.read_bytes()
            _unpack_download(data, path.name, folder)
        except BaseException:
            shutil.rmtree(folder, ignore_errors=True)
            raise
        with self._lock:
            self._cache[("path", str(path), str(time.time()))] = (time.monotonic(), folder)
        return folder

    def _sweep(self) -> None:
        now = time.monotonic()
        for key, (at, folder) in list(self._cache.items()):
            if now - at > self._keep:
                shutil.rmtree(folder, ignore_errors=True)
                del self._cache[key]

    def close(self) -> None:
        """Deletes every kept download."""
        with self._lock:
            for _, folder in self._cache.values():
                shutil.rmtree(folder, ignore_errors=True)
            self._cache.clear()


def _unpack_download(data: bytes, name: str, folder: Path) -> None:
    """Unpacks a zip (``.zip``, ``.skill``) or tar archive into ``folder``; a lone ``SKILL.md`` becomes a skill
    folder named after it."""
    if data[:4] == b"PK\x03\x04":
        _unzip(data, folder)
    elif data[:2] == b"\x1f\x8b" or name.endswith((".tar", ".tgz", ".tar.gz")):
        _untar(data, folder)
    elif data.lstrip()[:3] == b"---":
        text = data.decode("utf-8", errors="replace")
        skill_dir = folder / "skill"
        skill_dir.mkdir()
        (skill_dir / SKILL_FILE).write_text(text, encoding="utf-8")
        found = read_skill(skill_dir, "alpine")
        if found is not None and slug(found.name):
            skill_dir.rename(folder / slug(found.name))
    else:
        raise SkillError(f"{name} is not a skill, a zip or a SKILL.md", "bad_archive")


def _unzip(data: bytes, folder: Path) -> None:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise SkillError("The zip file is damaged", "bad_archive") from e
    total = 0
    root = folder.resolve()
    for info in archive.infolist():
        if info.filename.startswith("__MACOSX/") or info.is_dir():
            continue
        total += info.file_size
        if total > MAX_UNPACKED:
            raise SkillError("The archive is too large", "too_big")
        target = (folder / info.filename).resolve()
        if not target.is_relative_to(root):
            raise SkillError(f"The archive writes outside its folder: {info.filename}", "bad_archive")
        target.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst)


def _untar(data: bytes, folder: Path) -> None:
    try:
        archive = tarfile.open(fileobj=io.BytesIO(data), mode="r:*")
    except tarfile.TarError as e:
        raise SkillError("The archive is damaged", "bad_archive") from e
    with archive:
        members = archive.getmembers()
        if sum(m.size for m in members if m.isfile()) > MAX_UNPACKED:
            raise SkillError("The archive is too large", "too_big")
        try:
            archive.extractall(folder, members=[m for m in members if m.isfile() or m.isdir()], filter="data")
        except (tarfile.TarError, OSError) as e:
            raise SkillError(f"Cannot unpack the archive: {e}", "bad_archive") from e


@dataclass(frozen=True)
class SearchHit:
    """A skill skills.sh knows, and how many times it was installed."""

    name: str
    source: str
    """``owner/repo``."""
    skill_id: str
    installs: int

    @property
    def id(self) -> str:
        """What ``SkillFetcher.find`` takes to get it."""
        return f"{self.source}/{self.skill_id}"


def search(query: str, limit: int = 20, get: Download | None = None) -> list[SearchHit]:
    """Skills that match ``query`` on skills.sh, the most installed first.

    Raises:
        SkillError: ``offline``, skills.sh cannot be reached or answered something else.
    """
    import json

    query = query.strip()
    if len(query) < 2:
        return []
    url = f"{SEARCH_URL}?{urllib.parse.urlencode({'q': query, 'limit': limit})}"
    try:
        body = (get or (lambda u: download(u, limit=2 * 1024 * 1024, timeout=10)))(url)
        data = json.loads(body)
        hits = [
            SearchHit(str(s["name"]), str(s["source"]), str(s["skillId"]), int(s.get("installs") or 0))
            for s in data.get("skills", [])
            if isinstance(s, dict) and s.get("source") and s.get("skillId")
        ]
    except SkillError:
        raise
    except (ValueError, KeyError, TypeError) as e:
        raise SkillError(f"skills.sh answered something unexpected: {e}", "offline") from e
    return sorted(hits, key=lambda h: -h.installs)[:limit]
