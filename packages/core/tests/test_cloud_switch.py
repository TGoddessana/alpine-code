"""Shipping hidden: Alpine Cloud is on only when ``ALPINE_CLOUD_URL`` is set (docs/alpine-cloud.md)."""

import pytest

from alpine_core import Settings, save_connection, set_default_model
from alpine_core.cloud import settings as cloud_settings


def test_cloud_is_off_without_the_variable():
    assert cloud_settings.enabled() is False


def test_cloud_is_on_when_the_variable_is_set(monkeypatch):
    monkeypatch.setenv("ALPINE_CLOUD_URL", "http://127.0.0.1:8787")
    assert cloud_settings.enabled() is True


def test_an_empty_variable_is_off_even_when_the_default_becomes_on(monkeypatch):
    monkeypatch.setattr(cloud_settings, "ENABLED_BY_DEFAULT", True)
    assert cloud_settings.enabled() is True
    monkeypatch.setenv("ALPINE_CLOUD_URL", " ")
    assert cloud_settings.enabled() is False


@pytest.fixture
def alpine_in_the_file():
    save_connection("alpine", provider="alpine", model="some-model")
    save_connection("claude", provider="anthropic")
    set_default_model("alpine/some-model")


def test_the_alpine_connection_is_not_offered_when_cloud_is_off(alpine_in_the_file):
    settings = Settings.load()
    assert list(settings.connections) == ["claude"]
    assert settings.model is None


def test_the_alpine_connection_stays_in_the_file_and_returns_when_cloud_is_on(alpine_in_the_file, monkeypatch):
    from alpine_core import config_file

    assert "[connections.alpine]" in config_file().read_text(encoding="utf-8")  # hidden, not deleted
    monkeypatch.setenv("ALPINE_CLOUD_URL", "http://127.0.0.1:8787")
    settings = Settings.load()
    assert list(settings.connections) == ["alpine", "claude"]
    assert settings.model == "alpine/some-model"
