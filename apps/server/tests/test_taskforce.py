"""TF over the wire: the card as items, 시작, the agents' record, the result turn, the methods' errors."""

from __future__ import annotations

import asyncio

import pytest
from alpineagents.testing import FakeModel, tool_call

from alpine_core import Settings
from alpine_core import session as session_module
from alpine_core.taskforce import available
from alpine_core.taskforce import team as team_module

from .test_sessions import Client

pytestmark = pytest.mark.skipif(not available(), reason="TF runs on macOS only")


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    monkeypatch.setattr(Settings, "load", classmethod(lambda cls, **kw: Settings(model="fake")))


def test_a_tf_from_card_to_result(tmp_path, monkeypatch):
    folder = tmp_path / "project"
    folder.mkdir()
    lead = FakeModel(
        [
            tool_call(
                "task_force",
                title="지도 그리기",
                steps=[{"title": "작성", "count": 2, "model": "fake"}],
                minutes=3,
                script='phase("작성")\nresult = await parallel([agent("a", label="저장소"), agent("b")])\n',
            ),
            "제안했어요",
            "두 장 그렸어요",
        ]
    )
    monkeypatch.setattr(session_module, "make_model", lambda settings: lead)
    monkeypatch.setattr(
        team_module,
        "make_model",
        lambda settings: FakeModel([tool_call("read", path="x.txt"), lambda r: "done " + r.messages[0].text]),
    )

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="지도 그려 줘")

            def card(status):
                def found(out):
                    for e in client.events(sid):
                        item = e["event"].get("item")
                        if item and item["kind"] == "taskforce" and item["status"] == status:
                            return item
                    return None

                return found

            proposed = await client.until(card("proposed"))
            assert proposed["steps"] == [{"title": "작성", "count": 2, "model": "fake"}] and proposed["minutes"] == 3
            missing = await client.call("taskforce/start", sessionId=sid, runId="nope")
            assert missing["error"]["data"]["reason"] == "taskforce_not_found"

            started = await client.call("taskforce/start", sessionId=sid, runId=proposed["id"])
            assert started["result"] == {}
            again = await client.call("taskforce/start", sessionId=sid, runId=proposed["id"])
            assert again["error"]["data"]["reason"] == "taskforce_state"

            done = await client.until(card("done"))
            assert [(m["task"], m["state"], m["look"]) for m in done["members"]] == [
                ("저장소", "done", "antenna"),
                ("b", "done", "antenna"),
            ]
            record = await client.call("taskforce/record", sessionId=sid, runId=done["id"], memberId="a1")
            kinds = [item["kind"] for item in record["result"]["items"]]
            assert kinds == ["tool_call", "agent_message"]
            await client.until(
                lambda out: any(
                    e["event"]["type"] == "item_completed"
                    and e["event"]["item"]["kind"] == "agent_message"
                    and e["event"]["item"]["text"] == "두 장 그렸어요"
                    for e in client.events(sid)
                )
            )
            await client.status(sid, "idle")

    asyncio.run(scenario())


def test_a_grouped_card_shows_each_call_and_declines_one(tmp_path, monkeypatch):
    folder = tmp_path / "project"
    folder.mkdir()
    lead = FakeModel(
        [
            tool_call(
                "task_force",
                title="두 파일",
                steps=[{"title": "작성", "count": 2, "model": "fake"}],
                minutes=3,
                script='result = await parallel([agent("a"), agent("b")])\n',
            ),
            "제안했어요",
            "끝",
        ]
    )
    monkeypatch.setattr(session_module, "make_model", lambda settings: lead)

    def write(request):
        name = request.messages[0].text
        return tool_call("write", path=f"{name}.md", content=name)

    monkeypatch.setattr(team_module, "make_model", lambda settings: FakeModel([write, "ok"]))

    async def scenario():
        async with Client([]) as client:
            sid = await client.new(folder)
            await client.call("session/send", sessionId=sid, text="go")

            def latest(kind, check):
                def found(out):
                    items = [e["event"].get("item") for e in client.events(sid)]
                    items = [i for i in items if i and i["kind"] == kind and check(i)]
                    return items[-1] if items else None

                return found

            proposed = await client.until(latest("taskforce", lambda i: i["status"] == "proposed"))
            await client.call("taskforce/start", sessionId=sid, runId=proposed["id"])
            card = await client.until(latest("approval", lambda i: len(i["askedBy"]) == 2))
            assert [(ask["task"], ask["args"]["path"], ask["previewKind"]) for ask in card["askedBy"]] == [
                ("a", "a.md", "diff"),
                ("b", "b.md", "diff"),
            ]
            a = card["askedBy"][0]["agent"]
            wrong = await client.call("session/answer", sessionId=sid, requestId=card["id"], decision="allow", agent=a)
            assert wrong["error"]["code"] == -32602
            declined = await client.call(
                "session/answer", sessionId=sid, requestId=card["id"], decision="deny", agent=a
            )
            assert declined["result"] == {"accepted": True}
            await client.until(latest("approval", lambda i: [ask["task"] for ask in i["askedBy"]] == ["b"]))
            await client.call("session/answer", sessionId=sid, requestId=card["id"], decision="allow")
            await client.until(latest("taskforce", lambda i: i["status"] == "done"))
            await client.until(latest("agent_message", lambda i: i["text"] == "끝"))  # the result turn
            await client.status(sid, "idle")
            assert not (folder / "a.md").exists() and (folder / "b.md").read_text() == "b"
            changes = (await client.call("session/changes", sessionId=sid))["result"]
            assert [c["label"] for c in changes["checkpoints"]][:2] == ["go", "TF · 두 파일"]
            assert [f["path"] for f in changes["files"]] == ["b.md"]

    asyncio.run(scenario())
