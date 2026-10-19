import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # fake_cloud.py


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    """Every test gets its own ~/.alpine-code and no model settings from the environment."""
    path = tmp_path / "alpine-home"
    monkeypatch.setenv("ALPINE_CODE_HOME", str(path))
    for name in (
        "ALPINE_MODEL",
        "ALPINE_BASE_URL",
        "ALPINE_API_KEY",
        "ALPINE_CONTEXT_WINDOW",
        "ALPINE_OUTPUT_LIMIT",
        "ANTHROPIC_API_KEY",
        "ALPINE_CLOUD_URL",
        "ALPINE_LOCALE",
    ):
        monkeypatch.delenv(name, raising=False)
    return path


@pytest.fixture
def cloud(monkeypatch):
    """A fake Alpine API on the loopback, which ``ALPINE_CLOUD_URL`` points at."""
    from fake_cloud import FakeCloud

    from alpine_core.cloud import account

    with FakeCloud() as fake:
        monkeypatch.setenv("ALPINE_CLOUD_URL", fake.url)
        account.reset()
        yield fake
    account.reset()
