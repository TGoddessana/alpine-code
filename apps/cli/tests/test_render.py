from rich.console import Console

from alpine_cli import commands
from alpine_cli.render import Renderer
from alpine_cli.theme import THEME
from alpine_core import AssistantDone, Interrupted, Plan, PlanCheck, PlanStep, ToolFinished, ToolStarted, TurnStarted


def render(*events, plan=None) -> str:
    console = Console(record=True, width=100, theme=THEME, force_terminal=False)
    renderer = Renderer(console, plan=lambda: plan)
    for event in events:
        renderer(event)
    return console.export_text()


def test_tool_lines():
    out = render(
        TurnStarted(1),
        AssistantDone("Let me look."),
        ToolStarted("1", "bash", {"command": "ls"}),
        ToolFinished("1", "bash", {"command": "ls"}, "a\nb\nc\nd\ne\nf", "done"),
        ToolFinished("2", "edit", {"path": "x.py"}, "The user declined this tool call.", "denied"),
        ToolFinished("3", "read", {"path": "y.py"}, "y.py does not exist", "error"),
        ToolFinished("4", "read", {"path": "dot.png"}, "(image/png, 34.2KB)", "done", images=1),
    )
    assert "◆ Let me look." in out
    assert "◆ bash(ls)" in out and "└  a" in out and "… +2 lines" in out
    assert "◆ edit(x.py)" in out and "Declined" in out
    assert "◆ read(y.py)" in out and "└  y.py does not exist" in out
    assert "◆ read(dot.png)" in out and "Viewed image (image/png, 34.2KB)" in out


def test_the_plan_prints_as_a_checklist_and_checks_say_how_they_ended():
    plan = Plan(
        (PlanStep("find the cause", "done"), PlanStep("fix it", "now"), PlanStep("run the tests", "todo")),
        ("write a test first",),
        (PlanCheck("tests", "harness", "pytest"), PlanCheck("screen", "agent", how="screenshots")),
    )
    detail = {"kind": "plan", "created": False, "dropped": ["write a test first"], "checks_changed": True}
    out = render(
        ToolFinished("1", "update_plan", {"steps": []}, "Plan updated", "done", detail=detail),
        ToolFinished("2", "check", {"label": "tests"}, "ok\n[check passed]", "done", detail={
            "kind": "check", "label": "tests", "judge": "harness", "passed": True, "evidence": ["2"]}),
        ToolFinished("3", "check", {"label": "tests"}, "E boom\n[exit code 1: check failed]", "done", detail={
            "kind": "check", "label": "tests", "judge": "harness", "passed": False, "evidence": ["3"]}),
        ToolFinished("4", "check", {"label": "screen"}, "Recorded", "done", detail={
            "kind": "check", "label": "screen", "judge": "agent", "passed": True, "evidence": ["a", "b"]}),
        plan=plan,
    )  # fmt: skip
    assert "◆ Plan\n  └  ☒ find the cause\n     ☐ fix it\n     ☐ run the tests" in out
    assert "Dropped from the plan: write a test first" in out and "Checks: tests, screen (agent)" in out
    assert "◆ check(tests)\n  └  Passed" in out and "└  E boom" in out
    assert "Agent's judgement · passed · 2 calls as evidence" in out


def test_interrupted():
    assert "Interrupted" in render(Interrupted())


def test_commands_resolve_aliases():
    cmd, arg = commands.find("/model anthropic/claude-sonnet-5")
    assert cmd.name == "model" and arg == "anthropic/claude-sonnet-5"
    assert commands.find("/quit")[0].name == "exit"
    assert commands.find("/nope") is None
