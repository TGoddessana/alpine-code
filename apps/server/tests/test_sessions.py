"""The session methods, driven through the real server loop with a fake model."""

from __future__ import annotations

import asyncio
import dataclasses
import json
import os
import signal
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import Settings, file_storage
from alpine_core import session as session_module
from alpine_server.stdio import serve_async


class Client:
    """Talks to ``serve_async`` in process: lines in through a queue, everything written kept in ``out``."""

    def __init__(self, replies: list) -> None:
        self.replies = replies
        self.out: list[dict] = []
        self._lines: asyncio.Queue[str | None] = asyncio.Queue()
        self._next = 0
        self._changed = asyncio.Event()

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
        await self.close()

    async def close(self) -> None:
        await self._lines.put(None)
        await self._server

    async def until(self, predicate, timeout: float = 5.0):
        async with asyncio.timeout(timeout):
            while True:
                found = predicate(self.out)
                if found:
                    return found
                self._changed.clear()
                await self._changed.wait()

    async def call(self, method: str, **params) -> dict:
        self._next += 1
        id = self._next
        await self._lines.put(json.dumps({"jsonrpc": "2.0", "id": id, "method": method, "params": params}))
        return await self.until(lambda out: next((m for m in out if m.get("id") == id), None))

    def events(self, session_id: str, type: str | None = None) -> list[dict]:
        found = [
            m["params"]
            for m in self.out
            if m.get("method") == "session/event" and m["params"]["sessionId"] == session_id
        ]
        return [e for e in found if type is None or e["event"]["type"] == type]

    async def new(self, cwd: Path, **params) -> str:
        reply = await self.call("session/new", cwd=str(cwd), **params)
        return reply["result"]["info"]["id"]

    async def status(self, session_id: str, status: str) -> None:
        def reached(out):
            infos = [e["event"]["info"] for e in self.events(session_id, "info_changed")]
            return infos and infos[-1]["status"] == status

        await self.until(lambda out: reached(out))


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls, **kw: Settings(model="fake")))


@pytest.fixture
def folder(tmp_path) -> Path:
    path = tmp_path / "project"
    path.mkdir()
    return path


def fake_model(monkeypatch, *replies):
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(list(replies)))


def run(coro):
    asyncio.run(coro)


def test_new_send_events_completed(folder, monkeypatch):
    fake_model(monkeypatch, "Hello there")

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            first = client.events(sid)[0]
            assert first["event"]["type"] == "info_changed" and first["event"]["info"]["status"] == "idle"
            assert (await client.call("session/send", sessionId=sid, text="hi"))["result"] == {}
            await client.status(sid, "idle")
            await client.until(lambda out: client.events(sid, "item_completed")[1:])
            events = client.events(sid)
            completed = [e["event"]["item"] for e in events if e["event"]["type"] == "item_completed"]
            assert [i["kind"] for i in completed] == ["user_message", "agent_message"]
            assert completed[1]["text"] == "Hello there" and completed[0]["text"] == "hi"
            seqs = [e["seq"] for e in events]
            assert seqs == sorted(seqs)
            listed = (await client.call("session/list"))["result"]["sessions"]
            assert [s["id"] for s in listed] == [sid] and listed[0]["title"] == "hi"
            opened = (await client.call("session/open", sessionId=sid))["result"]
            assert [i["kind"] for i in opened["items"]] == ["user_message", "agent_message"]
            assert opened["active"] == [] and opened["seq"] == max(seqs)
            assert opened["items"][1]["text"] == "Hello there"

    run(scenario())


def approval_id(client: Client, sid: str):
    def find(out):
        for e in client.events(sid, "item_started"):
            if e["event"]["item"]["kind"] == "approval":
                return e["event"]["item"]["id"]

    return find


def test_approval_allow_and_first_answer_wins(folder, monkeypatch):
    fake_model(monkeypatch, tool_call("bash", command="echo 1"), "done")

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="go")
            request = await client.until(approval_id(client, sid))
            await client.status(sid, "waiting")
            busy = await client.call("session/send", sessionId=sid, text="again")
            assert busy["error"]["code"] == -32002
            busy = await client.call("session/setModel", sessionId=sid, model="x/other")
            assert busy["error"]["code"] == -32002
            first = await client.call("session/answer", sessionId=sid, requestId=request, decision="allow")
            second = await client.call("session/answer", sessionId=sid, requestId=request, decision="deny")
            assert first["result"] == {"accepted": True} and second["result"] == {"accepted": False}
            unknown = await client.call("session/answer", sessionId=sid, requestId="nope", decision="allow")
            assert unknown["result"] == {"accepted": False}
            await client.until(
                lambda out: [
                    e for e in client.events(sid, "item_completed") if e["event"]["item"]["kind"] == "agent_message"
                ]
            )
            await client.status(sid, "idle")
            opened = (await client.call("session/open", sessionId=sid))["result"]
            approval = next(i for i in opened["items"] if i["kind"] == "approval")
            assert approval["decision"] == "allow" and opened["info"]["status"] == "idle"

    run(scenario())


def test_approval_deny_skips_the_call_and_the_run_goes_on(folder, monkeypatch):
    async def scenario(replies, feedback, last):
        fake_model(monkeypatch, *replies)
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="go")
            request = await client.until(approval_id(client, sid))
            await client.call("session/answer", sessionId=sid, requestId=request, decision="deny", feedback=feedback)
            await client.until(
                lambda out: [e for e in client.events(sid, "item_completed") if e["event"]["item"]["kind"] == last]
            )
            await client.status(sid, "idle")
            return (await client.call("session/open", sessionId=sid))["result"]

    replies = [tool_call("bash", command="echo 1"), "OK"]
    skipped = asyncio.run(scenario(replies, None, "agent_message"))
    assert [i["kind"] for i in skipped["items"]][-2:] == ["tool_call", "agent_message"]
    continued = asyncio.run(scenario(replies, "use ls", "agent_message"))
    approval = next(i for i in continued["items"] if i["kind"] == "approval")
    assert approval["feedback"] == "use ls"


def test_cancel_while_waiting_and_idle_cancel(folder, monkeypatch):
    fake_model(monkeypatch, tool_call("bash", command="echo 1"), "done")

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            assert (await client.call("session/cancel", sessionId=sid))["result"] == {}  # idle: nothing happens
            await client.call("session/send", sessionId=sid, text="go")
            request = await client.until(approval_id(client, sid))
            assert (await client.call("session/cancel", sessionId=sid))["result"] == {}
            opened = (await client.call("session/open", sessionId=sid))["result"]
            assert opened["info"]["status"] == "idle" and opened["active"] == []
            assert opened["items"][-1]["kind"] == "run_stopped" and opened["items"][-1]["reason"] == "interrupted"
            late = await client.call("session/answer", sessionId=sid, requestId=request, decision="allow")
            assert late["result"] == {"accepted": False}

    run(scenario())


def test_shutdown_saves_running_sessions_as_interrupted_and_open_resumes_from_disk(folder, monkeypatch):
    fake_model(monkeypatch, tool_call("bash", command="echo 1"), "done")

    async def first():
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="go")
            await client.until(approval_id(client, sid))
            return sid  # the server ends while the approval waits

    sid = asyncio.run(first())
    fake_model(monkeypatch, "again")

    async def second():
        async with Client([]) as client:
            listed = (await client.call("session/list"))["result"]["sessions"]
            assert [s["id"] for s in listed] == [sid] and listed[0]["status"] == "idle"
            opened = (await client.call("session/open", sessionId=sid))["result"]
            assert [i["kind"] for i in opened["items"]][0] == "user_message"
            assert opened["items"][-1]["kind"] == "run_stopped" and opened["seq"] > 0
            await client.call("session/send", sessionId=sid, text="more")
            await client.status(sid, "idle")
            await client.until(lambda out: client.events(sid, "item_completed")[-1:] and _has_agent(client, sid))
            assert min(e["seq"] for e in client.events(sid, "item_completed")) > opened["seq"]

    run(second())


def test_list_reports_a_dead_process_as_idle_without_opening_it(folder, monkeypatch):
    fake_model(monkeypatch, "hi")

    async def make_one():
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="go")
            await client.status(sid, "idle")
            return sid

    sid = asyncio.run(make_one())
    storage = file_storage()
    info, _ = storage.log.read(sid)
    storage.log.update(dataclasses.replace(info, status="waiting"))  # the process died at an approval

    async def listed():
        async with Client([]) as client:
            return (await client.call("session/list"))["result"]["sessions"]

    assert [s["status"] for s in asyncio.run(listed())] == ["idle"]


def test_sigterm_closes_the_server_and_saves_running_sessions(folder, monkeypatch):
    fake_model(monkeypatch, tool_call("bash", command="echo 1"), "done")

    async def scenario():
        client = Client([])
        await client.__aenter__()
        sid = await client.new(folder)
        await client.call("session/send", sessionId=sid, text="go")
        await client.until(approval_id(client, sid))
        os.kill(os.getpid(), signal.SIGTERM)
        await asyncio.wait_for(client._server, 5)  # serve_async returns instead of the process dying
        return sid

    sid = asyncio.run(scenario())
    info, records = file_storage().log.read(sid)
    assert info.status == "idle" and records[-1][1]["kind"] == "run_stopped"


def _has_agent(client: Client, sid: str) -> bool:
    return any(e["event"]["item"]["kind"] == "agent_message" for e in client.events(sid, "item_completed"))


def test_set_mode_set_model_and_delete(folder, monkeypatch):
    fake_model(monkeypatch, "hi")

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder, mode="accept_edits")
            info = (await client.call("session/setMode", sessionId=sid, mode="yolo"))["result"]["info"]
            assert info["mode"] == "yolo"
            info = (await client.call("session/setModel", sessionId=sid, model="x/other"))["result"]["info"]
            assert info["model"] == "x/other" and info["id"] == sid
            await client.call("session/send", sessionId=sid, text="hi")
            await client.status(sid, "idle")
            deleted = await client.call("session/delete", sessionId=sid)
            assert deleted["result"] == {}
            assert client.events(sid, "deleted")
            assert (await client.call("session/list"))["result"]["sessions"] == []
            assert (await client.call("session/open", sessionId=sid))["error"]["code"] == -32001

    run(scenario())


def test_unknown_sessions_are_32001(folder):
    async def scenario():
        async with Client([]) as client:
            for method, params in [
                ("session/open", {}),
                ("session/send", {"text": "x"}),
                ("session/cancel", {}),
                ("session/answer", {"requestId": "r", "decision": "allow"}),
                ("session/setMode", {"mode": "yolo"}),
                ("session/setModel", {"model": "x/y"}),
                ("session/delete", {}),
            ]:
                reply = await client.call(method, sessionId="missing", **params)
                assert reply["error"]["code"] == -32001, method
            bad = await client.call("session/new", cwd=str(folder / "nope"))
            assert bad["error"]["data"] == {"reason": "not_a_folder"}

    run(scenario())


def test_a_slow_method_does_not_block_a_session(folder, monkeypatch):
    fake_model(monkeypatch, "hi")

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="hi")
            await client.status(sid, "idle")
            listed = await client.call("projects/list")
            assert [p["path"] for p in listed["result"]["projects"]] == [str(folder.resolve())]

    run(scenario())


def test_info_carries_activity_usage_and_context_on_the_wire(folder, monkeypatch):
    fake_model(monkeypatch, tool_call("bash", command="echo 1"), "done")

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            idle = client.events(sid, "info_changed")[0]["event"]["info"]
            assert idle["activity"] is None and idle["runStartedAt"] is None and idle["runUsage"] is None
            assert idle["contextWindow"] == 200_000 and "cacheWriteTokens" in idle["usage"]
            await client.call("session/send", sessionId=sid, text="go")
            request = await client.until(approval_id(client, sid))
            await client.status(sid, "waiting")
            waiting = client.events(sid, "info_changed")[-1]["event"]["info"]
            assert waiting["activity"]["kind"] == "waiting_approval" and waiting["runStartedAt"]
            await client.call("session/answer", sessionId=sid, requestId=request, decision="allow")
            await client.status(sid, "idle")
            infos = [e["event"]["info"] for e in client.events(sid, "info_changed")]
            seen: list = []
            for info in infos:
                a = info["activity"]
                pair = None if a is None else (a["kind"], a["toolName"])
                if not seen or seen[-1] != pair:
                    seen.append(pair)
            assert seen == [
                None,
                ("thinking", None),
                ("waiting_approval", None),
                ("running_tool", "bash"),
                ("thinking", None),
                ("writing", None),
                None,
            ]
            requests = [i["usage"]["requests"] for i in infos]
            assert requests == sorted(requests) and requests[-1] == 2
            assert infos[-1]["runUsage"] is None and infos[-1]["runStartedAt"] is None
            during = [i for i in infos if i["runUsage"] is not None]
            assert during[-1]["runUsage"]["requests"] == 2 and during[-1]["runUsage"]["cost"] is None

    run(scenario())
