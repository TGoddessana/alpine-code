"""A rich Console that remembers what it printed, so the scrollback can be printed again after a resize."""

from __future__ import annotations

from typing import Any

from rich.console import Console
from rich.control import Control

#: Home the cursor, clear the screen, then clear the scrollback.
CLEAR_ALL = "\x1b[H\x1b[2J\x1b[3J"


class ReplayConsole(Console):
    """Keeps every ``print`` call. ``replay`` clears the terminal and prints them all again at the current width.

    Terminals rewrap lines when they get narrower (and some move rows in and out of the scrollback when they get
    shorter), so after a resize the rows on screen no longer match what was printed. Printing everything again
    is the only redraw that looks the same in every terminal.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._printed: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    def print(self, *objects: Any, **kwargs: Any) -> None:
        # rich Live repaints itself through print(Control()); that is not part of the scrollback.
        if not any(isinstance(o, Control) for o in objects):
            self._printed.append((objects, kwargs))
        super().print(*objects, **kwargs)

    def replay(self) -> None:
        if not self.is_terminal:
            return
        self.file.write(CLEAR_ALL)
        for objects, kwargs in self._printed:
            super().print(*objects, **kwargs)
        self.file.flush()
