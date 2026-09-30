from rich.console import Console

from alpine_cli import commands
from alpine_cli.render import Renderer
from alpine_cli.theme import THEME
from alpine_core import AssistantDone, Interrupted, ToolFinished, ToolStarted, TurnStarted


def render(*events) -> str:
    console = Console(record=True, width=100, theme=THEME, force_terminal=False)
    renderer = Renderer(console)
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


def test_interrupted():
    assert "Interrupted" in render(Interrupted())


def test_commands_resolve_aliases():
    cmd, arg = commands.find("/model anthropic/claude-sonnet-5")
    assert cmd.name == "model" and arg == "anthropic/claude-sonnet-5"
    assert commands.find("/quit")[0].name == "exit"
    assert commands.find("/nope") is None
