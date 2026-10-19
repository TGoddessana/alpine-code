"""Judging the new-session screen's message: the model decides, the code only checks the shape of its answer."""

import importlib
import json
import threading
import time

import pytest
from alpineagents import ProviderError
from alpineagents.testing import FakeModel

from alpine_core import ConfigError, JudgeError, NewApp, Settings, WorkOnProject, judge

# ``alpine_core.judge`` is the function once the package is imported; the module is what holds ``make_model``.
judge_module = importlib.import_module("alpine_core.judge")

OFFERED = ["blank", "web-lite"]
SETTINGS = Settings(model="fake")


def new(**fields):
    return json.dumps(
        {
            "kind": "new",
            "template": "web-lite",
            "reason": "로그인과 예약 저장이면 Lite로 충분해요.",
            "name": "craft-booking",
        }
        | fields
    )


def ask(monkeypatch, replies, text="공방 예약 앱을 만들어 줘", locale="ko", templates=OFFERED, project=None):
    """The judgement, and the model that was asked."""
    model = FakeModel(replies)
    monkeypatch.setattr(judge_module, "make_model", lambda settings: model)
    return judge(SETTINGS, text, locale, templates, project), model


def judged(monkeypatch, reply, **kwargs):
    return ask(monkeypatch, [reply], **kwargs)[0]


# ------------------------------------------------------------ the answers


def test_a_change_is_work_on_the_project(monkeypatch):
    assert judged(monkeypatch, '{"kind": "change"}') == WorkOnProject()


def test_a_new_app_carries_the_template_the_reason_and_the_name(monkeypatch):
    assert judged(monkeypatch, new()) == NewApp("web-lite", "로그인과 예약 저장이면 Lite로 충분해요.", "craft-booking")


def test_each_offered_template_can_be_chosen(monkeypatch):
    assert judged(monkeypatch, new(template="blank")).template == "blank"
    assert judged(monkeypatch, new(template="web-pro"), templates=["web-lite", "web-pro"]).template == "web-pro"


def test_a_template_that_is_not_offered_is_work_on_the_project(monkeypatch):
    assert judged(monkeypatch, new(template="web-pro")) == WorkOnProject()
    assert judged(monkeypatch, new(template="rails")) == WorkOnProject()
    assert judged(monkeypatch, new(template=3)) == WorkOnProject()
    assert judged(monkeypatch, new(template=None)) == WorkOnProject()


def test_the_template_is_matched_without_regard_to_case_and_spaces(monkeypatch):
    assert judged(monkeypatch, new(template=" Web-Lite ")).template == "web-lite"


@pytest.mark.parametrize(
    "reply",
    [
        "",
        "I think this is a new app.",
        "{not json}",
        '{"kind": "new", "template": "web-lite", "reason": "x"',
        "[1, 2, 3]",
        '"new"',
        "{}",
        '{"kind": "maybe"}',
        '{"kind": 1}',
        '{"template": "web-lite", "reason": "ok", "name": "a"}',
        new(reason=""),
        new(reason="  \n "),
        new(reason=None),
        new(reason=["a"]),
    ],
)
def test_an_unclear_or_malformed_answer_is_work_on_the_project(monkeypatch, reply):
    assert judged(monkeypatch, reply) == WorkOnProject()


# ------------------------------------------------------------ around the JSON


def test_json_in_a_fenced_block_is_read(monkeypatch):
    assert judged(monkeypatch, f"```json\n{new()}\n```").template == "web-lite"


def test_json_with_text_around_it_is_read(monkeypatch):
    reply = f"This is a new app, so here is my answer: {new()}\nI hope that helps."
    assert judged(monkeypatch, reply).name == "craft-booking"


def test_the_last_json_object_is_the_answer_not_an_example_from_the_thinking(monkeypatch):
    thinking = 'Options: {"kind": "change"} or {"kind": "new", ...}. Braces {like this} are not JSON.\n'
    assert judged(monkeypatch, thinking + new()) == NewApp(
        "web-lite", "로그인과 예약 저장이면 Lite로 충분해요.", "craft-booking"
    )
    assert (
        judged(monkeypatch, thinking + new() + '\nOn second thought:\n```json\n{"kind": "change"}\n```')
        == WorkOnProject()
    )


def test_a_json_object_inside_the_answer_is_not_taken_for_the_answer(monkeypatch):
    reply = json.dumps(
        {"kind": "new", "template": "web-lite", "reason": "ok", "name": "a", "extra": {"kind": "change"}}
    )
    assert judged(monkeypatch, reply).template == "web-lite"


def test_a_reply_made_of_text_blocks_is_read_as_one_answer(monkeypatch):
    assert judged(monkeypatch, ["Let me think.", new()]).template == "web-lite"


def test_a_very_long_reply_is_still_read(monkeypatch):
    assert judged(monkeypatch, "{" * 30000 + "\n" + new()).template == "web-lite"


# ------------------------------------------------------------ the fields


def test_the_name_is_made_safe(monkeypatch):
    assert judged(monkeypatch, new(name="Craft Booking!!")).name == "craft-booking"
    assert judged(monkeypatch, new(name="../../etc/passwd")).name == "etc-passwd"
    assert judged(monkeypatch, new(name="공방 예약")).name == "new-app"
    assert judged(monkeypatch, new(name="")).name == "new-app"
    assert judged(monkeypatch, new(name=5)).name == "new-app"
    assert len(judged(monkeypatch, new(name="a" * 100)).name) <= 40


def test_a_missing_name_does_not_stop_a_clear_new_app(monkeypatch):
    reply = json.dumps({"kind": "new", "template": "blank", "reason": "웹 화면이 없는 자동화예요."})
    assert judged(monkeypatch, reply) == NewApp("blank", "웹 화면이 없는 자동화예요.", "new-app")


def test_a_korean_reason_is_kept_and_stays_one_line(monkeypatch):
    found = judged(monkeypatch, new(reason="  웹 화면 없이 도는\n자동화라서  빈 프로젝트가 맞아요.  "))
    assert found.reason == "웹 화면 없이 도는 자동화라서 빈 프로젝트가 맞아요."


# ------------------------------------------------------------ what the model is asked


def test_the_model_gets_no_tools_and_one_question(monkeypatch):
    _, model = ask(monkeypatch, [new()])
    [request] = model.requests
    assert request.tools == () and model.remaining == 0
    assert [m.role for m in request.messages] == ["user"]


def test_the_prompt_describes_only_the_templates_that_are_offered(monkeypatch):
    _, model = ask(monkeypatch, [new()], templates=["blank", "web-lite"])
    system = model.requests[0].system
    assert "`blank`" in system and "`web-lite`" in system
    assert "web-pro" not in system and "`mobile`" not in system
    assert "{{templates}}" not in system
    _, model = ask(monkeypatch, [new(template="web-pro")], templates=["web-lite", "web-pro", "mobile"])
    system = model.requests[0].system
    assert "`web-pro`" in system and "`mobile`" in system and "`blank`" not in system


def test_the_prompt_leans_to_the_project_and_asks_for_the_reason_in_the_users_language(monkeypatch):
    _, model = ask(monkeypatch, [new()])
    system = model.requests[0].system
    assert "If it could be work on the open project, it is `change`" in system
    assert "해요체" in system


def test_the_message_has_the_locale_and_the_text(monkeypatch):
    _, model = ask(monkeypatch, [new()], text="공방 예약 앱을 만들어 줘", locale="ko")
    message = model.requests[0].messages[0].text
    assert "<locale>ko</locale>" in message and "공방 예약 앱을 만들어 줘" in message
    assert "No project is open." in message


def test_a_very_long_text_is_cut(monkeypatch):
    _, model = ask(monkeypatch, [new()], text="a" * 20000)
    assert len(model.requests[0].messages[0].text) < 9000


def test_the_model_sees_the_open_project(monkeypatch, tmp_path):
    project = tmp_path / "craft-booking"
    (project / "src").mkdir(parents=True)
    (project / "package.json").write_text("{}")
    (project / ".git").mkdir()
    (project / "node_modules").mkdir()
    (project / "README.md").write_text("# Craft booking\n\nBookings for a pottery studio.\n")
    _, model = ask(monkeypatch, [new()], project=project)
    message = model.requests[0].messages[0].text
    assert "name: craft-booking" in message
    assert "top-level files and folders: package.json, README.md, src/" in message
    assert ".git" not in message and "node_modules" not in message
    assert "start of the README:\n# Craft booking\n\nBookings for a pottery studio." in message


def test_the_glimpse_is_short(monkeypatch, tmp_path):
    for i in range(60):
        (tmp_path / f"file{i:02}.txt").write_text("")
    (tmp_path / "README").write_text("\n".join(f"line {i}" for i in range(100)) + "\n" + "x" * 5000)
    _, model = ask(monkeypatch, [new()], project=tmp_path)
    message = model.requests[0].messages[0].text
    assert "file39.txt" in message and "file40.txt" not in message
    assert "(and 21 more)" in message
    assert "line 19" in message and "line 20" not in message


def test_a_missing_project_or_a_file_is_no_project(monkeypatch, tmp_path):
    (tmp_path / "file").write_text("x")
    for project in (tmp_path / "missing", tmp_path / "file"):
        _, model = ask(monkeypatch, [new()], project=project)
        assert "No project is open." in model.requests[0].messages[0].text


def test_an_empty_project_and_an_unreadable_readme_are_fine(monkeypatch, tmp_path):
    (tmp_path / "README.md").write_bytes(b"\xff\xfe\x00 not utf-8 \xff")
    _, model = ask(monkeypatch, [new()], project=tmp_path)
    assert "name: " in model.requests[0].messages[0].text


# ------------------------------------------------------------ failures


def test_a_failed_model_call_is_a_judge_error(monkeypatch):
    with pytest.raises(JudgeError, match="overloaded"):
        ask(monkeypatch, [ProviderError("overloaded")])


def test_a_model_that_cannot_be_made_is_a_config_error():
    with pytest.raises(ConfigError, match="No model"):
        judge(Settings(model=None), "앱 만들어 줘", "ko", OFFERED)
    with pytest.raises(ConfigError, match="Unknown provider"):
        judge(Settings(model="nowhere/some-model"), "앱 만들어 줘", "ko", OFFERED)


def test_a_model_without_credentials_is_a_judge_error():
    with pytest.raises(JudgeError, match="authentication"):
        judge(Settings(model="anthropic/claude-sonnet-5"), "앱 만들어 줘", "ko", OFFERED)


def test_without_templates_it_is_work_on_the_project_and_the_model_is_not_asked(monkeypatch):
    def fail(settings):
        raise AssertionError("the model must not be made")

    monkeypatch.setattr(judge_module, "make_model", fail)
    assert judge(SETTINGS, "앱 만들어 줘", "ko", []) == WorkOnProject()
    assert judge(Settings(model=None), "앱 만들어 줘", "ko", ()) == WorkOnProject()


def test_nothing_written_is_work_on_the_project_and_the_model_is_not_asked(monkeypatch):
    def fail(settings):
        raise AssertionError("the model must not be made")

    monkeypatch.setattr(judge_module, "make_model", fail)
    for text in ("", "   ", "\n\t "):
        assert judge(SETTINGS, text, "ko", OFFERED) == WorkOnProject()
        assert judge(Settings(model=None), text, "ko", OFFERED) == WorkOnProject()


def test_a_model_that_stalls_is_a_judge_error_and_does_not_hold_the_screen(monkeypatch):
    release = threading.Event()

    monkeypatch.setattr(judge_module, "make_model", lambda settings: FakeModel([new()]))
    monkeypatch.setattr(judge_module, "TIMEOUT", 0.2)
    monkeypatch.setattr(judge_module.Agent, "run", lambda self, message: release.wait(10))
    started = time.monotonic()
    try:
        with pytest.raises(JudgeError, match="did not answer"):
            judge(SETTINGS, "공방 예약 앱을 만들어 줘", "ko", OFFERED)
        assert time.monotonic() - started < 5
    finally:
        release.set()


def test_an_error_inside_the_call_reaches_the_caller_as_it_is(monkeypatch):
    monkeypatch.setattr(judge_module, "make_model", lambda settings: FakeModel([new()]))

    def boom(self, message):
        raise RuntimeError("not the model's doing")

    monkeypatch.setattr(judge_module.Agent, "run", boom)
    with pytest.raises(RuntimeError, match="not the model's doing"):
        judge(SETTINGS, "공방 예약 앱을 만들어 줘", "ko", OFFERED)


def test_nothing_is_written_to_stdout(monkeypatch, capfd, tmp_path):
    ask(monkeypatch, ["Thinking about it.\n" + new()], project=tmp_path)
    ask(monkeypatch, [new()])
    captured = capfd.readouterr()
    assert captured.out == ""
