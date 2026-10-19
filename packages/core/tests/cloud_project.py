"""A project with a prebuilt Cloudflare Vite plugin output and a local D1 as the plugin keeps it, for the cloud tests of
core and the server."""

import json
import sqlite3
import subprocess
from pathlib import Path

TOML = """version = 1
kind = "web-lite"
adapter = "cloudflare-workers"

[build]
command = "{command}"
output = "dist"

[database]
kind = "d1"
migrations = "drizzle"
"""

GENERATED = {
    "name": "my-app",
    "compatibility_date": "2026-10-19",
    "compatibility_flags": ["nodejs_compat"],
    "main": "index.js",
    "assets": {
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*"],
        "directory": "../client",
    },
    "secrets": {"required": ["BETTER_AUTH_SECRET"]},
    "d1_databases": [{"binding": "DB", "database_name": "my-app-db", "migrations_dir": "../../drizzle"}],
}


def git(folder: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(folder), *args], check=True, capture_output=True)


def make_project(tmp_path: Path, *, command: str = "echo building", name: str = "craft-booking") -> Path:
    """A project with a prebuilt output, as ``vite build`` with the Cloudflare plugin leaves it: ``.wrangler/deploy/
    config.json`` points at ``dist/<worker>/wrangler.json``, next to the Worker's ``index.js`` and its chunks, and the
    static files are in ``dist/client``."""
    folder = tmp_path / name
    (folder / ".alpine-code").mkdir(parents=True)
    (folder / ".alpine-code" / "cloud.toml").write_text(TOML.format(command=command))
    (folder / "drizzle").mkdir()
    (folder / "drizzle" / "0000_auth.sql").write_text("CREATE TABLE user (id text primary key);\n")
    (folder / "drizzle" / "0001_notes.sql").write_text("CREATE TABLE notes (id integer primary key, body text);\n")
    (folder / "src").mkdir()
    (folder / "src" / "app.ts").write_text("export const a = 1;\n")
    (folder / ".gitignore").write_text("node_modules\ndist\n.wrangler\n")
    worker = folder / "dist" / "my_app"
    (worker / "assets").mkdir(parents=True)
    (worker / "index.js").write_text("import './assets/chunk-1.js'; export default { fetch() {} };\n")
    (worker / "index.js.map").write_text("{}")
    (worker / "assets" / "chunk-1.js").write_text("export const chunk = 1;\n")
    (worker / "wrangler.json").write_text(json.dumps(GENERATED))
    (worker / ".vite").mkdir()
    (worker / ".vite" / "manifest.json").write_text("{}")
    client = folder / "dist" / "client"
    (client / "assets").mkdir(parents=True)
    (client / "index.html").write_text("<!doctype html><title>x</title>")
    (client / "assets" / "index-1a2b.js").write_text("console.log('hello');\n")
    (client / "assets" / "index-1a2b.css").write_text("body{margin:0}\n")
    (client / "secret-notes.txt").write_text("not for the web")
    (client / ".assetsignore").write_text("secret-notes.txt\n")
    (folder / ".wrangler" / "deploy").mkdir(parents=True)
    (folder / ".wrangler" / "deploy" / "config.json").write_text(
        json.dumps({"configPath": "../../dist/my_app/wrangler.json", "auxiliaryWorkers": []})
    )
    git(folder, "init", "-q", "-b", "main")
    git(folder, "config", "user.email", "t@example.com")
    git(folder, "config", "user.name", "T")
    git(folder, "add", "-A")
    git(folder, "commit", "-q", "-m", "first")
    return folder


SCHEMA = """
CREATE TABLE bookings (id text PRIMARY KEY, guest text NOT NULL, status text, party integer, created_at text);
CREATE TABLE user (id text PRIMARY KEY, email text, password_hash text, accessToken text, hashtag text);
CREATE TABLE d1_migrations (id integer PRIMARY KEY, name text);
CREATE TABLE _cf_KV (key text PRIMARY KEY, value blob);
INSERT INTO bookings VALUES ('b1', 'Mina', 'confirmed', 2, '2026-10-01');
INSERT INTO bookings VALUES ('b2', 'Joon', 'cancelled', 4, '2026-10-02');
INSERT INTO bookings VALUES ('b3', 'Ara', 'confirmed', 3, '2026-10-03');
INSERT INTO user VALUES ('u1', 'mina@example.com', 'pbkdf2$secret', 'tok_123', 'fun');
INSERT INTO user VALUES ('u2', 'joon@example.com', NULL, NULL, NULL);
INSERT INTO d1_migrations VALUES (1, '0000_init.sql');
"""

PLUGIN_FOLDER = Path(".wrangler/state/v3/d1/miniflare-D1DatabaseObject")


def make_practice(folder: Path, schema: str = SCHEMA) -> Path:
    """The local D1 as the plugin keeps it: ``<hash>.sqlite`` in the miniflare folder (and a second, empty one)."""
    where = folder / PLUGIN_FOLDER
    where.mkdir(parents=True, exist_ok=True)
    (sqlite3.connect(where / "metadata.sqlite")).close()
    file = where / "ab12cd34.sqlite"
    db = sqlite3.connect(file)
    db.executescript(schema)
    db.commit()
    db.close()
    return file
