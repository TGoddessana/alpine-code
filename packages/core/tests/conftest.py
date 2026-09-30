import pytest


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    """Every test gets its own ~/.alpine-code and no model settings from the environment."""
    path = tmp_path / "alpine-home"
    monkeypatch.setenv("ALPINE_CODE_HOME", str(path))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ALPINE_API_KEY", "ALPINE_CONTEXT_WINDOW", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return path
