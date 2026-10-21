from alpine_core import picker
from alpine_core.config import Connection, Settings
from alpine_core.taskforce.team import resolve_model


def test_a_bare_model_name_goes_to_the_connection_that_lists_it(monkeypatch):
    lists = {"chatgpt": ["gpt-6-sol"], "anthropic": ["claude-haiku-5-5", "claude-sonnet-5-5"]}
    monkeypatch.setattr(picker, "listed", lambda connection: lists.get(connection.name))
    settings = Settings(
        model="chatgpt/gpt-6-sol",
        connections={"chatgpt": Connection("chatgpt"), "anthropic": Connection("anthropic")},
    )
    # A lead on a ChatGPT sign-in naming Haiku means the Anthropic connection, not its own.
    assert resolve_model("claude-haiku-5-5", settings) == "anthropic/claude-haiku-5-5"
    assert resolve_model("anthropic/claude-sonnet-5-5", settings) == "anthropic/claude-sonnet-5-5"
    # A name no connection lists keeps the session model's connection, as before.
    assert resolve_model("gpt-unknown", settings) == "chatgpt/gpt-unknown"
