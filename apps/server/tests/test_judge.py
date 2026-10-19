"""``projects/judge`` on the wire: the default model decides, the server offers the templates it has."""

import importlib
import io
import json
import threading

import pytest
from alpineagents import ProviderError
from alpineagents.testing import FakeModel

from alpine_protocol import JudgedChange, JudgedNew, ProjectsJudgeParams
from alpine_server.judge import judge_project
from alpine_server.methods import MethodError
from alpine_server.stdio import serve

# ``alpine_core.judge`` is the function once the package is imported; the module is what holds ``make_model``.
core_judge = importlib.import_module("alpine_core.judge")

NEW = {
    "kind": "new",
    "template": "web-lite",
    "reason": "로그인과 예약 저장이면 Lite로 충분해요.",
    "name": "craft-booking",
}


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_CODE_HOME", str(tmp_path / "home"))
    for name in ("ALPINE_MODEL", "ALPINE_BASE_URL", "ALPINE_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path / "home"


@pytest.fixture
def templates(tmp_path, monkeypatch):
    """A templates folder with blank and web-lite."""
    root = tmp_path / "alpine-templates"
    for name in ("blank", "web-lite"):
        (root / name).mkdir(parents=True)
    monkeypatch.setenv("ALPINE_TEMPLATES", str(root))
    return root


def model_says(monkeypatch, *replies):
    model = FakeModel(replies)
    monkeypatch.setattr(core_judge, "make_model", lambda settings: model)
    return model


def call(**params) -> dict:
    line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "projects/judge", "params": params})
    out = io.StringIO()
    serve(io.StringIO(line + "\n"), out)
    return json.loads(out.getvalue())


def ask(text="공방 예약 앱을 만들어 줘", locale="ko", cwd=None, new_project=False):
    return judge_project(ProjectsJudgeParams(text=text, locale=locale, cwd=cwd, new_project=new_project)).judgement


def test_a_change_starts_a_session_on_the_project(templates, monkeypatch):
    model_says(monkeypatch, '{"kind": "change"}')
    assert call(text="버튼을 크게 해 줘", locale="ko")["result"] == {"judgement": {"kind": "change"}}


def test_a_new_app_carries_every_field_on_the_wire(templates, monkeypatch):
    model_says(monkeypatch, json.dumps(NEW))
    assert call(text="공방 예약 앱을 만들어 줘", locale="ko")["result"] == {"judgement": NEW}


def test_the_judgement_is_typed(templates, monkeypatch):
    model_says(monkeypatch, json.dumps(NEW), '{"kind": "change"}')
    assert ask() == JudgedNew(template="web-lite", reason=NEW["reason"], name="craft-booking")
    assert ask() == JudgedChange()


def test_an_answer_with_thinking_around_it_is_read(templates, monkeypatch):
    model_says(monkeypatch, f'Hmm, {{"kind": "change"}} is possible, but no.\n```json\n{json.dumps(NEW)}\n```\nDone.')
    assert call(text="앱 만들어 줘", locale="ko")["result"]["judgement"] == NEW


@pytest.mark.parametrize(
    "reply",
    [
        "I am not sure what you mean.",
        "{broken",
        json.dumps(NEW | {"template": "web-pro"}),  # the templates folder has no web-pro
        json.dumps(NEW | {"template": "mobile"}),
        json.dumps(NEW | {"reason": ""}),
    ],
)
def test_an_unclear_answer_is_a_change(templates, monkeypatch, reply):
    model_says(monkeypatch, reply)
    assert call(text="앱 만들어 줘", locale="ko")["result"] == {"judgement": {"kind": "change"}}


def test_only_the_templates_the_server_has_are_offered(templates, monkeypatch):
    model = model_says(monkeypatch, json.dumps(NEW))
    ask()
    system = model.requests[0].system
    assert "`blank`" in system and "`web-lite`" in system and "web-pro" not in system and "`mobile`" not in system
    (templates / "web-pro").mkdir()
    model = model_says(monkeypatch, json.dumps(NEW | {"template": "web-pro"}))
    assert ask().template == "web-pro"
    assert "`web-pro`" in model.requests[0].system


def test_the_model_sees_the_project_the_screen_is_on(templates, monkeypatch, tmp_path):
    project = tmp_path / "craft-booking"
    project.mkdir()
    (project / "package.json").write_text("{}")
    (project / "README.md").write_text("# Craft booking\n\nBookings for a pottery studio.\n")
    model = model_says(monkeypatch, '{"kind": "change"}')
    call(text="예약 페이지 만들어 줘", locale="ko", cwd=str(project))
    message = model.requests[0].messages[0].text
    assert "name: craft-booking" in message and "package.json" in message and "pottery studio" in message
    assert "<locale>ko</locale>" in message and "예약 페이지 만들어 줘" in message


def test_a_folder_that_does_not_exist_is_no_project(templates, monkeypatch, tmp_path):
    model = model_says(monkeypatch, '{"kind": "change"}')
    ask(cwd=str(tmp_path / "gone"))
    assert "No project is open." in model.requests[0].messages[0].text


def test_a_home_relative_project_is_found(templates, monkeypatch, tmp_path):
    (tmp_path / "craft-booking").mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    model = model_says(monkeypatch, '{"kind": "change"}')
    ask(cwd="~/craft-booking")
    assert "name: craft-booking" in model.requests[0].messages[0].text


def test_a_failed_model_call_is_model_failed(templates, monkeypatch):
    model_says(monkeypatch, ProviderError("The model is overloaded"))
    error = call(text="앱 만들어 줘", locale="ko")["error"]
    assert error["data"] == {"reason": "model_failed"} and "overloaded" in error["message"]
    model_says(monkeypatch, ProviderError("The model is overloaded"))
    with pytest.raises(MethodError) as raised:
        ask()
    assert raised.value.data.reason == "model_failed"


def test_a_model_that_is_not_set_is_invalid_config(templates):
    error = call(text="앱 만들어 줘", locale="ko")["error"]
    assert error["data"] == {"reason": "invalid_config"} and "No model" in error["message"]


def test_an_unreadable_config_file_is_invalid_config(templates, home):
    home.mkdir()
    (home / "config.toml").write_text("this is [not toml")
    assert call(text="앱 만들어 줘", locale="ko")["error"]["data"] == {"reason": "invalid_config"}


def test_without_templates_it_is_a_change_and_the_model_is_not_asked(tmp_path, monkeypatch):
    monkeypatch.setenv("ALPINE_TEMPLATES", str(tmp_path / "nothing-here"))

    def fail(settings):
        raise AssertionError("the model must not be made")

    monkeypatch.setattr(core_judge, "make_model", fail)
    assert call(text="앱 만들어 줘", locale="ko")["result"] == {"judgement": {"kind": "change"}}


def test_a_text_of_only_spaces_is_a_change_and_the_model_is_not_asked(templates, monkeypatch):
    def fail(settings):
        raise AssertionError("the model must not be made")

    monkeypatch.setattr(core_judge, "make_model", fail)
    # Not even the settings are read: with none set, anything else would be invalid_config.
    assert call(text="   ", locale="ko")["result"] == {"judgement": {"kind": "change"}}


def test_a_model_that_stalls_is_model_failed(templates, monkeypatch):
    release = threading.Event()
    model_says(monkeypatch, "unused")
    monkeypatch.setattr(core_judge, "TIMEOUT", 0.2)
    monkeypatch.setattr(core_judge.Agent, "run", lambda self, message: release.wait(10))
    try:
        error = call(text="앱 만들어 줘", locale="ko")["error"]
    finally:
        release.set()
    assert error["data"] == {"reason": "model_failed"} and "did not answer" in error["message"]


def test_an_empty_text_is_refused(templates):
    assert call(text="", locale="ko")["error"]["code"] == -32602


def test_nothing_but_the_answer_reaches_stdout(templates, monkeypatch, capfd):
    model_says(monkeypatch, "Thinking about it.\n" + json.dumps(NEW))
    assert call(text="앱 만들어 줘", locale="ko")["result"]["judgement"] == NEW
    assert capfd.readouterr().out == ""


# ------------------------------------------------------------ 새로 만들기


def test_a_chosen_new_project_is_judged_as_one_on_the_wire(templates, monkeypatch):
    model = model_says(monkeypatch, json.dumps({k: v for k, v in NEW.items() if k != "kind"}))
    assert call(text="공방 예약 앱을 만들어 줘", locale="ko", new_project=True)["result"] == {"judgement": NEW}
    [request] = model.requests
    assert "make a new project" in request.system and "change" not in request.system.lower()


def test_the_flag_is_passed_and_the_project_is_dropped(templates, monkeypatch, tmp_path):
    project = tmp_path / "craft-booking"
    project.mkdir()
    (project / "package.json").write_text("{}")
    (project / "README.md").write_text("# Craft booking\n\nBookings for a pottery studio.\n")
    model = model_says(monkeypatch, json.dumps(NEW), json.dumps(NEW))
    assert ask(cwd=str(project), new_project=True) == JudgedNew(
        template="web-lite", reason=NEW["reason"], name="craft-booking"
    )
    message = model.requests[0].messages[0].text
    assert "craft-booking" not in message and "package.json" not in message and "pottery studio" not in message
    assert "open_project" not in message and "<locale>ko</locale>" in message
    # Without the flag the same call shows the project, and offers change.
    ask(cwd=str(project))
    assert "name: craft-booking" in model.requests[1].messages[0].text
    assert "`change`" in model.requests[1].system


def test_a_chosen_new_project_never_comes_back_as_a_change(templates, monkeypatch):
    for reply in ('{"kind": "change"}', "I am not sure.", json.dumps(NEW | {"template": "web-pro"})):
        model_says(monkeypatch, reply)
        found = ask(new_project=True)
        assert found == JudgedNew(template="web-lite", reason="", name=found.name)
    model_says(monkeypatch, json.dumps({"template": "blank", "name": "Photo Tool"}))
    assert call(text="사진 이름 바꾸는 도구", locale="ko", new_project=True)["result"] == {
        "judgement": {"kind": "new", "template": "blank", "reason": "", "name": "photo-tool"}
    }


def test_only_the_templates_the_server_has_are_offered_to_a_chosen_new_project(templates, monkeypatch):
    model = model_says(monkeypatch, "no idea")
    assert ask(new_project=True).template == "web-lite"
    system = model.requests[0].system
    assert "`blank`" in system and "`web-lite`" in system and "web-pro" not in system and "`mobile`" not in system
    (templates / "web-lite").rmdir()
    model_says(monkeypatch, "no idea")
    assert ask(new_project=True).template == "blank"


def test_a_chosen_new_project_with_nothing_to_make_or_nothing_written_is_a_change(tmp_path, monkeypatch, templates):
    def fail(settings):
        raise AssertionError("the model must not be made")

    monkeypatch.setattr(core_judge, "make_model", fail)
    assert call(text="   ", locale="ko", new_project=True)["result"] == {"judgement": {"kind": "change"}}
    monkeypatch.setenv("ALPINE_TEMPLATES", str(tmp_path / "nothing-here"))
    assert call(text="앱 만들어 줘", locale="ko", new_project=True)["result"] == {"judgement": {"kind": "change"}}


def test_a_failed_model_call_for_a_chosen_new_project_is_model_failed(templates, monkeypatch):
    model_says(monkeypatch, ProviderError("The model is overloaded"))
    error = call(text="앱 만들어 줘", locale="ko", new_project=True)["error"]
    assert error["data"] == {"reason": "model_failed"}
