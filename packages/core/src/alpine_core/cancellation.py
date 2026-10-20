"""Who is running and whether it was stopped, for the processes a session's tools start."""

from __future__ import annotations

import threading
from contextvars import ContextVar

current_session: ContextVar[str | None] = ContextVar("alpine_session", default=None)
current_cancellation: ContextVar[threading.Event | None] = ContextVar("alpine_cancellation", default=None)
#: Who inside a session starts the processes, e.g. one TF agent, so stopping it can end what it started.
current_owner: ContextVar[str | None] = ContextVar("alpine_owner", default=None)
