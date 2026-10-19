"""``projects/nodeTools`` and ``projects/installNodeTools``: the Node.js web apps need, mirroring ``projects/gitTools``.

The install answers at once; the download runs as a task and goes out as ``projects/nodeToolsChanged``.
"""

from __future__ import annotations

import asyncio
import sys
import time
import traceback
from collections.abc import Awaitable, Callable
from typing import Any

from alpine_core.cloud import runtimes
from alpine_protocol.cloud import (
    ProjectsInstallNodeToolsParams,
    ProjectsInstallNodeToolsResult,
    ProjectsNodeToolsChangedParams,
    ProjectsNodeToolsParams,
    ProjectsNodeToolsResult,
)

Notify = Callable[[ProjectsNodeToolsChangedParams], None]

#: Download progress goes out at most this often.
_PROGRESS_EVERY = 0.3


class NodeTools:
    def __init__(self, notify: Notify) -> None:
        self._notify = notify
        self._task: asyncio.Task[None] | None = None

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {"projects/nodeTools": self.node_tools, "projects/installNodeTools": self.install}

    async def shutdown(self) -> None:
        if self._task is not None:
            self._task.cancel()

    async def node_tools(self, params: ProjectsNodeToolsParams) -> ProjectsNodeToolsResult:
        # use_node also puts the right Node first on PATH, so a Node found now is the one sessions and builds use.
        await asyncio.to_thread(runtimes.use_node)
        node = await asyncio.to_thread(runtimes.status)
        return ProjectsNodeToolsResult(
            ready=node.ready, version=node.version, required=node.required, alpine_managed=node.alpine_managed
        )

    async def install(self, params: ProjectsInstallNodeToolsParams) -> ProjectsInstallNodeToolsResult:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._install(asyncio.get_running_loop()))
        return ProjectsInstallNodeToolsResult()

    async def _install(self, loop: asyncio.AbstractEventLoop) -> None:
        sent_at = 0.0

        def progress(fraction: float) -> None:
            nonlocal sent_at
            now = time.monotonic()
            if fraction < 1 and now - sent_at < _PROGRESS_EVERY:
                return
            sent_at = now
            loop.call_soon_threadsafe(
                self._notify, ProjectsNodeToolsChangedParams(state="downloading", progress=fraction)
            )

        self._notify(ProjectsNodeToolsChangedParams(state="downloading", progress=0))
        try:
            await asyncio.to_thread(runtimes.install, progress)
            await asyncio.to_thread(runtimes.use_node)
            self._notify(ProjectsNodeToolsChangedParams(state="done", progress=1))
        except runtimes.NodeInstallError as e:
            self._notify(ProjectsNodeToolsChangedParams(state="failed", message=str(e), reason=e.kind))
        except asyncio.CancelledError:
            raise
        except Exception as e:  # a bug: the app still must not wait for ever
            traceback.print_exc(file=sys.stderr)
            self._notify(ProjectsNodeToolsChangedParams(state="failed", message=f"{type(e).__name__}: {e}"))
