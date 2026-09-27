"""Symbols and colors for the terminal frontend, in one place."""

from rich.theme import Theme

BULLET = "●"
RESULT = "⎿"
PROMPT = "❯"
STAR = "✻"

THEME = Theme(
    {
        "accent": "bold #d7875f",
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
    "bottom-toolbar.mode": "noreverse #d7875f bg:default",
    "bottom-toolbar.yolo": "noreverse bold #ff5f5f bg:default",
    "placeholder": "#666666",
    "selected-option": "bold #d7875f",
}
