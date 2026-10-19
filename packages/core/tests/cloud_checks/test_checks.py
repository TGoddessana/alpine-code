import http.server
import json
import threading
from pathlib import Path

import pytest

from alpine_core.cloud.checks import Finding, LocalReport, open_routes, run_local_checks, scan_assets, scan_text

VECTORS = json.loads((Path(__file__).parent / "vectors.json").read_text(encoding="utf-8"))["cases"]

KEY = "sk_live_" + "aB3dE5fG7hJ9kL1mN2pQ4rS6"
MIDDLE = "aB3dE5fG7hJ9kL1mN2pQ"


@pytest.mark.parametrize("case", VECTORS, ids=[c["name"] for c in VECTORS])
def test_vectors(case):
    got = [{"code": code, "redacted": redacted} for code, redacted, _ in scan_text("".join(case["parts"]))]
    assert got == case["hits"]


def test_vectors_cover_every_code():
    codes = {h["code"] for c in VECTORS for h in c["hits"]}
    assert codes == {
        "secret.stripe_live",
        "secret.openai",
        "secret.anthropic",
        "secret.aws",
        "secret.private_key",
        "secret.github",
        "secret.supabase_service",
        "secret.resend",
        "secret.alpine_app",
        "secret.google_api",
        "secret.stripe_test",
    }


def test_scan_text_gives_the_offset():
    (hit,) = scan_text("x = '" + KEY + "'")
    assert hit[2] == 5


def test_scan_assets_reads_text_files_only(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index.js").write_text(f"a\nb\nconst k='{KEY}'")
    (tmp_path / "assets" / "logo.png").write_bytes(KEY.encode())
    (tmp_path / "assets" / "font.woff2").write_bytes(KEY.encode())
    (tmp_path / "assets" / "index.js.map").write_text(f'{{"x":"{KEY}"}}')
    findings = scan_assets(tmp_path)
    assert [(f.file, f.line, f.code) for f in findings] == [
        ("assets/index.js", 3, "secret.stripe_live"),
        ("assets/index.js.map", 1, "secret.stripe_live"),
    ]
    assert all(f.check == "secret" and f.severity == "block" for f in findings)


def test_scan_assets_never_keeps_the_whole_secret(tmp_path):
    (tmp_path / "a.js").write_text(KEY)
    (finding,) = scan_assets(tmp_path)
    assert finding.params == {"kind": "Stripe secret key", "redacted": "sk_live_…4rS6"}
    assert MIDDLE not in repr(finding)
    assert "a.js" in finding.fix and "sk_live_…4rS6" in finding.fix


def test_scan_assets_names_files_relative_to_the_project(tmp_path):
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "a.js").write_text(KEY)
    (finding,) = scan_assets(tmp_path / "dist", root=tmp_path)
    assert finding.file == "dist/a.js"


def test_scan_assets_does_not_follow_links_out_of_the_folder(tmp_path):
    outside = tmp_path / "outside.js"
    outside.write_text(KEY)
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "link.js").symlink_to(outside)
    assert scan_assets(tmp_path / "dist") == []


def test_warn_codes_do_not_block(tmp_path):
    (tmp_path / "a.js").write_text("sk_test_" + "aB3dE5fG7hJ9kL1m")
    (finding,) = scan_assets(tmp_path)
    assert finding.severity == "warn"


# open_routes against a small server that imitates the template's dev server


class Dev(http.server.ThreadingHTTPServer):
    def __init__(self, routes, answers, listing_status=200):
        self.routes, self.answers, self.listing_status = routes, answers, listing_status
        self.seen: list[tuple[str, str, bytes, str | None]] = []
        super().__init__(("127.0.0.1", 0), Handler)

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server_address[1]}"


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def handle_any(self):
        length = int(self.headers.get("Content-Length") or 0)
        self.server.seen.append((self.command, self.path, self.rfile.read(length), self.headers.get("Cookie")))
        if self.path == "/api/dev/routes":
            if self.server.listing_status != 200:
                return self.reply(self.server.listing_status, b"")
            body = json.dumps({"routes": self.server.routes}).encode()
            return self.reply(200, body)
        status, body = self.server.answers.get((self.command, self.path), (404, b""))
        self.reply(status, body)

    def reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_any


@pytest.fixture
def serve():
    servers = []

    def start(routes, answers, listing_status=200):
        server = Dev(routes, answers, listing_status)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        servers.append(server)
        return server

    yield start
    for server in servers:
        server.shutdown()
        server.server_close()


def route(method, path):
    return {"method": method, "path": path}


def test_open_routes_reports_readable_and_writable(serve):
    server = serve(
        [
            route("GET", "/api/notes"),
            route("GET", "/api/notes"),
            route("POST", "/api/notes"),
            route("GET", "/api/notes/:id"),
            route("GET", "/api/health"),
            route("GET", "/api/empty"),
            route("GET", "/api/dev/sign-in"),
            route("GET", "/api/me"),
            route("DELETE", "/api/secret"),
            route("ALL", "/api/*"),
        ],
        {
            ("GET", "/api/notes"): (200, b'{"notes":[{"id":1}]}'),
            ("POST", "/api/notes"): (400, b"{}"),
            ("GET", "/api/health"): (200, b"ok"),
            ("GET", "/api/empty"): (200, b"[]"),
            ("GET", "/api/me"): (401, b'{"error":"no"}'),
            ("DELETE", "/api/secret"): (403, b""),
        },
    )
    findings, skipped = open_routes(server.url)
    assert skipped is None
    assert [(f.code, f.severity, dict(f.params)) for f in findings] == [
        ("open_api.readable", "warn", {"method": "GET", "path": "/api/notes"}),
        ("open_api.writable", "warn", {"method": "POST", "path": "/api/notes"}),
    ]
    assert all(f.check == "open-api" and f.file is None and f.fix for f in findings)
    # what the check sent: no content, no cookie, and nothing to the dev routes or the routes with parameters
    paths = {(m, p) for m, p, _, _ in server.seen}
    assert ("GET", "/api/dev/sign-in") not in paths and ("GET", "/api/notes/:id") not in paths
    assert all(body == b"" and cookie is None for _, _, body, cookie in server.seen)


def test_open_routes_locked_app_has_no_findings(serve):
    server = serve(
        [route("GET", "/api/notes"), route("POST", "/api/notes"), route("PUT", "/api/x")],
        {("GET", "/api/notes"): (401, b""), ("POST", "/api/notes"): (401, b""), ("PUT", "/api/x"): (404, b"")},
    )
    assert open_routes(server.url) == ([], None)


def test_open_routes_redirect_is_not_a_readable_answer(serve):
    server = serve([route("GET", "/api/notes")], {})
    server.answers[("GET", "/api/notes")] = (302, b'{"a":1}')
    assert open_routes(server.url) == ([], None)


def test_open_routes_skips_without_a_route_list(serve):
    server = serve([], {}, listing_status=404)
    assert open_routes(server.url) == ([], "no route list")


def test_open_routes_skips_a_list_it_cannot_read(serve):
    server = serve([], {})
    server.routes = "not a list"
    assert open_routes(server.url)[1] == "no route list"


def test_open_routes_skips_without_a_dev_server():
    server = Dev([], {})
    url = server.url
    server.server_close()
    assert open_routes(url, timeout=2) == ([], "no dev server running")


# run_local_checks


def test_run_local_checks_runs_both(tmp_path, serve):
    project = tmp_path / "app"
    (project / "dist").mkdir(parents=True)
    (project / "dist" / "index.js").write_text(KEY)
    server = serve([route("GET", "/api/notes")], {("GET", "/api/notes"): (200, b'[{"a":1}]')})
    report = run_local_checks(project, assets=project / "dist", dev_url=server.url)
    assert isinstance(report, LocalReport) and all(isinstance(f, Finding) for f in report.findings)
    assert report.ran == {"secret", "open-api"} and report.skipped == {}
    assert [(f.code, f.file) for f in report.findings] == [
        ("secret.stripe_live", "dist/index.js"),
        ("open_api.readable", None),
    ]


def test_run_local_checks_says_what_it_skipped(tmp_path):
    report = run_local_checks(tmp_path, assets=tmp_path / "dist", dev_url=None)
    assert report.findings == () and report.ran == frozenset()
    assert report.skipped == {"secret": "no build output", "open-api": "no dev server running"}


def test_run_local_checks_keeps_a_skip_reason_from_the_probe(tmp_path, serve):
    (tmp_path / "dist").mkdir()
    server = serve([], {}, listing_status=404)
    report = run_local_checks(tmp_path, assets=tmp_path / "dist", dev_url=server.url)
    assert report.ran == {"secret"} and report.skipped == {"open-api": "no route list"}
