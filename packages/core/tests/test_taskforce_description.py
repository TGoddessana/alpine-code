"""What the ``task_force`` tool tells the session's model: the models the user's picker shows with their prices,
windows and price steps (TF items 1 and 2) and what happens to a long result (item 3)."""

import json

import pytest
from alpineagents.testing import FakeModel

from alpine_core import PROVIDERS, Connection, Decision, Session, Settings, picker
from alpine_core import session as session_module
from alpine_core.catalog import catalog_file
from alpine_core.taskforce import available

pytestmark = pytest.mark.skipif(not available(), reason="TF runs on macOS only")

CATALOG = {
    "anthropic": {
        "models": {
            "claude-haiku-5-5": {
                "family": "claude-haiku",
                "release_date": "2026-09-01",
                "limit": {"context": 1_000_000, "output": 128_000},
                "cost": {
                    "input": 1,
                    "output": 5,
                    "cache_read": 0.1,
                    "cache_write": 1.25,
                    "tiers": [{"input": 2, "output": 10, "tier": {"type": "context", "size": 100_000}}],
                },
            },
            "claude-opus-5-5": {
                "family": "claude-opus",
                "release_date": "2026-09-01",
                "limit": {"context": 1_000_000, "output": 128_000},
                "cost": {"input": 5, "output": 25, "cache_read": 0.5, "cache_write": 6.25},
            },
            "claude-haiku-4-5": {
                "family": "claude-haiku",
                "release_date": "2025-10-01",
                "limit": {"context": 200_000},
                "cost": {"input": 1, "output": 5},
            },
        }
    }
}

ANTHROPIC = Connection(name="anthropic", provider=PROVIDERS["anthropic"])
LOCAL = Connection(name="local", base_url="http://127.0.0.1:1234/v1")


@pytest.fixture(autouse=True)
def lists():
    picker.forget()
    catalog_file().parent.mkdir(parents=True, exist_ok=True)
    catalog_file().write_text(json.dumps(CATALOG))
    yield
    picker.forget()


class Approver:
    async def aapprove(self, request):
        return Decision("allow")


def make(tmp_path, monkeypatch, settings):
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(["ok"]))
    return Session(settings, approver=Approver(), cwd=tmp_path, taskforce=True)


def description(session):
    [tool] = [t for t in session._agent.tools if t.name == "task_force"]
    return tool.description


def test_the_lead_sees_the_models_the_picker_shows_with_prices_and_windows(tmp_path, monkeypatch):
    picker.keep(ANTHROPIC, ["claude-haiku-5-5", "claude-opus-5-5", "claude-haiku-4-5"])
    picker.keep(LOCAL, ["motif/motif-3"])
    connections = {"anthropic": ANTHROPIC, "local": LOCAL}
    session = make(tmp_path, monkeypatch, Settings(model="local/motif/motif-3", connections=connections))
    text = description(session)
    assert "anthropic/claude-haiku-5-5: $1 / $5 / $0.1 / $1.25; window 1,000,000; costs more past 100,000" in text
    assert "anthropic/claude-opus-5-5: $5 / $25 / $0.5 / $6.25; window 1,000,000" in text
    assert "claude-haiku-4-5" not in text  # an older model of the family the picker leaves out
    assert "local/motif/motif-3: no price known; window unknown" in text  # local servers show all they list
    assert "The session runs on local/motif/motif-3." in text


def test_switching_a_model_on_or_off_reaches_the_description(tmp_path, monkeypatch):
    picker.keep(ANTHROPIC, ["claude-haiku-5-5", "claude-opus-5-5", "claude-haiku-4-5"])
    changed = Connection(
        name="anthropic", provider=PROVIDERS["anthropic"], show=("claude-haiku-4-5",), hide=("claude-opus-5-5",)
    )
    settings = Settings(model="anthropic/claude-haiku-5-5", connections={"anthropic": changed})
    text = description(make(tmp_path, monkeypatch, settings))
    assert "anthropic/claude-haiku-4-5: $1 / $5 / - / -; window 200,000" in text
    assert "claude-opus-5-5" not in text


def test_without_the_lists_the_session_and_agent_models_are_named(tmp_path, monkeypatch):
    session = make(tmp_path, monkeypatch, Settings(model="anthropic/claude-opus-5-5"))
    text = description(session)
    assert "the connections' lists are not read yet" in text
    assert "anthropic/claude-opus-5-5: $5 / $25 / $0.5 / $6.25; window 1,000,000" in text


def test_a_list_read_later_is_in_the_next_request(tmp_path, monkeypatch):
    session = make(
        tmp_path, monkeypatch, Settings(model="anthropic/claude-opus-5-5", connections={"anthropic": ANTHROPIC})
    )
    assert "claude-haiku-5-5" not in description(session)
    picker.keep(ANTHROPIC, ["claude-haiku-5-5", "claude-opus-5-5"])
    session.taskforce.refresh()
    assert "anthropic/claude-haiku-5-5: $1 / $5" in description(session)


def test_the_lead_learns_what_happens_to_a_long_result(tmp_path, monkeypatch):
    session = make(tmp_path, monkeypatch, Settings(model="fake"))
    text = description(session)
    assert "cut\nat 40,000 characters" in text and "task_force_status(run=..., start=...)" in text
