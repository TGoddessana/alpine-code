"""Runs the core for an app (the desktop app today) over stdio. Started by the app as a child process."""

from .stdio import main

__all__ = ["main"]
