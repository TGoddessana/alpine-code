"""``projects/create``: a template becomes a project on the rail, and a session starts on the idea."""

from __future__ import annotations

import asyncio
import json
import subprocess
import threading
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alpineagents.testing import FakeModel

from alpine_core import ConfigError, ProjectList, Settings
from alpine_core import session as session_module
from alpine_core import templates as templates_module
from alpine_protocol import ProjectsCreateParams, SessionOpenParams
from alpine_server import new_projects as new_projects_module
from alpine_server.methods import MethodError
from alpine_server.new_projects import NewProjects
from alpine_server.sessions import SessionManager
from alpine_server.stdio import serve_async


def git(folder, *args):
    return subprocess.run(["git", "-C", str(folder), *args], capture_output=True, text=True, check=True).stdout


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    """Its own ~/.alpine-code with a clone folder, and a templates folder with ``blank`` and ``web-lite``."""
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    (tmp_path / "home").mkdir()
    (tmp_path / "home" / "config.toml").write_text(f'clone_folder = "{tmp_path / "repos"}"\n')
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    root = tmp_path / "alpine-templates"
    (root / "web-lite" / ".alpine-code").mkdir(parents=True)
    (root / "web-lite" / ".alpine-code" / "cloud.toml").write_text('version = 1\nkind = "web-lite"\n')
    (root / "web-lite" / "package.json").write_text('{"name": "app"}\n')
    (root / "web-lite" / "node_modules").mkdir()
    (root / "web-lite" / "node_modules" / "x.js").write_text("x\n")
    (root / "blank" / ".alpine-code").mkdir(parents=True)
    (root / "blank" / ".alpine-code" / "cloud.toml").write_text('version = 1\nkind = "blank"\n')
    monkeypatch.setenv("ALPINE_TEMPLATES", str(root))
    return tmp_path


@pytest.fixture
def repos(tmp_path) -> Path:
    return (tmp_path / "repos").resolve()


class Harness:
    """``NewProjects`` over a real ``SessionManager`` with a fake model. ``log`` has the order things were announced
    in: ``("created", step)`` and ``("event", type)``."""

    def __init__(self, monkeypatch, *replies, settings=None):
        monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(list(replies)))
        self.log: list[tuple[str, str]] = []
        self.changes = []
        self.sessions = SessionManager(self._event, settings=settings or (lambda: Settings(model="fake")))
        self.projects = NewProjects(self._created, self.sessions)

    def _event(self, params):
        self.log.append(("event", params.event.type))

    def _created(self, params):
        self.changes.append(params)
        self.log.append(("created", params.step))

    async def create(self, idea="make a booking app", template="web-lite", name="craft-booking", id="c1", **extra):
        return await self.projects.create(ProjectsCreateParams(id=id, idea=idea, template=template, name=name, **extra))

    async def items(self, session_id, until_kind="agent_message"):
        """The session's finished items, once one of ``until_kind`` is among them."""
        async with asyncio.timeout(5):
            while True:
                opened = await self.sessions.open(SessionOpenParams(session_id=session_id))
                if any(item.kind == until_kind for item in opened.items):
                    return opened.items
                await asyncio.sleep(0.02)

    async def close(self):
        await self.sessions.shutdown()


def run(coro):
    asyncio.run(coro)


def test_a_project_is_made_from_the_template_and_the_agent_gets_the_idea(monkeypatch, repos):
    async def scenario():
        harness = Harness(monkeypatch, "On it.")
        result = await harness.create(idea="예약을 받는 앱")

        folder = repos / "craft-booking"
        assert Path(result.project.path) == folder and result.project.name == "craft-booking"
        assert result.project.branch == "main"
        assert (folder / ".alpine-code" / "cloud.toml").exists() and (folder / "package.json").exists()
        assert not (folder / "node_modules").exists()
        assert git(folder, "log", "-1", "--format=%an <%ae>|%s").strip() == (
            "Alpine Code <noreply@alpinecode.app>|Start from the web-lite template"
        )
        assert [p.path for p in ProjectList.default().list()] == [folder]

        items = await harness.items(result.session_id)
        assert [(i.kind, i.text) for i in items] == [("user_message", "예약을 받는 앱"), ("agent_message", "On it.")]
        opened = await harness.sessions.open(SessionOpenParams(session_id=result.session_id))
        assert Path(opened.info.cwd) == folder
        await harness.close()

    run(scenario())


def test_each_step_is_announced_as_it_finishes_with_the_project(monkeypatch, repos):
    async def scenario():
        harness = Harness(monkeypatch, "ok")
        result = await harness.create(id="make-1")

        assert [(c.id, c.step) for c in harness.changes] == [("make-1", "folder"), ("make-1", "agent")]
        assert all(c.project == result.project for c in harness.changes)
        created = [entry for entry in harness.log if entry[0] == "created"]
        assert created == [("created", "folder"), ("created", "agent")]
        # The folder is announced before any session exists; the agent step after the session was announced.
        assert harness.log.index(("created", "folder")) < harness.log.index(("event", "info_changed"))
        assert harness.log.index(("event", "info_changed")) < harness.log.index(("created", "agent"))
        await harness.items(result.session_id)
        await harness.close()

    run(scenario())


def test_the_agent_and_the_mode_are_passed_on_to_the_session(monkeypatch):
    async def scenario():
        harness = Harness(monkeypatch, "ok")
        result = await harness.create(mode="accept_edits")

        opened = await harness.sessions.open(SessionOpenParams(session_id=result.session_id))
        assert opened.info.mode == "accept_edits"
        await harness.items(result.session_id)
        await harness.close()

    run(scenario())


def test_a_template_the_server_does_not_have_is_not_found_and_nothing_is_made(monkeypatch, repos):
    async def scenario():
        harness = Harness(monkeypatch, "ok")
        for template in ("web-pro", "mobile"):
            with pytest.raises(MethodError) as failed:
                await harness.create(template=template)
            assert failed.value.data.reason == "not_found"

        assert not repos.exists() and ProjectList.default().list() == []
        assert harness.changes == [] and harness.log == []

    run(scenario())


def test_a_config_that_cannot_be_read_is_invalid_config(home, monkeypatch, repos):
    (home / "home" / "config.toml").write_text("clone_folder = [\n")

    async def scenario():
        harness = Harness(monkeypatch, "ok")
        with pytest.raises(MethodError) as failed:
            await harness.create()
        assert failed.value.data.reason == "invalid_config"
        assert not repos.exists() and harness.changes == []

    run(scenario())


def test_the_name_is_made_safe_again_and_a_taken_one_gets_a_number(monkeypatch, repos):
    (repos / "craft-booking").mkdir(parents=True)

    async def scenario():
        harness = Harness(monkeypatch, "ok", "ok")
        taken = await harness.create(name="Craft Booking")
        assert Path(taken.project.path) == repos / "craft-booking-2"

        outside = await harness.create(name="../../outside", id="c2")
        assert Path(outside.project.path) == repos / "outside"
        for result in (taken, outside):
            await harness.items(result.session_id)
        await harness.close()

    run(scenario())


def test_without_git_the_project_is_still_made_and_the_agent_starts(monkeypatch, repos):
    monkeypatch.setattr(templates_module, "git_tools_ready", lambda: False)

    async def scenario():
        harness = Harness(monkeypatch, "ok")
        result = await harness.create()

        folder = repos / "craft-booking"
        assert (folder / "package.json").exists() and not (folder / ".git").exists()
        assert result.project.branch is None
        assert [c.step for c in harness.changes] == ["folder", "agent"]
        await harness.items(result.session_id)
        await harness.close()

    run(scenario())


def test_a_failure_while_making_the_folder_is_reported_and_leaves_nothing(monkeypatch, repos, tmp_path):
    broken = tmp_path / "gitconfig"
    broken.write_text("[user\n\tnot a config file\n")
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(broken))

    async def scenario():
        harness = Harness(monkeypatch, "ok")
        with pytest.raises(MethodError) as failed:
            await harness.create()
        assert failed.value.data.reason == "other" and "git" in str(failed.value)

        assert list(repos.iterdir()) == [] and ProjectList.default().list() == []
        assert harness.changes == []

    run(scenario())


def test_a_folder_that_could_not_be_put_on_the_rail_is_taken_back_so_nothing_made_stays_true(monkeypatch, repos):
    def disk_full(self, folder):
        raise OSError("No space left on device")

    monkeypatch.setattr(ProjectList, "open", disk_full)

    async def scenario():
        harness = Harness(monkeypatch, "ok")
        with pytest.raises(MethodError) as failed:
            await harness.create()
        assert failed.value.data.reason == "other" and "No space left" in str(failed.value)

        assert list(repos.iterdir()) == [] and ProjectList.default().list() == []
        assert harness.changes == [] and harness.log == []

    run(scenario())


def test_a_project_that_got_on_the_rail_but_could_not_be_read_is_taken_off_again(monkeypatch, repos):
    def unreadable(project):
        raise OSError("git went away")

    monkeypatch.setattr(new_projects_module, "project_info", unreadable)

    async def scenario():
        harness = Harness(monkeypatch, "ok")
        with pytest.raises(MethodError) as failed:
            await harness.create()
        assert failed.value.data.reason == "other" and "git went away" in str(failed.value)

        assert list(repos.iterdir()) == [] and ProjectList.default().list() == []
        assert harness.changes == []

    run(scenario())


def test_a_request_cancelled_before_the_folder_was_announced_leaves_nothing(monkeypatch, repos):
    started, release = threading.Event(), threading.Event()
    real = new_projects_module.project_info

    def slow(project):
        started.set()
        release.wait(5)
        return real(project)

    monkeypatch.setattr(new_projects_module, "project_info", slow)

    async def scenario():
        harness = Harness(monkeypatch, "ok")
        task = asyncio.ensure_future(harness.create())
        async with asyncio.timeout(5):
            while not started.is_set():
                await asyncio.sleep(0.01)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task

        assert list(repos.iterdir()) == [] and ProjectList.default().list() == []
        assert harness.changes == []

    run(scenario())


def test_when_the_session_cannot_start_the_project_stays_and_the_error_is_the_sessions(monkeypatch, repos):
    def unreadable():
        raise ConfigError("config.toml: no model")

    async def scenario():
        harness = Harness(monkeypatch, "ok", settings=unreadable)
        with pytest.raises(MethodError) as failed:
            await harness.create()

        assert failed.value.data.reason == "invalid_config" and "no model" in str(failed.value)
        assert (repos / "craft-booking" / "package.json").exists()
        assert [p.path for p in ProjectList.default().list()] == [repos / "craft-booking"]
        assert [c.step for c in harness.changes] == ["folder"]  # the agent step never happened

    run(scenario())


def test_creations_at_the_same_time_with_the_same_name_get_different_folders(monkeypatch, repos):
    async def scenario():
        harness = Harness(monkeypatch, "ok")
        results = await asyncio.gather(*(harness.create(idea=f"idea {n}", id=f"c{n}") for n in range(5)))

        paths = sorted(Path(r.project.path).name for r in results)
        assert paths == ["craft-booking", *(f"craft-booking-{n}" for n in range(2, 6))]
        assert len({r.session_id for r in results}) == 5
        for result in results:
            assert git(Path(result.project.path), "rev-list", "--count", "HEAD").strip() == "1"
        ideas = {}
        for result in results:  # each session got the idea of its own request
            ideas[result.project.name] = (await harness.items(result.session_id))[0].text
        assert sorted(ideas.values()) == [f"idea {n}" for n in range(5)]
        assert len({p.path for p in ProjectList.default().list()}) == 5
        await harness.close()

    run(scenario())


def test_an_id_that_is_already_being_made_is_refused_and_free_again_afterwards(monkeypatch, repos):
    async def scenario():
        harness = Harness(monkeypatch, "ok")
        first, second = await asyncio.gather(
            harness.create(id="same"), harness.create(id="same"), return_exceptions=True
        )

        assert first.session_id and isinstance(second, MethodError) and second.code == -32602
        again = await harness.create(id="same")
        assert Path(again.project.path) == repos / "craft-booking-2"
        for result in (first, again):
            await harness.items(result.session_id)
        await harness.close()

    run(scenario())


# ------------------------------------------------------------ over the wire


class Client:
    def __init__(self) -> None:
        self.out: list[dict] = []
        self._lines: asyncio.Queue[str | None] = asyncio.Queue()
        self._changed = asyncio.Event()
        self._next = 0

    async def _read(self) -> AsyncIterator[str]:
        while (line := await self._lines.get()) is not None:
            yield line

    def _write(self, text: str) -> None:
        self.out.append(json.loads(text))
        self._changed.set()

    async def __aenter__(self) -> Client:
        self._server = asyncio.create_task(serve_async(self._read(), self._write))
        return self

    async def __aexit__(self, *exc) -> None:
        await self._lines.put(None)
        await self._server

    async def call(self, method: str, **params) -> dict:
        self._next += 1
        await self._lines.put(json.dumps({"jsonrpc": "2.0", "id": self._next, "method": method, "params": params}))
        async with asyncio.timeout(5):
            while True:
                found = next((m for m in self.out if m.get("id") == self._next), None)
                if found:
                    return found
                self._changed.clear()
                await self._changed.wait()


def test_projects_create_over_the_wire(monkeypatch, repos):
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls, **kw: Settings(model="fake", clone_folder=repos)))
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(["Hello"]))

    async def scenario():
        async with Client() as client:
            reply = await client.call(
                "projects/create", id="wire-1", idea="a booking app", template="web-lite", name="craft-booking"
            )
            result = reply["result"]
            assert result["project"]["path"] == str(repos / "craft-booking")
            assert any(
                m.get("method") == "session/event" and m["params"]["sessionId"] == result["sessionId"]
                for m in client.out
            )

            before_answer = client.out[: client.out.index(reply)]
            steps = [m["params"] for m in before_answer if m.get("method") == "projects/createChanged"]
            assert [(s["id"], s["step"]) for s in steps] == [("wire-1", "folder"), ("wire-1", "agent")]
            assert all(s["project"] == result["project"] for s in steps)

            missing = await client.call("projects/create", id="wire-2", idea="x", template="mobile", name="phone")
            assert missing["error"]["data"] == {"reason": "not_found"}
            invalid = await client.call("projects/create", id="wire-3", idea="x", template="nope", name="phone")
            assert invalid["error"]["code"] == -32602

    run(scenario())
