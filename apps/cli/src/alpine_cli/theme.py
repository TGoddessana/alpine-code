"""Symbols and colors for the terminal frontend, in one place."""

from rich.text import Text
from rich.theme import Theme

BULLET = "◆"
RESULT = "└"
PROMPT = "›"
PEAK = "▲"
MODE = "»"

#: The banner mascot, a snow hare with black ear tips, as pixels. Two pixel rows make one line of text.
HARE = (
    "..KK...KK..",
    "..WW...WW..",
    "..WW...WW..",
    "..WW...WW..",
    ".WWWWWWWWW.",
    "WWWWWWWWWWW",
    "WWWEWWWEWWW",
    "WWWWWPWWWWW",
    ".WWWWWWWWW.",
    "...WWWWW...",
)
PIXELS = {"W": "#eeeeee", "K": "#767676", "E": "#1c1c1c", "P": "#ffafaf"}


def pixel_art(rows: tuple[str, ...], colors: dict[str, str]) -> list[Text]:
    """Draws pixel rows with half blocks: the top pixel is the foreground of ▀, the bottom one its background."""
    lines = []
    for top, bottom in zip(rows[::2], rows[1::2], strict=True):
        line = Text()
        for a, b in zip(top, bottom, strict=True):
            up, down = colors.get(a), colors.get(b)
            if up and down:
                line.append("█" if up == down else "▀", up if up == down else f"{up} on {down}")
            elif up or down:
                line.append("▀" if up else "▄", up or down)
            else:
                line.append(" ")
        lines.append(line)
    return lines

THEME = Theme(
    {
        "accent": "bold #5fafd7",
        "muted": "grey50",
        "tool": "bold",
        "ok": "green",
        "error": "red",
        "warn": "yellow",
        "user": "grey70",
    }
)

MODE_LABELS = {
    "default": "ask before edits",
    "accept_edits": "accept edits",
    "auto": "auto — a reviewer model decides",
    "yolo": "yolo — never ask",
}

#: prompt_toolkit style for the input box, toolbar and choices.
PT_STYLE = {
    "frame.border": "#666666",
    "bottom-toolbar": "noreverse #808080 bg:default",
    "bottom-toolbar.mode": "noreverse #5fafd7 bg:default",
    "bottom-toolbar.yolo": "noreverse bold #ff5f5f bg:default",
    "placeholder": "#666666",
    "selected-option": "bold #5fafd7",
}
