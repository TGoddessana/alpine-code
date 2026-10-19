"""The picker's lists, read once while the app runs and shared with the TF tool's description."""

import threading

from alpine_core import Connection, Settings, picker

from .test_context import serve


def test_missing_lists_are_read_in_the_background_once():
    picker.forget()
    httpd = serve({"/v1/models": {"data": [{"id": "motif/motif-3", "object": "model"}]}})
    try:
        local = Connection(name="local", base_url=f"http://127.0.0.1:{httpd.server_port}/v1")
        down = Connection(name="down", base_url="http://127.0.0.1:9/v1")
        settings = Settings(model="local/motif/motif-3", connections={"local": local, "down": down})
        read = threading.Event()
        assert picker.fetch_missing(settings, read.set)
        assert read.wait(10)
        assert picker.listed(local) == ["motif/motif-3"]
        assert picker.shown(local, ["motif/motif-3"], {}) == ["motif/motif-3"]  # a local server shows all it lists
        for _ in range(100):  # the unreachable one is left alone for a while
            if not picker._reading:
                break
            threading.Event().wait(0.05)
        assert picker.listed(down) is None
        assert not picker.fetch_missing(settings)
    finally:
        httpd.shutdown()
        picker.forget()
