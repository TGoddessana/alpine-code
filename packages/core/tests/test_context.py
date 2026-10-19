import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from alpineagents import Anthropic, OpenAICompatible
from alpineagents.testing import FakeModel

from alpine_core import PROVIDERS, ConfigError, Connection, ModelSettings, Settings, config_file, save_connection
from alpine_core.catalog import catalog_file, price_step
from alpine_core.context import ContextLimits, limits_of, reported_window, save_reported
from alpine_core.models import ANTHROPIC_OUTPUT_LIMIT, list_models, make_model

HAIKU = {
    "limit": {"context": 1_000_000, "output": 128_000},
    "cost": {
        "input": 0.1,
        "output": 0.5,
        "tiers": [{"input": 0.5, "output": 2.5, "tier": {"type": "context", "size": 100_000}}],
    },
}
CATALOG = {
    "anthropic": {
        "models": {
            "claude-haiku-5-5": HAIKU,
            "claude-opus-5-5": {"limit": {"context": 1_000_000, "output": 128_000}, "cost": {"input": 4}},
        }
    },
    "openrouter": {
        "api": "https://openrouter.ai/api/v1",
        "models": {"qwen/qwen3": {"limit": {"context": 262_144, "input": 200_000}}},
    },
}


def write_catalog(catalog=CATALOG):
    catalog_file().parent.mkdir(parents=True, exist_ok=True)
    catalog_file().write_text(json.dumps(catalog))


def test_the_tidy_point_is_near_the_end_of_the_window_or_before_a_price_step():
    assert ContextLimits(1_000_000).tidy_at == 900_000
    assert ContextLimits(200_000).tidy_at == 180_000
    # a reply may take 64K of a 200K window
    assert ContextLimits(200_000, reply=64_000).tidy_at == 136_000
    assert ContextLimits(8192).tidy_at == 4096  # a small local model cannot keep 20K free
    assert ContextLimits(1_000_000, price_step=100_000, reply=64_000).tidy_at == 95_000
    assert ContextLimits(64_000, price_step=200_000).tidy_at == 44_000  # a step past the window does not count
    assert ContextLimits(None).tidy_at is None and ContextLimits(None).fit is None


def test_a_price_step_is_a_context_tier_that_costs_more():
    assert price_step(HAIKU) == 100_000
    flat_tier = {"input": 1, "tiers": [{"input": 1, "tier": {"type": "context", "size": 200_000}}]}
    assert price_step(flat_tier) is None
    over = {"input": 1, "context_over_200k": {"input": 2}}
    assert price_step({"cost": over}) == 200_000
    two = {
        "input": 1,
        "tiers": [
            {"input": 3, "tier": {"type": "context", "size": 128_000}},
            {"input": 2, "tier": {"type": "context", "size": 32_000}},
        ],
    }
    assert price_step({"cost": two}) == 32_000
    assert price_step({"cost": {"input": 1}}) is None and price_step(None) is None


def test_claude_models_get_their_window_and_step_from_the_catalog(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "k")
    write_catalog()
    settings = Settings.load()
    haiku = make_model(settings.with_model("anthropic/claude-haiku-5-5"))
    assert isinstance(haiku, Anthropic) and haiku.context_window == 1_000_000
    assert limits_of(haiku) == ContextLimits(1_000_000, 100_000, ANTHROPIC_OUTPUT_LIMIT)
    assert limits_of(haiku).tidy_at == 95_000
    assert limits_of(make_model(settings.with_model("anthropic/claude-opus-5-5"))).tidy_at == 900_000


def test_the_window_comes_from_the_users_number_then_the_server_then_the_catalog():
    write_catalog()
    save_connection("or", provider="openrouter")
    settings = Settings.load().with_model("or/qwen/qwen3")
    assert limits_of(make_model(settings)).window == 200_000  # the catalog's limit.input

    save_reported("or", {"qwen/qwen3": 131_072, "other": None})
    assert reported_window("or", "qwen/qwen3") == 131_072 and reported_window("or", "other") is None
    model = make_model(settings)
    assert isinstance(model, OpenAICompatible) and model.context_window == 131_072

    text = config_file().read_text() + '\n[connections.or.models."qwen/qwen3"]\ncontext_window = 32768\n'
    config_file().write_text(text)
    assert limits_of(make_model(Settings.load().with_model("or/qwen/qwen3"))).window == 32_768


def test_a_model_nobody_knows_has_an_unknown_window():
    save_connection("local", base_url="https://motif.example.com/v1")
    model = make_model(Settings.load().with_model("local/motif-3"))
    assert limits_of(model) == ContextLimits(None) and limits_of(model).tidy_at is None
    # a model make_model did not make goes by its own number
    assert limits_of(FakeModel([], context_window=1234)).window == 1234


def test_a_one_off_server_takes_its_window_from_the_environment(monkeypatch):
    monkeypatch.setenv("ALPINE_BASE_URL", "http://localhost:8000/v1")
    monkeypatch.setenv("ALPINE_MODEL", "m")
    assert limits_of(make_model(Settings.load())).window is None
    monkeypatch.setenv("ALPINE_CONTEXT_WINDOW", "65536")
    assert limits_of(make_model(Settings.load())).window == 65_536


def test_a_window_is_written_per_model_and_the_single_setting_is_gone(home):
    home.mkdir()
    config_file().write_text(
        '[connections.local]\nbase_url = "http://localhost:1234/v1"\n'
        '[connections.local.models."motif/motif-3"]\ncontext_window = 131072\n'
    )
    local = Settings.load().connections["local"]
    assert local.models == {"motif/motif-3": ModelSettings(context_window=131_072)}

    # reconnecting keeps what was written for its models
    save_connection("local", base_url="http://localhost:1234/v1", model="motif/motif-3")
    assert Settings.load().connections["local"].models["motif/motif-3"].context_window == 131_072

    config_file().write_text("context_window = 128000\n")
    with pytest.raises(ConfigError, match="per model"):
        Settings.load()
    config_file().write_text('[connections.local]\nbase_url = "x"\n[connections.local.models.m]\ncontext_window = 0\n')
    with pytest.raises(ConfigError, match="positive integer"):
        Settings.load()
    config_file().write_text('[connections.local]\nbase_url = "x"\n[connections.local.models.m]\nwindow = 1\n')
    with pytest.raises(ConfigError, match="window"):
        Settings.load()


def serve(routes):
    """A local server answering GET and POST paths from ``routes`` (path -> JSON, or a function of the body)."""

    class Handler(BaseHTTPRequestHandler):
        def answer(self, body):
            route = routes.get(self.path)
            if route is None:
                self.send_response(404)
                self.end_headers()
                return
            data = json.dumps(route(body) if callable(route) else route).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self.answer(None)

        def do_POST(self):
            self.answer(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))

        def log_message(self, *args):
            pass

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


@pytest.fixture
def servers():
    started = []
    yield lambda routes: started.append(serve(routes)) or f"http://127.0.0.1:{started[-1].server_port}/v1"
    for httpd in started:
        httpd.shutdown()


def models(*entries):
    return {"object": "list", "data": [{"object": "model", **e} for e in entries]}


def test_listing_keeps_the_windows_the_server_reports(servers):
    url = servers(
        {
            "/v1/models": models(
                {"id": "router/a", "context_length": 262_144}, {"id": "vllm/b", "max_model_len": 32_768}, {"id": "c"}
            )
        }
    )
    assert list_models(Connection("srv", base_url=url), None) == ["c", "router/a", "vllm/b"]
    assert reported_window("srv", "router/a") == 262_144 and reported_window("srv", "vllm/b") == 32_768
    assert reported_window("srv", "c") is None


def test_lm_studio_reports_the_loaded_window_on_its_own_api(servers):
    native = {
        "models": [
            {"key": "qwen3", "max_context_length": 131_072, "loaded_instances": [{"config": {"context_length": 8192}}]},
            {"key": "gemma", "max_context_length": 32_768, "loaded_instances": []},
        ]
    }
    url = servers({"/v1/models": models({"id": "qwen3"}, {"id": "gemma"}), "/api/v1/models": native})
    list_models(Connection("lms", base_url=url), None)
    assert reported_window("lms", "qwen3") == 8192 and reported_window("lms", "gemma") == 32_768


def test_ollama_reports_windows_on_api_show(servers):
    shown = {
        "qwen3": {"model_info": {"qwen3.context_length": 40_960}},
        "tuned": {
            "parameters": "temperature 0.6\nnum_ctx                        16384",
            "model_info": {"llama.context_length": 131_072},
        },
    }
    url = servers(
        {"/v1/models": models({"id": "qwen3"}, {"id": "tuned"}), "/api/show": lambda body: shown[body["model"]]}
    )
    list_models(Connection("ollama", base_url=url), None)
    assert reported_window("ollama", "qwen3") == 40_960 and reported_window("ollama", "tuned") == 16_384


def test_anthropic_reports_max_input_tokens(servers):
    claude = {"id": "claude-x", "type": "model", "display_name": "X", "created_at": "2026-01-01T00:00:00Z"}
    page = {
        "data": [{**claude, "max_input_tokens": 1_000_000}],
        "has_more": False,
        "first_id": "claude-x",
        "last_id": "claude-x",
    }
    url = servers({"/v1/models?limit=1000": page}).removesuffix("/v1")
    connection = Connection("claude", provider=PROVIDERS["anthropic"], base_url=url)
    assert list_models(connection, "k") == ["claude-x"]
    assert reported_window("claude", "claude-x") == 1_000_000
