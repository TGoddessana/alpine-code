"""``data/*`` over the server: the practice data of a project (editable) and its live data (read-only), against the fake
Alpine API and a fixture sqlite in the Cloudflare Vite plugin's folder layout."""

import asyncio
import json

import pytest
from cloud_project import SCHEMA, make_practice

from alpine_core.cloud import AlpineTokens, CloudClient, create_app, links
from alpine_server.stdio import Server


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ANTHROPIC_API_KEY", "ALPINE_CLOUD_URL"):
        monkeypatch.delenv(name, raising=False)


class Harness:
    def __init__(self):
        self.lines: list[dict] = []
        self.server = Server(lambda line: self.lines.append(json.loads(line)))
        self.next_id = 0

    async def call(self, method, params=None):
        self.next_id += 1
        request = {"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}}
        await self.server.handle_line(json.dumps(request))
        return next(line for line in reversed(self.lines) if line.get("id") == self.next_id)


def reason(reply):
    return reply["error"]["data"]["reason"]


def test_practice_data_can_be_read_and_edited(tmp_path):
    async def scenario():
        h, folder = Harness(), tmp_path / "shop"
        folder.mkdir()
        cwd = str(folder)
        sources = (await h.call("data/sources", {"cwd": cwd}))["result"]["sources"]
        assert sources == [{"kind": "practice", "available": False}, {"kind": "live", "available": False}]
        assert reason(await h.call("data/tables", {"cwd": cwd, "source": "practice"})) == "not_available"

        make_practice(folder)
        tables = (await h.call("data/tables", {"cwd": cwd, "source": "practice"}))["result"]["tables"]
        assert [t["name"] for t in tables] == ["bookings", "user"]
        assert tables[0]["columns"][0] == {
            "name": "id",
            "type": "TEXT",
            "pk": True,
            "nullable": False,
            "references": None,
        }

        rows = (await h.call("data/rows", {"cwd": cwd, "source": "practice", "table": "user", "limit": 1}))["result"]
        assert rows["total"] == 2 and rows["rows"] == [["u1", "mina@example.com", "••••", "••••", "fun"]]
        desc = {"cwd": cwd, "source": "practice", "table": "bookings", "order": "guest", "dir": "desc"}
        assert (await h.call("data/rows", desc))["result"]["rows"][0][1] == "Mina"

        save = {"cwd": cwd, "source": "practice", "table": "bookings", "key": {"id": "b1"}, "cells": {"guest": "Mi"}}
        assert (await h.call("data/save", save))["result"] == {}
        new = {"cwd": cwd, "source": "practice", "table": "bookings", "key": None, "cells": {"id": "b9", "guest": "Z"}}
        assert (await h.call("data/save", new))["result"] == {}
        gone = {"cwd": cwd, "source": "practice", "table": "bookings", "key": {"id": "b9"}}
        assert (await h.call("data/delete", gone))["result"] == {}
        assert reason(await h.call("data/delete", gone)) == "not_found"
        secret = {**save, "table": "user", "key": {"id": "u1"}, "cells": {"password_hash": "x"}}
        assert reason(await h.call("data/save", secret)) == "invalid"
        total = (await h.call("data/rows", {"cwd": cwd, "source": "practice", "table": "bookings"}))["result"]["total"]
        assert total == 3
        assert reason(await h.call("data/sources", {"cwd": str(tmp_path / "nope")})) == "not_a_folder"
        await h.server.close()

    asyncio.run(scenario())


def test_live_data_is_read_only_and_reads_are_listed(cloud, tmp_path):
    async def scenario():
        h, folder = Harness(), tmp_path / "shop"
        folder.mkdir()
        cwd = str(folder)
        reply = await h.call("cloud/verifyCode", {"email": "me@example.com", "code": cloud.email_code})
        assert reply["result"]["signedIn"] is True
        assert reason(await h.call("data/tables", {"cwd": cwd, "source": "live"})) == "not_available"

        app = await asyncio.to_thread(lambda: create_app(CloudClient(AlpineTokens()), "shop-app", "web-lite"))
        links.link(folder, app.id)
        db = cloud.make_live(app.id, SCHEMA)
        sources = (await h.call("data/sources", {"cwd": cwd}))["result"]["sources"]
        assert sources[1] == {"kind": "live", "available": True}
        tables = (await h.call("data/tables", {"cwd": cwd, "source": "live"}))["result"]["tables"]
        assert [t["name"] for t in tables] == ["bookings", "user"]
        rows = (await h.call("data/rows", {"cwd": cwd, "source": "live", "table": "user"}))["result"]
        assert rows["rows"][0][2] == "••••"
        save = {"cwd": cwd, "source": "live", "table": "bookings", "key": {"id": "b1"}, "cells": {"guest": "x"}}
        assert reason(await h.call("data/save", save)) == "read_only"
        delete = {"cwd": cwd, "source": "live", "table": "bookings", "key": {"id": "b1"}}
        assert reason(await h.call("data/delete", delete)) == "read_only"
        assert db.execute("SELECT guest FROM bookings WHERE id = 'b1'").fetchone() == ("Mina",)

        assert (await h.call("data/reads", {"cwd": cwd}))["result"] == {"reads": []}
        cloud.reads[app.id] = [
            {"at": "2026-10-20T02:00:00Z", "session": "ses_1", "sql": "SELECT 1", "tables": [], "rows": 1}
        ]
        [read] = (await h.call("data/reads", {"cwd": cwd}))["result"]["reads"]
        assert read["session"] == "ses_1" and read["rows"] == 1
        missing = await h.call("data/rows", {"cwd": cwd, "source": "live", "table": "d1_migrations"})
        assert reason(missing) == "not_found"
        await h.server.close()

    asyncio.run(scenario())
