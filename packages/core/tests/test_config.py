import pytest
from alpineagents import Anthropic, OpenAICompatible

from alpine_core import (
    PROVIDERS,
    Billing,
    ConfigError,
    FileSecrets,
    Mode,
    Settings,
    config_file,
    remove_connection,
    save_connection,
    set_default_model,
    show_model,
)
from alpine_core.models import make_model


def test_priority_file_env_override(home, monkeypatch):
    home.mkdir()
    config_file().write_text('default_model = "from-file"\nmode = "accept_edits"\n')
    assert Settings.load().model == "from-file"
    monkeypatch.setenv("ALPINE_MODEL", "from-env")
    assert Settings.load().model == "from-env"
    settings = Settings.load(model="from-flag", base_url=None)
    assert settings.model == "from-flag" and settings.mode is Mode.ACCEPT_EDITS


def test_bad_values(home):
    with pytest.raises(ConfigError):
        Settings.load(mode="reckless")
    home.mkdir()
    config_file().write_text('modle = "typo"\n')
    with pytest.raises(ConfigError, match="modle"):
        Settings.load()
    config_file().write_text('[connections.x]\nprovider = "nope"\n')
    with pytest.raises(ConfigError, match="nope"):
        Settings.load()
    config_file().write_text("[connections.x]\n")
    with pytest.raises(ConfigError, match="provider or a base_url"):
        Settings.load()


def test_saving_connections_keeps_comments(home):
    home.mkdir()
    config_file().write_text('# my settings\nmode = "yolo"\n')
    save_connection("anthropic", provider="anthropic")
    save_connection("local", base_url="http://localhost:11434/v1")
    set_default_model("anthropic/claude-sonnet-5")
    text = config_file().read_text()
    assert text.startswith("# my settings")

    settings = Settings.load()
    assert settings.model == "anthropic/claude-sonnet-5" and settings.mode is Mode.YOLO
    assert settings.connections["anthropic"].provider is PROVIDERS["anthropic"]
    assert settings.connections["local"].url == "http://localhost:11434/v1"
    assert settings.connections["local"].billing is Billing.NONE

    with pytest.raises(ConfigError):
        save_connection("a/b", provider="anthropic")


def test_removing_a_connection_takes_its_default_model_along(home):
    home.mkdir()
    config_file().write_text("# my settings\n")
    save_connection("anthropic", provider="anthropic")
    save_connection("local", base_url="http://localhost:11434/v1")
    set_default_model("local/qwen3")

    assert remove_connection("anthropic")
    settings = Settings.load()
    assert list(settings.connections) == ["local"] and settings.model == "local/qwen3"

    assert remove_connection("local")
    settings = Settings.load()
    assert not settings.connections and settings.model is None
    assert config_file().read_text().startswith("# my settings")
    assert not remove_connection("local")


def test_shown_and_hidden_models_survive_reconnecting(home):
    save_connection("local", base_url="https://llm.example.com/v1", model="a")
    show_model("local", "b", True)
    show_model("local", "a", False)
    assert Settings.load().connections["local"].show == ("b",)
    assert Settings.load().connections["local"].hide == ("a",)
    connection = save_connection("local", base_url="https://llm.example.com/v1", model="a")
    assert connection.show == ("b", "a") and connection.hide == ()


def test_models_come_from_connections_with_their_keys(home, monkeypatch):
    save_connection("glm", provider="zai-coding-plan")
    save_connection("anthropic", provider="anthropic")
    secrets = FileSecrets(home / "auth.json")
    secrets.set("glm", "saved-glm-key")
    secrets.set("anthropic", "saved-anthropic-key")
    settings = Settings.load(secrets=secrets)

    glm = make_model(settings.with_model("glm/glm-5.2"))
    assert isinstance(glm, OpenAICompatible) and glm.name == "glm-5.2"
    assert glm.base_url == PROVIDERS["zai-coding-plan"].base_url and glm.api_key == "saved-glm-key"
    assert settings.connections["glm"].billing is Billing.SUBSCRIPTION

    monkeypatch.setenv("ANTHROPIC_API_KEY", "env-wins")
    claude = make_model(settings.with_model("anthropic/claude-sonnet-5"))
    assert isinstance(claude, Anthropic) and claude._api_key == "env-wins"

    # Not a connection: alpineagents resolves it with its own environment variables.
    assert make_model(settings.with_model("ollama/qwen3-coder")) == "ollama/qwen3-coder"


def test_saved_keys_are_private(home):
    secrets = FileSecrets(home / "auth.json")
    secrets.set("anthropic", "k")
    assert (home / "auth.json").stat().st_mode & 0o777 == 0o600
    assert secrets.get("anthropic") == "k"
    secrets.delete("anthropic")
    assert secrets.get("anthropic") is None
