import json

from alpineagents import Message, ProviderError, Reply, Usage
from alpineagents.testing import FakeModel, tool_call
from alpineagents.types import TextBlock

from alpine_cli.headless import run_headless
from alpine_core import Mode, Settings
from alpine_core import session as session_module


def cached_reply(item, *, input_tokens, cache_read, cache_write, output_tokens):
    def reply(request):
        blocks = (item,) if not isinstance(item, str) else (TextBlock(item),)
        usage = Usage(
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read,
            cache_write_tokens=cache_write,
            requests=1,
        )
        return Reply(message=Message("assistant", blocks), usage=usage)

    return reply


def test_usage_file_splits_cached_input_per_step(tmp_path, monkeypatch, capsys):
    path = tmp_path / "usage.json"
    during_second_step = []
    second = cached_reply("It says hello", input_tokens=50, cache_read=800, cache_write=60, output_tokens=5)

    def second_step(request):
        # What a run killed here (a deadline) would leave behind.
        during_second_step.append(json.loads(path.read_text()))
        return second(request)

    replies = [
        cached_reply(
            tool_call("read", path="a.txt"), input_tokens=900, cache_read=0, cache_write=800, output_tokens=20
        ),
        second_step,
    ]
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    monkeypatch.chdir(tmp_path)
    (tmp_path / "a.txt").write_text("hello\n")

    assert run_headless(Settings(model="fake", mode=Mode.YOLO), "what is in a.txt?", usage_path=path) == 0

    [partial] = during_second_step
    assert partial["complete"] is False and len(partial["steps"]) == 1
    assert partial["total"]["cache_write_tokens"] == 800

    doc = json.loads(path.read_text())
    assert doc["complete"] is True
    steps = [
        (s["input_tokens"], s["cache_read_tokens"], s["cache_write_tokens"], s["output_tokens"]) for s in doc["steps"]
    ]
    assert steps == [(900, 0, 800, 20), (50, 800, 60, 5)]
    total = doc["total"]
    assert (total["input_tokens"], total["cache_read_tokens"], total["cache_write_tokens"]) == (950, 800, 860)
    assert total["requests"] == 2
    assert "It says hello" in capsys.readouterr().out


def test_usage_file_keeps_finished_steps_when_the_run_fails(tmp_path, monkeypatch):
    replies = [tool_call("read", path="missing.txt"), ProviderError("server down")]
    monkeypatch.setattr(session_module, "make_model", lambda settings: FakeModel(replies))
    monkeypatch.chdir(tmp_path)
    path = tmp_path / "usage.json"

    assert run_headless(Settings(model="fake", mode=Mode.YOLO), "go", usage_path=path) == 1

    doc = json.loads(path.read_text())
    assert doc["complete"] is True
    assert doc["total"]["requests"] == 1 and len(doc["steps"]) == 1
