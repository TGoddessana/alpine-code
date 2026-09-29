import io

from rich.control import Control
from rich.text import Text

from alpine_cli.console import CLEAR_ALL, ReplayConsole


def test_replay_clears_and_prints_again_at_the_new_width():
    out = io.StringIO()
    console = ReplayConsole(file=out, width=40, force_terminal=True, color_system=None)
    console.print(Text("word " * 12))
    console.print(Control())  # rich Live repaints; not part of the scrollback
    console.width = 20
    out.truncate(0)
    out.seek(0)

    console.replay()

    text = out.getvalue()
    assert text.startswith(CLEAR_ALL)
    assert [line.rstrip() for line in text[len(CLEAR_ALL) :].splitlines()] == ["word word word word"] * 3


def test_replay_does_nothing_off_a_terminal():
    out = io.StringIO()
    console = ReplayConsole(file=out, force_terminal=False)
    console.print("hello")

    console.replay()

    assert out.getvalue() == "hello\n"
