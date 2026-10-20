"""The database a 실시간 웹앱's AI works against (section 4.11 of docs/alpine-cloud-api.md).

When a session starts in a project whose ``cloud.toml`` says ``web-pro`` and that is linked to an app, a dev branch of
the app's database is made and its address and public key are written to the project's ``.env.development.local``.
It goes again after a publish (``alpine_core.cloud.publish.run``), so the next message of a session in that project
makes a new one. Making one can take a while, so a session start does not wait for it; the next message does.

A branch that cannot be made (the plan ended, no network) is not an error for the session: the AI works without it.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from alpine_core.cloud import CloudError, SignedOut, pro
from alpine_core.cloud import settings as cloud_settings


class DevBranches:
    def __init__(self) -> None:
        self._working: dict[Path, asyncio.Task[None]] = {}

    def start(self, folder: Path) -> None:
        """Begins making the project's dev branch if it needs one. Returns at once."""
        if not cloud_settings.enabled():
            return
        folder = folder.resolve()
        if folder in self._working or pro.needs_dev_branch(folder):
            self._task(folder)

    async def ready(self, folder: Path) -> None:
        """Waits until the project's dev branch is there (or could not be made). A project that needs none does not
        wait at all, not even for one turn of the loop: a message must start running at once."""
        if not cloud_settings.enabled():
            return
        folder = folder.resolve()
        if folder in self._working or pro.needs_dev_branch(folder):
            await asyncio.shield(self._task(folder))

    async def shutdown(self) -> None:
        for task in list(self._working.values()):
            task.cancel()

    def _task(self, folder: Path) -> asyncio.Task[None]:
        task = self._working.get(folder)
        if task is None or task.done():
            task = self._working[folder] = asyncio.create_task(self._make(folder))
            task.add_done_callback(lambda done, f=folder: self._forget(f, done))
        return task

    def _forget(self, folder: Path, done: asyncio.Task[None]) -> None:
        if self._working.get(folder) is done:
            del self._working[folder]

    async def _make(self, folder: Path) -> None:
        try:
            await asyncio.to_thread(pro.ensure_dev_branch, folder)
        except (CloudError, SignedOut, pro.DevBranchFailed) as e:
            print(f"dev branch for {folder.name}: {type(e).__name__}", file=sys.stderr)  # never the values
        except Exception as e:  # a bug must not stop the session that asked
            print(f"dev branch for {folder.name}: {type(e).__name__}: {e}", file=sys.stderr)
