import pytest

from alpine_code.core import ConfigError, Mode, Settings


def test_priority_file_env_override(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    (tmp_path / "alpine-code").mkdir()
    (tmp_path / "alpine-code/config.toml").write_text('model = "from-file"\nmode = "accept_edits"\n')
    monkeypatch.delenv("ALPINE_MODEL", raising=False)
    assert Settings.load().model == "from-file"
    monkeypatch.setenv("ALPINE_MODEL", "from-env")
    assert Settings.load().model == "from-env"
    settings = Settings.load(model="from-flag", base_url=None)
    assert settings.model == "from-flag" and settings.mode is Mode.ACCEPT_EDITS


def test_bad_values(tmp_path, monkeypatch):
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    with pytest.raises(ConfigError):
        Settings.load(mode="reckless")
    (tmp_path / "alpine-code").mkdir()
    (tmp_path / "alpine-code/config.toml").write_text('modle = "typo"\n')
    with pytest.raises(ConfigError, match="modle"):
        Settings.load()
