"""Symbols and colors for the terminal frontend, in one place."""

from rich.theme import Theme

BULLET = "◆"
RESULT = "└"
PROMPT = "›"
PEAK = "▲"
MODE = "»"

#: The banner mascot: twin snow-capped peaks, one line per row, in rich markup.
MASCOT = (
    "    [snow]▄█▄[/]      ",
    "  [rock]▄█████▄[/][snow]▄█▄[/] ",
    "[rock]▄███████████▄[/]",
)

THEME = Theme(
    {
        "accent": "bold #5fafd7",
        "snow": "#eeeeee",
        "rock": "#5f87af",
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
