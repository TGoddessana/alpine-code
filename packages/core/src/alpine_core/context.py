"""How much a model reads at once, and the point where its conversation is tidied (``tidy.py``).

The window comes from the first of these that knows it: the number the user wrote for the model
(``[connections.<name>.models."<model>"] context_window``), what the server said when its models were listed
(``list_models``, kept in ``reported_windows.json``), the models.dev catalog (``limit.input`` or ``limit.context``).
Otherwise it is unknown, and the conversation is not tidied before the provider refuses it as too long.

The tidy point is near the window's end, leaving room for the next reply; or, when the catalog says a longer
prompt costs more (Haiku 5.5 bills a whole request at 5x past 100,000 tokens), just before that step.
"""

from __future__ import annotations

import json
import threading
import weakref
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from alpineagents import Model

from .catalog import Catalog, connection_entry, input_limit, price_step, provider_entry
from .config import Connection
from .home import home_dir

#: Least room left at the window's end, for the next reply and the summary request, unless the window is small.
RESERVE = 20_000
#: Room left before a price step, as a share of it: tokens are estimated, and a prompt past the step costs more.
STEP_MARGIN = 0.05


@dataclass(frozen=True)
class ContextLimits:
    window: int | None
    """Tokens the model reads at once; ``None``: unknown."""
    price_step: int | None = None
    """Prompt length past which a request costs more; ``None``: the price is flat (or unknown)."""
    reply: int | None = None
    """Most tokens one reply may write, when known: some providers count it into the window."""

    @property
    def fit(self) -> int | None:
        """The most a request may hold and still leave room for its reply in the window."""
        if not self.window:
            return None
        small = self.window // 2  # an 8K local model cannot keep 20K free
        room = max(self.window // 10, min(max(RESERVE, self.reply or 0), small))
        return self.window - room

    @property
    def tidy_at(self) -> int | None:
        """The conversation is tidied when it is longer than this; ``None`` for an unknown window."""
        fit = self.fit
        if fit is None:
            return None
        if self.price_step and self.window and self.price_step < self.window:
            return min(fit, self.price_step - int(self.price_step * STEP_MARGIN))
        return fit


_known: weakref.WeakKeyDictionary[Model, ContextLimits] = weakref.WeakKeyDictionary()


def remember[M: Model](model: M, limits: ContextLimits) -> M:
    """Keeps what ``make_model`` found out about the model, for ``limits_of``."""
    _known[model] = limits
    return model


def limits_of(model: Model) -> ContextLimits:
    """The limits ``make_model`` found for the model. A model it did not make (a ChatGPT model, which reads its window
    from the account's model list; one alpineagents resolved from a string; a test's) goes by its own
    ``context_window``."""
    known = _known.get(model)
    if known is not None:
        return known
    try:
        window = model.context_window
    except Exception:  # a model that cannot say
        return ContextLimits(None)
    return ContextLimits(window if isinstance(window, int) and window > 0 else None)


def limits_for(
    connection: Connection | None, provider: str, model: str, catalog: Catalog, *, reply: int | None = None
) -> ContextLimits:
    """The limits of ``model`` from ``connection`` (or, with none, from the provider ``provider``): the user's number,
    what the server said, the catalog, in that order."""
    entry = connection_entry(connection, model, catalog) if connection else provider_entry(provider, model, catalog)
    window = None
    if connection is not None:
        written = connection.models.get(model)
        window = (written.context_window if written else None) or reported_window(connection.name, model)
    return ContextLimits(window or input_limit(entry), price_step(entry), reply)


# ------------------------------------------------------------ windows the servers reported

_lock = threading.Lock()


def reported_file() -> Path:
    return home_dir() / "cache" / "reported_windows.json"


def reported_window(connection: str, model: str) -> int | None:
    """The window the connection's server reported for the model when its models were last listed."""
    window = _read_reported().get(connection, {}).get(model)
    return window if isinstance(window, int) and window > 0 else None


def save_reported(connection: str, windows: Mapping[str, int | None]) -> None:
    """Keeps the windows a server reported for its models, replacing what it reported before. Models it said nothing
    about are left out."""
    known = {model: window for model, window in windows.items() if window}
    with _lock:
        data = _read_reported()
        if data.get(connection, {}) == known:
            return
        if known:
            data[connection] = known
        else:
            data.pop(connection, None)
        file = reported_file()
        try:
            file.parent.mkdir(parents=True, exist_ok=True)
            tmp = file.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
            tmp.replace(file)
        except OSError:  # a cache: the window is looked up again next time
            pass


def _read_reported() -> dict[str, dict[str, int]]:
    try:
        data = json.loads(reported_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, dict)} if isinstance(data, dict) else {}
