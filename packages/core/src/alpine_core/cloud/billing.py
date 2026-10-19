"""Plans, the Pro trial and payment (section 4.10 of docs/alpine-cloud-api.md).

Payment happens in the browser, on the provider's page. ``checkout`` opens a loopback listener (``127.0.0.1:<port>
/billing``) and gives its address to the API as the ``return_url``; when the page sends the browser back, the status is
asked again and announced, and the listener closes. ``portal`` has no return address, so the plan is watched for a
while after it opens. Nothing here knows which payment provider the API uses.
"""

from __future__ import annotations

import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from . import account, auth
from .account import CloudStatus
from .auth import AlpineTokens
from .client import CloudClient

__all__ = ["CheckoutReturn", "checkout", "plans", "portal", "start_trial", "watch_plan"]

#: How long the loopback listener waits for the browser to come back from the payment page.
RETURN_TIMEOUT = 1800.0
#: After the portal opens, the plan is asked again this often, for this long.
WATCH_EVERY = 3.0
WATCH_FOR = 600.0

_PAGE = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Alpine</title><body style="font-family:system-ui,sans-serif;text-align:center;margin-top:20vh">
<h2>앱으로 돌아가세요 / Go back to the app</h2></body>"""


def plans(client: CloudClient | None = None) -> dict[str, Any]:
    """``GET /v1/plans`` (no sign-in needed)."""
    return (client or CloudClient()).get("/v1/plans", auth=False)


def start_trial(client: CloudClient | None = None) -> CloudStatus:
    """Starts the 7-day Pro trial (once per account, no payment method) and returns the new status.

    Raises:
        CloudError: ``conflict`` when the trial was used already.
    """
    (client or CloudClient(AlpineTokens())).post("/v1/billing/trial")
    return _refresh()


def portal(client: CloudClient | None = None) -> str:
    """The page where the person manages (or cancels) their plan; the plan is watched while they are there."""
    url = (client or CloudClient(AlpineTokens())).post("/v1/billing/portal")["url"]
    watch_plan()
    return url


def checkout(plan: str = "pro", client: CloudClient | None = None) -> str:
    """The payment page's address. A listener waits for the browser to come back and then announces the new status.

    Raises:
        CloudError: The API refused (no listener is left open then).
    """
    client = client or CloudClient(AlpineTokens())
    waiting = CheckoutReturn.start()
    try:
        return client.post("/v1/billing/checkout", {"plan": plan, "return_url": waiting.url})["url"]
    except BaseException:
        waiting.close()
        raise


def watch_plan(*, every: float | None = None, until: float | None = None) -> threading.Thread:
    """Asks for the status every few seconds and announces it when the plan changed, for a few minutes."""
    before = _plan_key(account.snapshot())
    every = WATCH_EVERY if every is None else every

    def watch() -> None:
        deadline = time.monotonic() + (WATCH_FOR if until is None else until)
        while time.monotonic() < deadline:
            time.sleep(every)
            if not auth.signed_in():
                return
            fresh = account.status(refresh=True)
            if fresh.reachable and _plan_key(fresh) != before:
                account.changed()
                return

    thread = threading.Thread(target=watch, daemon=True, name="alpine-plan-watch")
    thread.start()
    return thread


def _plan_key(status: CloudStatus) -> tuple[Any, ...]:
    plan = status.plan or {}
    return (plan.get("id"), plan.get("status"))


def _refresh() -> CloudStatus:
    account.invalidate()
    fresh = account.status(refresh=True)
    account.changed()
    return fresh


class CheckoutReturn:
    """The loopback address the payment page sends the browser back to. Closes after the first visit (or on timeout)."""

    def __init__(self, server: ThreadingHTTPServer, timeout: float) -> None:
        self._server = server
        self._closed = threading.Event()
        port = server.server_address[1]
        self.url = f"http://127.0.0.1:{port}/billing"
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
        threading.Thread(target=self._expire, args=(timeout,), daemon=True).start()

    @classmethod
    def start(cls, timeout: float = RETURN_TIMEOUT) -> CheckoutReturn:
        holder: list[CheckoutReturn] = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: Any) -> None:
                pass

            def do_GET(self) -> None:
                if self.path.split("?")[0] != "/billing":
                    self.send_response(404)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                data = _PAGE.encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                threading.Thread(target=holder[0].returned, daemon=True).start()

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        server.daemon_threads = True
        holder.append(cls(server, timeout))
        return holder[0]

    def returned(self) -> None:
        """The browser is back: ask for the new status, announce it, close."""
        try:
            if auth.signed_in():
                _refresh()
        finally:
            self.close()

    def close(self) -> None:
        if not self._closed.is_set():
            self._closed.set()
            self._server.shutdown()
            self._server.server_close()

    def _expire(self, timeout: float) -> None:
        if not self._closed.wait(timeout):
            self.close()

    @property
    def closed(self) -> bool:
        return self._closed.is_set()
