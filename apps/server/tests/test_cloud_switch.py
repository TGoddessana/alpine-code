"""Shipping hidden, on the wire: with Alpine Cloud off the server offers nothing of it (docs/alpine-cloud.md)."""

import asyncio
from pathlib import Path

import pytest

from alpine_core import PROVIDERS
from alpine_core.cloud import LiveData
from alpine_protocol import ConnectionsModelsParams
from alpine_protocol.cloud import CloudEnabledParams, CloudStatusParams
from alpine_server.cloud import CloudMethods
from alpine_server.methods import MethodError, connection_models
from alpine_server.sessions import SessionManager


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    monkeypatch.delenv("ALPINE_CLOUD_URL", raising=False)


def sources(tmp_path: Path):
    manager = SessionManager.__new__(SessionManager)
    manager.memories = type("M", (), {"of": staticmethod(lambda project: "memory")})()
    return manager.tool_sources(tmp_path)


def test_live_data_is_not_a_tool_source_when_cloud_is_off(tmp_path):
    assert not any(isinstance(s, LiveData) for s in sources(tmp_path))


def test_live_data_is_a_tool_source_when_cloud_is_on(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CLOUD_URL", "http://127.0.0.1:9")
    assert any(isinstance(s, LiveData) for s in sources(tmp_path))


def test_status_says_cloud_is_off_without_asking_the_network():
    methods = CloudMethods(lambda params: None, lambda params: None)
    status = asyncio.run(methods.status(CloudStatusParams()))
    assert status.enabled is False and status.signed_in is False


def test_status_says_cloud_is_on(cloud):
    methods = CloudMethods(lambda params: None, lambda params: None)
    status = asyncio.run(methods.status(CloudStatusParams()))
    assert status.enabled is True


def test_the_alpine_provider_cannot_be_asked_for_models_when_cloud_is_off():
    assert "alpine" in PROVIDERS  # the data stays; the switch decides whether it is offered
    with pytest.raises(MethodError):
        connection_models(ConnectionsModelsParams(provider="alpine"))


def test_enabled_answers_at_once_with_no_network(monkeypatch):
    methods = CloudMethods(lambda params: None, lambda params: None)
    assert asyncio.run(methods.enabled(CloudEnabledParams())).enabled is False
    monkeypatch.setenv("ALPINE_CLOUD_URL", "http://127.0.0.1:9")
    assert asyncio.run(methods.enabled(CloudEnabledParams())).enabled is True
