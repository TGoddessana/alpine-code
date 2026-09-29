import hashlib
import io
import tarfile

import pytest

from alpine_core.tools import ripgrep


def tarball(name: str, content: bytes) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as t:
        info = tarfile.TarInfo(name)
        info.size = len(content)
        t.addfile(info, io.BytesIO(content))
    return buf.getvalue()


def test_extract_checks_the_checksum():
    archive = tarball("ripgrep-x/rg", b"binary")
    assert ripgrep.extract(archive, hashlib.sha256(archive).hexdigest(), "rg") == b"binary"
    with pytest.raises(ripgrep.RipgrepUnavailable, match="checksum"):
        ripgrep.extract(archive, "0" * 64, "rg")


def test_every_platform_has_a_pinned_checksum():
    for target, sha256 in ripgrep._ASSETS.values():
        assert len(sha256) == 64 and target.startswith(("aarch64", "x86_64"))


def test_asset_is_the_release_file_name(monkeypatch):
    monkeypatch.setattr(ripgrep.platform, "system", lambda: "Linux")
    monkeypatch.setattr(ripgrep.platform, "machine", lambda: "x86_64")
    name, _ = ripgrep.asset()
    assert name == f"ripgrep-{ripgrep.VERSION}-x86_64-unknown-linux-musl.tar.gz"


def test_system_rg_is_preferred(monkeypatch, tmp_path):
    monkeypatch.setattr(ripgrep.shutil, "which", lambda name: "/usr/bin/rg")
    assert ripgrep.rg_path() == "/usr/bin/rg"


def test_cached_rg_is_used_without_download(monkeypatch, tmp_path):
    monkeypatch.setattr(ripgrep.shutil, "which", lambda name: None)
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    cached = ripgrep.cache_dir() / "rg"
    cached.parent.mkdir(parents=True)
    cached.write_bytes(b"")
    monkeypatch.setattr(ripgrep, "_download", lambda *a: pytest.fail("should not download"))
    assert ripgrep.rg_path() == str(cached)
