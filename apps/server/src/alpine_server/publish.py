"""``publish/*``: putting a project on its Alpine app (올리기) and getting an earlier version back.

``publish/prepare`` builds, runs the local checks, uploads and asks the API to check; ``publish/run`` publishes what was
prepared. Both answer after the work and announce each phase on the way as ``publish/changed``. The blocking work runs
in a thread (``alpine_core.cloud.publish``); its progress comes back to the loop with ``call_soon_threadsafe``.

The rest of the ``publish/`` family (domains, badge) stays ``not_available`` in ``cloud.py`` until it is built.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from alpine_core.cloud import App, CloudError, SignedOut, publish
from alpine_core.cloud.build import BuildFailed
from alpine_core.dev_servers import DevelopmentServerManager
from alpine_protocol.cloud import (
    AppInfo,
    PublishCancelParams,
    PublishCancelResult,
    PublishChangedParams,
    PublishCwdParams,
    PublishPlan,
    PublishPrepareParams,
    PublishRestoreParams,
    PublishRestorePointsResult,
    PublishRestoreResult,
    PublishRunParams,
    PublishRunResult,
    PublishStatus,
)

from .cloud import method_error
from .methods import APP_ERROR, INVALID_PARAMS, MethodError

Notify = Callable[[PublishChangedParams], None]


class PublishMethods:
    def __init__(self, notify: Notify, dev_servers: DevelopmentServerManager) -> None:
        self._notify = notify
        self._dev_servers = dev_servers
        self._cancels: dict[str, threading.Event] = {}

    def handlers(self) -> dict[str, Callable[[Any], Awaitable[Any]]]:
        return {
            "publish/status": self.status,
            "publish/prepare": self.prepare,
            "publish/run": self.run,
            "publish/cancel": self.cancel,
            "publish/restorePoints": self.restore_points,
            "publish/restore": self.restore,
        }

    async def shutdown(self) -> None:
        for cancel in self._cancels.values():
            cancel.set()

    async def status(self, params: PublishCwdParams) -> PublishStatus:
        try:
            found = await asyncio.to_thread(publish.status, _folder(params.cwd))
        except (CloudError, SignedOut) as e:  # a status never fails for a network or sign-in problem
            raise method_error(e) from e
        return PublishStatus(
            publishable=found.publishable,
            reason=found.reason,
            app=app_info(found.app) if found.app is not None else None,
            last_published_at=found.last_published_at,
            changes=found.changes,
        )

    async def prepare(self, params: PublishPrepareParams) -> PublishPlan:
        if params.id in self._cancels:
            raise MethodError(INVALID_PARAMS, f"A publish with id {params.id!r} is already working")
        cancel = self._cancels[params.id] = threading.Event()
        try:
            folder = _folder(params.cwd)
            dev_url = await self._dev_url(params.cwd)
            plan = await asyncio.to_thread(
                publish.prepare,
                folder,
                progress=self._progress(params.id, asyncio.get_running_loop()),
                dev_url=dev_url,
                locale=params.locale,
                cancel=cancel,
            )
        except BuildFailed as e:
            raise MethodError(APP_ERROR, f"{e.message}\n{e.tail}".strip(), "build_failed") from e
        except publish.Cancelled as e:
            raise MethodError(APP_ERROR, "Publishing was cancelled.", "other") from e
        except (CloudError, SignedOut) as e:
            raise method_error(e) from e
        finally:
            self._cancels.pop(params.id, None)
        return PublishPlan.model_validate(
            {
                "deploy_id": plan.deploy_id,
                "checks": plan.checks,
                "blocked": plan.blocked,
                "shape": plan.shape,
                "app": app_info(plan.app),
            }
        )

    async def run(self, params: PublishRunParams) -> PublishRunResult:
        try:
            app, published_at = await asyncio.to_thread(
                publish.run,
                _folder(params.cwd),
                params.deploy_id,
                params.confirm,
                progress=self._progress(params.id, asyncio.get_running_loop()),
            )
        except publish.NotLinked as e:
            raise MethodError(APP_ERROR, "This project has no app to publish to yet.", "not_found") from e
        except publish.PublishError as e:
            raise MethodError(APP_ERROR, e.message, "other") from e
        except (CloudError, SignedOut) as e:
            raise method_error(e) from e
        return PublishRunResult(app=app_info(app), published_at=published_at)

    async def cancel(self, params: PublishCancelParams) -> PublishCancelResult:
        cancel = self._cancels.get(params.id)
        if cancel is not None:
            cancel.set()
        return PublishCancelResult()

    async def restore_points(self, params: PublishCwdParams) -> PublishRestorePointsResult:
        try:
            found = await asyncio.to_thread(publish.restore_points, _folder(params.cwd))
        except publish.NotLinked as e:
            raise MethodError(APP_ERROR, "This project has no app yet.", "not_found") from e
        except (CloudError, SignedOut) as e:
            raise method_error(e) from e
        return PublishRestorePointsResult.model_validate(found)

    async def restore(self, params: PublishRestoreParams) -> PublishRestoreResult:
        try:
            await asyncio.to_thread(publish.restore, _folder(params.cwd), params.point)
        except publish.NotLinked as e:
            raise MethodError(APP_ERROR, "This project has no app yet.", "not_found") from e
        except publish.PublishError as e:
            raise MethodError(APP_ERROR, e.message, "other") from e
        except (CloudError, SignedOut) as e:
            raise method_error(e) from e
        return PublishRestoreResult()

    # ---- helpers

    async def _dev_url(self, cwd: str) -> str | None:
        """The address of the project's running dev server, which the open-API check asks for its routes."""
        try:
            servers = await self._dev_servers.list(cwd)
        except OSError:
            return None
        return next((s["url"] for s in servers if s.get("status") == "running" and s.get("url")), None)

    def _progress(self, id: str, loop: asyncio.AbstractEventLoop) -> publish.Progress:
        def progress(phase: str, fraction: float, message: str | None, checks: list[dict[str, Any]] | None) -> None:
            changed = PublishChangedParams.model_validate(
                {"id": id, "phase": phase, "progress": fraction, "message": message, "checks": checks}
            )
            loop.call_soon_threadsafe(self._notify, changed)

        return progress


def app_info(app: App) -> AppInfo:
    return AppInfo(
        id=app.id, name=app.name, address=app.address, url=app.url, status=app.status, kind=app.kind, badge=app.badge
    )


def _folder(cwd: str) -> Path:
    folder = Path(cwd).expanduser().resolve()
    if not folder.is_dir():
        raise MethodError(APP_ERROR, f"{cwd} is not a folder", "not_a_folder")
    return folder
