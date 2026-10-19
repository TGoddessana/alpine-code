"""A scripted fake of the Alpine API (section 4 of docs/alpine-cloud-api.md) for tests: a threaded ``http.server`` on
``127.0.0.1:0`` that answers from memory. Point ``ALPINE_CLOUD_URL`` at ``FakeCloud.url``.

It answers what the app side needs so far: ``/v1/meta``, the sign-in (authorize -> consent -> callback -> token, the
email code, refresh with rotation, sign-out), ``/v1/me``, apps, the model gateway (SSE, credits, ``402``) and plans.
deploys (start, upload, check, publish, watch), restore points and restores, and the live data (tables, rows, query,
execute, reads, over a real sqlite per app: see ``make_live``). Later steps add their endpoints here.
Nothing leaves the computer: every address is the loopback.

Knobs a test turns: ``access_ttl`` (seconds an access token lives), ``revoke_access_tokens()``, ``fail_refresh``,
``consent`` (``approve`` or ``deny``), ``credits``, ``reply``, ``taken_names``, ``confirms`` (what a check asks the
person to confirm), ``fail_step`` (the publish step that fails), ``fail_restore``. ``requests`` records every call.
The check blocks an uploaded asset that holds ``sk_live_`` followed by letters or digits, like the real secret scan.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import sqlite3
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

RESERVED = {"www", "api", "admin", "app", "apps", "report", "abuse", "mail", "status", "help", "docs"}
APP_DOMAIN = "alpinesite.test"
REFILLS_AT = "2026-11-01T00:00:00Z"


class FakeCloud:
    def __init__(self) -> None:
        self.access_ttl = 3600.0
        self.fail_refresh = False
        self.consent = "approve"
        self.credits = 300
        self.credits_per_request = 1
        self.reply = "Hello from Alpine"
        self.plan = {"id": "free", "status": "active", "trial_ends_at": None, "renews_at": None, "trial_used": False}
        self.requests: list[dict[str, Any]] = []
        self.gateway_requests: list[dict[str, Any]] = []
        self.sent_codes: list[dict[str, str]] = []
        self.email_code = "123456"
        self.apps: dict[str, dict[str, Any]] = {}
        self.taken_names: set[str] = set()
        self.accounts: dict[str, dict[str, Any]] = {}
        self.confirms: list[dict[str, Any]] = []
        self.pending_migrations: list[str] = []
        self.fail_step: str | None = None
        self.fail_restore = False
        self.blobs: dict[str, bytes] = {}
        self.deploys: dict[str, dict[str, Any]] = {}
        self.points: dict[str, list[dict[str, Any]]] = {}
        self.live: dict[str, str] = {}  # app id -> the deploy that serves
        self.restores: dict[str, dict[str, Any]] = {}
        self.databases: dict[str, sqlite3.Connection] = {}
        self.reads: dict[str, list[dict[str, Any]]] = {}
        self._access: dict[str, tuple[str, float]] = {}  # token -> (account id, expires at)
        self._refresh: dict[str, str] = {}  # refresh token -> account id
        self._pending: dict[str, dict[str, str]] = {}
        self._codes: dict[str, dict[str, str]] = {}
        self._counter = 0
        self._lock = threading.RLock()
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _handler(self))
        self._server.daemon_threads = True
        self._thread = threading.Thread(target=lambda: self._server.serve_forever(poll_interval=0.02), daemon=True)

    # ---- lifecycle

    def start(self) -> FakeCloud:
        self._thread.start()
        return self

    def stop(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def __enter__(self) -> FakeCloud:
        return self.start()

    def __exit__(self, *exc: object) -> None:
        self.stop()

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}"

    # ---- knobs

    def make_live(self, app_id: str, schema: str) -> sqlite3.Connection:
        """Puts the app live with a database made by ``schema`` (SQL script). Returns it, to fill with rows."""
        db = sqlite3.connect(":memory:", check_same_thread=False)
        db.executescript(schema)
        with self._lock:
            self.databases[app_id] = db
            self.apps[app_id]["status"] = "live"
        return db

    def revoke_access_tokens(self) -> None:
        """Every access token stops working (the API answers 401); refresh tokens still do."""
        with self._lock:
            self._access.clear()

    def revoke_refresh_tokens(self) -> None:
        with self._lock:
            self._refresh.clear()

    def calls(self, method: str, path: str) -> list[dict[str, Any]]:
        return [r for r in self.requests if r["method"] == method and r["path"] == path]

    # ---- accounts and tokens

    def _next(self, prefix: str) -> str:
        with self._lock:
            self._counter += 1
            return f"{prefix}{self._counter}"

    def _account(self, email: str) -> dict[str, Any]:
        with self._lock:
            for account in self.accounts.values():
                if account["email"] == email:
                    return account
            account = {
                "id": self._next("acc_"),
                "email": email,
                "name": email.split("@")[0],
                "avatar_url": None,
                "status": "active",
                "created_at": "2026-10-20T01:00:00Z",
            }
            self.accounts[account["id"]] = account
            return account

    def _tokens(self, account: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            access, refresh = self._next("at_"), self._next("rt_")
            self._access[access] = (account["id"], time.time() + self.access_ttl)
            self._refresh[refresh] = account["id"]
        return {
            "access_token": access,
            "refresh_token": refresh,
            "expires_in": int(self.access_ttl),
            "token_type": "bearer",
            "account": {k: account[k] for k in ("id", "email", "name", "avatar_url")},
        }

    def _who(self, headers: Any) -> dict[str, Any] | None:
        token = (headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        with self._lock:
            entry = self._access.get(token)
            if entry is None or entry[1] < time.time():
                return None
            return self.accounts[entry[0]]

    def limits(self) -> dict[str, Any]:
        pro = self.plan["id"] == "pro"
        return {
            "apps": 20 if pro else 3,
            "mails_per_day": 1000 if pro else 100,
            "d1_mb": 5000 if pro else 500,
            "monthly_credits": 300,
            "restore_days": 30 if pro else 7,
            "custom_domains": pro,
            "badge": not pro,
            "web_pro": pro,
        }


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _error(status: int, code: str, message: str, **detail: Any) -> tuple[int, dict[str, Any]]:
    return status, {"error": {"code": code, "message": message, "detail": detail}}


def _handler(cloud: FakeCloud) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *args: Any) -> None:
            pass

        def _body(self) -> Any:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            self._raw = raw
            try:
                return json.loads(raw) if raw else None
            except ValueError:
                return None

        def _send(self, status: int, body: Any = None, headers: dict[str, str] | None = None) -> None:
            data = b"" if body is None else json.dumps(body).encode()
            self.send_response(status)
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            for key, value in (headers or {}).items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(data)

        def _redirect(self, location: str) -> None:
            self.send_response(302)
            self.send_header("Location", location)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _html(self, text: str) -> None:
            data = text.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _route(self, method: str) -> None:
            target = urllib.parse.urlsplit(self.path)
            query = {k: v[0] for k, v in urllib.parse.parse_qs(target.query).items()}
            body = self._body() if method in ("POST", "PUT", "PATCH") else None
            if method == "PUT":
                body = self._raw  # an upload: the bytes
            cloud.requests.append(
                {
                    "method": method,
                    "path": target.path,
                    "query": query,
                    "body": body if not isinstance(body, bytes) else f"<{len(body)} bytes>",
                    "headers": {k.title(): v for k, v in self.headers.items()},
                }
            )
            browser = target.path in ("/v1/auth/authorize", "/v1/auth/callback") or target.path.startswith(
                "/v1/auth/local"
            )
            if not browser and not self.headers.get("Alpine-Client", "").startswith("alpine-code/"):
                return self._send(*_error(426, "update_required", "Missing Alpine-Client header."))
            handler = getattr(self, "_" + re.sub(r"\W+", "_", f"{method} {target.path}").strip("_"), None)
            if handler is not None:
                return handler(query, body)
            for pattern, name in _PATTERNS:
                match = re.fullmatch(pattern, f"{method} {target.path}")
                if match:
                    return getattr(self, name)(match, query, body)
            self._send(*_error(404, "not_found", "No such endpoint."))

        do_GET = lambda self: self._route("GET")  # noqa: E731
        do_POST = lambda self: self._route("POST")  # noqa: E731
        do_PATCH = lambda self: self._route("PATCH")  # noqa: E731
        do_DELETE = lambda self: self._route("DELETE")  # noqa: E731
        do_PUT = lambda self: self._route("PUT")  # noqa: E731

        def _signed(self) -> dict[str, Any] | None:
            account = cloud._who(self.headers)
            if account is None:
                self._send(*_error(401, "unauthorized", "Sign in again."))
            return account

        # ---- meta and plans

        def _GET_v1_meta(self, query: dict, body: Any) -> None:
            self._send(
                200,
                {"api": "v1", "versions": ["v1"], "min_client": "0.1.0", "sunset": None, "app_domain": APP_DOMAIN,
                 "environment": "test"},
            )  # fmt: skip

        def _GET_v1_plans(self, query: dict, body: Any) -> None:
            free, pro = dict(cloud.limits(), apps=3), dict(cloud.limits(), apps=20, web_pro=True)
            self._send(
                200,
                {"plans": [{"id": "free", "limits": free},
                           {"id": "pro", "limits": pro, "price": {"amount": 0, "currency": "USD", "interval": "month"},
                            "trial_days": 7}]},
            )  # fmt: skip

        def _POST_v1_billing_trial(self, query: dict, body: Any) -> None:
            if self._signed() is None:
                return
            if cloud.plan["trial_used"]:
                return self._send(*_error(409, "conflict", "The trial was used."))
            cloud.plan = {**cloud.plan, "id": "pro", "status": "trialing", "trial_used": True,
                          "trial_ends_at": "2026-10-27T00:00:00Z"}  # fmt: skip
            self._send(200, {"plan": cloud.plan})

        # ---- sign-in

        def _GET_v1_auth_authorize(self, query: dict, body: Any) -> None:
            redirect = query.get("redirect_uri", "")
            if not re.fullmatch(r"http://127\.0\.0\.1:\d+/callback", redirect) or query.get("provider") not in (
                "google",
                "github",
            ):
                return self._send(*_error(400, "invalid", "redirect_uri must be http://127.0.0.1:<port>/callback"))
            if query.get("code_challenge_method") != "S256" or not query.get("code_challenge"):
                return self._send(*_error(400, "invalid", "PKCE S256 is required"))
            pending = cloud._next("pend_")
            cloud._pending[pending] = {k: query[k] for k in ("redirect_uri", "state", "code_challenge")}
            self._redirect(f"/v1/auth/local/consent?pending={pending}")

        def _GET_v1_auth_local_consent(self, query: dict, body: Any) -> None:
            if query.get("pending") not in cloud._pending:
                return self._send(*_error(404, "not_found", "Unknown sign-in."))
            if cloud.consent == "deny":
                return self._redirect(f"/v1/auth/callback?pending={query['pending']}&error=access_denied")
            self._redirect(f"/v1/auth/callback?pending={query['pending']}&as=test%40alpine.local")

        def _GET_v1_auth_callback(self, query: dict, body: Any) -> None:
            pending = cloud._pending.pop(query.get("pending", ""), None)
            if pending is None:
                return self._send(*_error(400, "invalid", "Unknown or used sign-in."))
            params = {"state": pending["state"]}
            if "error" in query:
                params["error"] = query["error"]
            else:
                code = _b64url(cloud._next("code_").encode())
                cloud._codes[code] = {**pending, "email": query.get("as", "test@alpine.local")}
                params["code"] = code
            self._redirect(f"{pending['redirect_uri']}?{urllib.parse.urlencode(params)}")

        def _POST_v1_auth_token(self, query: dict, body: Any) -> None:
            body = body or {}
            if body.get("grant_type") == "authorization_code":
                stored = cloud._codes.pop(body.get("code", ""), None)
                challenge = _b64url(hashlib.sha256(str(body.get("code_verifier", "")).encode()).digest())
                if (
                    stored is None
                    or stored["code_challenge"] != challenge
                    or stored["redirect_uri"] != body.get("redirect_uri")
                ):
                    return self._send(*_error(400, "invalid", "The sign-in code is not valid.", field="code"))
                return self._send(200, cloud._tokens(cloud._account(stored["email"])))
            if body.get("grant_type") == "refresh_token":
                account_id = None if cloud.fail_refresh else cloud._refresh.pop(body.get("refresh_token", ""), None)
                if account_id is None:
                    return self._send(*_error(401, "unauthorized", "The refresh token does not work."))
                return self._send(200, cloud._tokens(cloud.accounts[account_id]))
            self._send(*_error(400, "invalid", "Unknown grant_type.", field="grant_type"))

        def _POST_v1_auth_email_start(self, query: dict, body: Any) -> None:
            email = (body or {}).get("email", "")
            if "@" not in email:
                return self._send(*_error(400, "invalid", "That is not an email address.", field="email"))
            cloud.sent_codes.append({"email": email, "locale": (body or {}).get("locale", "")})
            self._send(204)

        def _POST_v1_auth_email_verify(self, query: dict, body: Any) -> None:
            body = body or {}
            if body.get("code") != cloud.email_code or "@" not in body.get("email", ""):
                return self._send(*_error(400, "invalid", "The code is not right.", field="code"))
            self._send(200, cloud._tokens(cloud._account(body["email"])))

        def _POST_v1_auth_sign_out(self, query: dict, body: Any) -> None:
            cloud._refresh.pop((body or {}).get("refresh_token", ""), None)
            self._send(204)

        # ---- account and apps

        def _GET_v1_me(self, query: dict, body: Any) -> None:
            if (account := self._signed()) is None:
                return
            self._send(
                200,
                {"account": account, "plan": cloud.plan, "limits": cloud.limits(),
                 "usage": {"apps": len(cloud.apps)},
                 "credits": {"balance": cloud.credits, "monthly": 300, "refills_at": REFILLS_AT}},
            )  # fmt: skip

        def _app(self, name: str, kind: str) -> dict[str, Any]:
            app_id = cloud._next("app_")
            address = f"{name}.{APP_DOMAIN}"
            app = {
                "id": app_id, "name": name, "kind": kind, "address": address, "url": f"https://{address}",
                "status": "empty", "database": {"kind": "d1", "size_mb": 0.2}, "published": None, "domains": [],
                "badge": True, "restore_days": cloud.limits()["restore_days"], "created_at": "2026-10-20T01:00:00Z",
            }  # fmt: skip
            cloud.apps[app_id] = app
            return app

        def _POST_v1_apps(self, query: dict, body: Any) -> None:
            if self._signed() is None:
                return
            name, kind = (body or {}).get("name", ""), (body or {}).get("kind", "web-lite")
            if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name) or not 3 <= len(name) <= 40 or name in RESERVED:
                return self._send(*_error(400, "invalid", "That name cannot be an app name.", field="name"))
            if kind == "web-pro" and not cloud.limits()["web_pro"]:
                return self._send(*_error(402, "payment_required", "Realtime web apps need Pro.", feature="web_pro"))
            if len(cloud.apps) >= cloud.limits()["apps"]:
                return self._send(
                    *_error(403, "limit_reached", "This account already has 3 apps.", limit="apps", max=3)
                )
            taken = {a["name"] for a in cloud.apps.values()} | cloud.taken_names
            if name in taken:
                suffix = 2
                while f"{name}-{suffix}" in taken:
                    suffix += 1
                return self._send(*_error(409, "name_taken", "That name is taken.", suggestion=f"{name}-{suffix}"))
            self._send(201, {"app": self._app(name, kind)})

        def _GET_v1_apps(self, query: dict, body: Any) -> None:
            if self._signed() is not None:
                self._send(200, {"apps": list(cloud.apps.values())})

        def _app_by_id(self, match: re.Match, query: dict, body: Any) -> None:
            if self._signed() is None:
                return
            app = cloud.apps.get(match["id"])
            if app is None:
                return self._send(*_error(404, "not_found", "No such app."))
            if self.command == "DELETE":
                del cloud.apps[app["id"]]
                return self._send(204)
            if self.command == "PATCH":
                app["badge"] = bool((body or {}).get("badge", app["badge"]))
            self._send(200, {"app": app})

        # ---- deploys

        def _deploy_state(self, deploy: dict[str, Any]) -> dict[str, Any]:
            """A deploy as the API shows it. Each look while publishing moves one step on."""
            if deploy["status"] == "publishing":
                order = ["restore", "files", "shape", "live"]
                deploy["polls"] += 1
                steps = []
                for index, name in enumerate(order):
                    if deploy["polls"] > index + 1:
                        state = "done"
                    elif deploy["polls"] == index + 1:
                        state = "running"
                    else:
                        state = "waiting"
                    if name == cloud.fail_step and state != "waiting":
                        state = "failed"
                    steps.append({"step": name, "state": state})
                deploy["steps"] = steps
                if any(s["state"] == "failed" for s in steps):
                    deploy["status"], deploy["error"] = "failed", f"The {cloud.fail_step} step failed."
                elif deploy["polls"] > len(order):
                    deploy["status"] = "live"
                    app = cloud.apps[deploy["app_id"]]
                    app["status"], app["published"] = "live", {"deploy_id": deploy["id"], "at": "2026-10-20T02:00:00Z"}
                    deploy["published_at"] = "2026-10-20T02:00:00Z"
                    cloud.live[app["id"]] = deploy["id"]
            return {
                "id": deploy["id"], "status": deploy["status"], "steps": deploy["steps"],
                "restore_point": deploy.get("restore_point"), "error": deploy["error"],
                "url": cloud.apps[deploy["app_id"]]["url"], "published_at": deploy.get("published_at"),
            }  # fmt: skip

        def _point(self, app_id: str, reason: str, deploy_id: str | None = None) -> dict[str, Any]:
            point = {"id": cloud._next("rp_"), "at": "2026-10-20T01:30:00Z", "reason": reason, "deploy_id": deploy_id}
            cloud.points.setdefault(app_id, []).append(point)
            return point

        def _deploy_for(self, match: re.Match) -> dict[str, Any] | None:
            if self._signed() is None:
                return None
            deploy = cloud.deploys.get(match["dep"])
            if deploy is None or deploy["app_id"] != match["id"]:
                self._send(*_error(404, "not_found", "No such deploy."))
                return None
            return deploy

        def _POST_deploys(self, match: re.Match, query: dict, body: Any) -> None:
            if self._signed() is None:
                return
            if match["id"] not in cloud.apps:
                return self._send(*_error(404, "not_found", "No such app."))
            body = body or {}
            wanted = [m["hash"] for m in body["worker"]["modules"]] + [a["hash"] for a in body.get("assets") or []]
            wanted += [m["hash"] for m in body.get("migrations") or []]
            deploy = {
                "id": cloud._next("dep_"), "app_id": match["id"], "status": "uploading", "manifest": body,
                "steps": [], "error": None, "polls": 0,
            }  # fmt: skip
            cloud.deploys[deploy["id"]] = deploy
            missing = list(dict.fromkeys(h for h in wanted if h not in cloud.blobs))
            self._send(201, {"deploy": {"id": deploy["id"], "status": "uploading"}, "missing": missing})

        def _PUT_file(self, match: re.Match, query: dict, body: Any) -> None:
            if self._deploy_for(match) is None:
                return
            if hashlib.sha256(body).hexdigest() != match["hash"]:
                return self._send(*_error(400, "invalid", "The bytes do not match the hash.", field="hash"))
            cloud.blobs[match["hash"]] = body
            self._send(204)

        def _POST_check(self, match: re.Match, query: dict, body: Any) -> None:
            deploy = self._deploy_for(match)
            if deploy is None:
                return
            manifest = deploy["manifest"]
            findings = []
            for asset in manifest.get("assets") or []:
                text = cloud.blobs.get(asset["hash"], b"").decode("utf-8", "replace")
                hit = re.search(r"sk_live_[A-Za-z0-9]{8,}", text)
                if hit:
                    value = hit.group(0)
                    findings.append(
                        {"check": "secret", "code": "secret.stripe_live", "severity": "block",
                         "file": asset["path"].lstrip("/"), "line": 1,
                         "params": {"kind": "Stripe live key", "redacted": value[:8] + "…" + value[-4:]},
                         "fallback": "A Stripe live key is in the page.", "fix": "Remove the key from the frontend."}
                    )  # fmt: skip
            blocked = bool(findings)
            missing = [h for h in [m["hash"] for m in manifest["worker"]["modules"]] if h not in cloud.blobs]
            if missing:
                return self._send(*_error(409, "conflict", "Files are still missing.", missing=missing))
            deploy["status"], deploy["blocked"] = "checked", blocked
            deploy["confirms"] = list(cloud.confirms)
            self._send(
                200,
                {"deploy": {"id": deploy["id"], "status": "checked"},
                 "checks": [{"id": "secret", "state": "blocked" if blocked else "ok", "findings": findings}],
                 "blocked": blocked,
                 "shape": {"pending": list(cloud.pending_migrations),
                           "added": {"tables": [], "columns": []}, "confirms": list(cloud.confirms)},
                 "restore_point_first": True},
            )  # fmt: skip

        def _POST_publish(self, match: re.Match, query: dict, body: Any) -> None:
            deploy = self._deploy_for(match)
            if deploy is None:
                return
            if deploy["status"] != "checked":
                return self._send(*_error(409, "conflict", "The deploy is not checked."))
            if deploy.get("blocked"):
                return self._send(*_error(422, "blocked", "The check found something that blocks publishing."))
            confirmed = set((body or {}).get("confirm") or [])
            unconfirmed = [c for c in deploy["confirms"] if c["id"] not in confirmed]
            if unconfirmed:
                return self._send(*_error(409, "needs_confirm", "Confirm these first.", confirms=unconfirmed))
            deploy["status"] = "publishing"
            deploy["restore_point"] = self._point(match["id"], "publish", deploy["id"])
            self._send(202, {"deploy": {"id": deploy["id"], "status": "publishing", "steps": []}})

        def _GET_deploy(self, match: re.Match, query: dict, body: Any) -> None:
            deploy = self._deploy_for(match)
            if deploy is not None:
                self._send(200, {"deploy": self._deploy_state(deploy)})

        # ---- restore

        def _restore_app(self, match: re.Match) -> dict[str, Any] | None:
            if self._signed() is None:
                return None
            app = cloud.apps.get(match["id"])
            if app is None:
                self._send(*_error(404, "not_found", "No such app."))
            return app

        def _GET_restore_points(self, match: re.Match, query: dict, body: Any) -> None:
            app = self._restore_app(match)
            if app is not None:
                self._send(200, {"points": cloud.points.get(app["id"], []), "window_days": app["restore_days"]})

        def _POST_restore_points(self, match: re.Match, query: dict, body: Any) -> None:
            app = self._restore_app(match)
            if app is not None:
                self._send(201, {"point": self._point(app["id"], "manual")})

        def _POST_restore(self, match: re.Match, query: dict, body: Any) -> None:
            app = self._restore_app(match)
            if app is None:
                return
            point = (body or {}).get("point")
            if point not in [p["id"] for p in cloud.points.get(app["id"], [])]:
                return self._send(*_error(404, "not_found", "No such restore point."))
            self._point(app["id"], "before_restore")
            restore = {"id": cloud._next("rs_"), "app_id": app["id"], "point": point, "looks": 0}
            cloud.restores[restore["id"]] = restore
            self._send(202, {"restore": {"id": restore["id"], "status": "running"}})

        def _GET_restore(self, match: re.Match, query: dict, body: Any) -> None:
            app = self._restore_app(match)
            restore = cloud.restores.get(match["rs"])
            if app is None:
                return
            if restore is None:
                return self._send(*_error(404, "not_found", "No such restore."))
            restore["looks"] += 1
            if restore["looks"] < 2:
                return self._send(200, {"restore": {"id": restore["id"], "status": "running", "error": None}})
            failed = cloud.fail_restore
            self._send(
                200,
                {"restore": {"id": restore["id"], "status": "failed" if failed else "done",
                             "error": "The restore failed." if failed else None}},
            )  # fmt: skip

        # ---- the model gateway

        def _GET_v1_gateway_models(self, query: dict, body: Any) -> None:
            if self._signed() is None:
                return
            self._send(
                200,
                {"object": "list", "data": [{"id": "alpine-coder", "object": "model", "owned_by": "alpine",
                                             "context_window": 200000, "default": True}]},
            )  # fmt: skip

        def _POST_v1_gateway_chat_completions(self, query: dict, body: Any) -> None:
            if (account := self._signed()) is None:
                return
            cloud.gateway_requests.append(
                {"body": body, "headers": {k.title(): v for k, v in self.headers.items()}, "account": account["id"]}
            )
            if cloud.credits <= 0:
                return self._send(*_error(402, "credits_exhausted", "No credits left.", refills_at=REFILLS_AT))
            cloud.credits -= cloud.credits_per_request
            remaining = {"Alpine-Credits-Remaining": str(cloud.credits)}
            words = cloud.reply.split(" ")
            if not (body or {}).get("stream"):
                message = {"role": "assistant", "content": cloud.reply}
                return self._send(
                    200,
                    {"id": "chatcmpl-1", "object": "chat.completion", "model": body["model"],
                     "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
                     "usage": {"prompt_tokens": 5, "completion_tokens": len(words), "total_tokens": 5 + len(words)}},
                    remaining,
                )  # fmt: skip
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Connection", "close")
            for key, value in remaining.items():
                self.send_header(key, value)
            self.end_headers()

            def chunk(delta: dict, finish: str | None = None, usage: dict | None = None) -> None:
                choices = [{"index": 0, "delta": delta, "finish_reason": finish}] if delta or finish else []
                payload = {
                    "id": "chatcmpl-1",
                    "object": "chat.completion.chunk",
                    "model": body["model"],
                    "choices": choices,
                    "usage": usage,
                }
                self.wfile.write(b"data: " + json.dumps(payload).encode() + b"\n\n")
                self.wfile.flush()

            chunk({"role": "assistant", "content": ""})
            for i, word in enumerate(words):
                chunk({"content": word if i == 0 else " " + word})
            chunk({}, "stop")
            if (body.get("stream_options") or {}).get("include_usage"):
                chunk({}, usage={"prompt_tokens": 5, "completion_tokens": len(words), "total_tokens": 5 + len(words)})
            self.wfile.write(b"data: [DONE]\n\n")
            self.wfile.flush()
            self.close_connection = True

        # ---- live data

        def _data_app(self, match: re.Match) -> tuple[dict[str, Any], sqlite3.Connection] | None:
            if self._signed() is None:
                return None
            app = cloud.apps.get(match["id"])
            if app is None:
                self._send(*_error(404, "not_found", "No such app."))
                return None
            db = cloud.databases.get(app["id"])
            if db is None or app["status"] != "live":
                self._send(*_error(404, "not_found", "The app has no live data yet."))
                return None
            return app, db

        def _GET_data_tables(self, match: re.Match, query: dict, body: Any) -> None:
            found = self._data_app(match)
            if found is None:
                return
            db, tables = found[1], []
            for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"):
                if _hidden(name):
                    continue
                columns = [
                    {"name": c[1], "type": c[2], "pk": bool(c[5]), "nullable": not (c[3] or c[5]), "references": None}
                    for c in db.execute(f'PRAGMA table_info("{name}")')
                ]
                rows = db.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
                tables.append({"name": name, "rows": rows, "columns": columns})
            self._send(200, {"tables": tables})

        def _GET_data_rows(self, match: re.Match, query: dict, body: Any) -> None:
            found = self._data_app(match)
            if found is None:
                return
            table = urllib.parse.unquote(match["table"])
            if _hidden(table) or not _has_table(found[1], table):
                return self._send(*_error(404, "not_found", "No such table."))
            self._send(200, _select(found[1], f'SELECT * FROM "{table}" LIMIT ? OFFSET ?', [
                min(int(query.get("limit", 100)), 500), int(query.get("offset", 0))]))  # fmt: skip

        def _POST_data_query(self, match: re.Match, query: dict, body: Any) -> None:
            found = self._data_app(match)
            if found is None:
                return
            sql = (body or {}).get("sql", "")
            if not re.match(r"\s*(select|with|explain|pragma\s+table_info)\b", sql, re.I) or ";" in sql.strip(" ;"):
                return self._send(*_error(400, "invalid", "Only one read statement is allowed."))
            try:
                result = _select(found[1], sql, (body or {}).get("params") or [])
            except sqlite3.Error as e:
                return self._send(*_error(400, "invalid", str(e)))
            if (body or {}).get("purpose") == "agent":
                cloud.reads.setdefault(found[0]["id"], []).insert(
                    0, {"at": "2026-10-20T02:00:00Z", "session": body.get("session"), "sql": sql,
                        "tables": re.findall(r"(?:from|join)\s+\"?(\w+)", sql, re.I), "rows": len(result["rows"])},
                )  # fmt: skip
            self._send(200, result)

        def _POST_data_execute(self, match: re.Match, query: dict, body: Any) -> None:
            found = self._data_app(match)
            if found is None:
                return
            sql = (body or {}).get("sql", "")
            if not re.match(r"\s*(insert|update|delete|replace)\b", sql, re.I) or ";" in sql.strip(" ;"):
                return self._send(*_error(400, "invalid", "Only one INSERT, UPDATE or DELETE is allowed."))
            point = self._point(found[0]["id"], "data_write")
            try:
                changes = found[1].execute(sql, (body or {}).get("params") or []).rowcount
                found[1].commit()
            except sqlite3.Error as e:
                return self._send(*_error(400, "invalid", str(e)))
            self._send(200, {"changes": changes, "restore_point": {"id": point["id"], "at": point["at"]}})

        def _GET_data_reads(self, match: re.Match, query: dict, body: Any) -> None:
            found = self._data_app(match)
            if found is not None:
                self._send(200, {"reads": cloud.reads.get(found[0]["id"], [])[: int(query.get("limit", 50))]})

    return Handler


def _hidden(table: str) -> bool:
    return table.startswith(("sqlite_", "_cf_")) or table == "d1_migrations"


def _has_table(db: sqlite3.Connection, table: str) -> bool:
    return db.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def _select(db: sqlite3.Connection, sql: str, params: list[Any]) -> dict[str, Any]:
    """Runs a read and masks the columns the real API masks (token, password, secret, hash words)."""
    cursor = db.execute(sql, params)
    columns = [d[0] for d in cursor.description or []]
    masked = [
        bool(re.search(r"(?i)(^|_)(token|password|secret|hash)($|_)|[a-z](Token|Password|Secret|Hash)", c))
        for c in columns
    ]
    rows = [
        [("••••" if m and v is not None else v) for v, m in zip(row, masked, strict=True)]
        for row in cursor.fetchmany(501)
    ]
    return {"columns": columns, "rows": rows[:500], "truncated": len(rows) > 500, "total": len(rows)}


#: Routes with a path parameter: ``(pattern of "METHOD /path", handler name)``.
_PATTERNS = [(rf"{m} /v1/apps/(?P<id>[^/]+)", "_app_by_id") for m in ("GET", "PATCH", "DELETE")] + [
    (r"POST /v1/apps/(?P<id>[^/]+)/deploys", "_POST_deploys"),
    (r"PUT /v1/apps/(?P<id>[^/]+)/deploys/(?P<dep>[^/]+)/files/(?P<hash>[0-9a-f]+)", "_PUT_file"),
    (r"POST /v1/apps/(?P<id>[^/]+)/deploys/(?P<dep>[^/]+)/check", "_POST_check"),
    (r"POST /v1/apps/(?P<id>[^/]+)/deploys/(?P<dep>[^/]+)/publish", "_POST_publish"),
    (r"GET /v1/apps/(?P<id>[^/]+)/deploys/(?P<dep>[^/]+)", "_GET_deploy"),
    (r"GET /v1/apps/(?P<id>[^/]+)/restore-points", "_GET_restore_points"),
    (r"POST /v1/apps/(?P<id>[^/]+)/restore-points", "_POST_restore_points"),
    (r"POST /v1/apps/(?P<id>[^/]+)/restore", "_POST_restore"),
    (r"GET /v1/apps/(?P<id>[^/]+)/restores/(?P<rs>[^/]+)", "_GET_restore"),
    (r"GET /v1/apps/(?P<id>[^/]+)/data/tables", "_GET_data_tables"),
    (r"GET /v1/apps/(?P<id>[^/]+)/data/tables/(?P<table>[^/]+)/rows", "_GET_data_rows"),
    (r"POST /v1/apps/(?P<id>[^/]+)/data/query", "_POST_data_query"),
    (r"POST /v1/apps/(?P<id>[^/]+)/data/execute", "_POST_data_execute"),
    (r"GET /v1/apps/(?P<id>[^/]+)/data/reads", "_GET_data_reads"),
]
