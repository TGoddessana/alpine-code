import json
import threading
from dataclasses import replace
from datetime import date
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from alpine_core import PROVIDERS, Connection, hidden_models
from alpine_core.models import list_models

#: Trimmed from real /models answers: OpenRouter nests what a model does under ``architecture``, OneRouter does not.
MODELS = [
    {
        "id": "or/coder",
        "architecture": {"input_modalities": ["text", "image"], "output_modalities": ["text"]},
        "supported_parameters": ["tools", "temperature"],
    },
    {
        "id": "or/no-tools",
        "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
        "supported_parameters": ["temperature"],
    },
    {
        "id": "or/painter",
        "architecture": {"input_modalities": ["text"], "output_modalities": ["image"]},
        "supported_parameters": ["tools"],
    },
    {
        "id": "one/coder",
        "input_modalities": ["text"],
        "output_modalities": ["Text"],
        "supports_function_calling": True,
        "category_type": "LLM",
    },
    {
        "id": "one/old",
        "input_modalities": ["text"],
        "output_modalities": ["text"],
        "supports_function_calling": True,
        "deprecated": True,
    },
    {"id": "one/embedder", "category_type": "Embeddings"},
    {
        "id": "one/video",
        "input_modalities": ["image"],
        "output_modalities": ["video"],
        "category_type": "Image to Video",
    },
    {"id": "ollama/qwen3"},
]


@pytest.fixture
def server():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = json.dumps({"object": "list", "data": [{"object": "model", **m} for m in MODELS]}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_port}/v1"
    httpd.shutdown()


def test_compatible_servers_list_only_models_that_can_be_the_agent(server):
    models = list_models(Connection("router", base_url=server), None)
    assert models == ["ollama/qwen3", "one/coder", "or/coder"]


TODAY = date(2026, 10, 5)
CATALOG = {
    "openrouter": {
        "api": "https://openrouter.ai/api/v1",
        "models": {
            "qwen/qwen3.8-max": {"family": "qwen-max", "release_date": "2026-09-01"},
            "qwen/qwen3.5-max": {"family": "qwen-max", "release_date": "2026-03-01"},
            "qwen/qwen3.5-4b": {"family": "qwen-small", "release_date": "2026-08"},
            "openai/gpt-4": {"family": "gpt", "release_date": "2023-03-14"},
        },
    },
    "anthropic": {"models": {"claude-opus-5-5": {"family": "claude-opus", "release_date": "2026-09-22"}}},
}
ROUTER = ["openai/gpt-4", "qwen/qwen3.5-4b", "qwen/qwen3.5-max", "qwen/qwen3.8-max", "x/new-unlisted"]


def hidden(connection, models=ROUTER):
    return hidden_models(connection, models, CATALOG, today=TODAY)


def test_a_router_in_the_catalog_shows_each_familys_recent_newest():
    router = Connection("local-2", base_url="https://openrouter.ai/api/v1/")
    assert hidden(router) == ["openai/gpt-4", "qwen/qwen3.5-max", "x/new-unlisted"]
    assert hidden(Connection("or", PROVIDERS["openrouter"])) == hidden(router)
    chosen = replace(router, show=("openai/gpt-4",), hide=("qwen/qwen3.5-4b",))
    assert hidden(chosen) == ["qwen/qwen3.5-4b", "qwen/qwen3.5-max", "x/new-unlisted"]


def test_a_server_the_catalog_does_not_know_shows_what_was_chosen():
    unknown = Connection("local", base_url="https://llm.onerouter.pro/v1", show=("qwen/qwen3.8-max",))
    assert "qwen/qwen3.8-max" not in hidden(unknown) and len(hidden(unknown)) == 4


def test_a_server_on_this_computer_shows_everything():
    for url in ("http://localhost:11434/v1", "http://127.0.0.1:1234/v1", "http://192.168.0.7:8000/v1"):
        assert hidden(Connection("local", base_url=url, hide=("x/new-unlisted",))) == ["x/new-unlisted"]
