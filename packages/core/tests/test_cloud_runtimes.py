"""Finding and installing Node.js, with fake executables and a fake download (nothing is downloaded for real)."""

import hashlib
import io
import os
import shutil
import tarfile
import tempfile
import zipfile
from pathlib import Path

import pytest

from alpine_core.cloud import runtimes
from alpine_core.cloud.runtimes import NodeInstallError


def fake_node(folder: Path, version: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    node = folder / "node"
    node.write_text(f"#!/bin/sh\necho v{version}\n")
    node.chmod(0o755)
    return node


@pytest.fixture(autouse=True)
def only_the_fake_places(monkeypatch, tmp_path):
    """The computer's own Homebrew, nvm... are not looked at, and ``PATH`` is the test's."""
    monkeypatch.setattr(runtimes, "_extra_bins", lambda: [])
    monkeypatch.setenv("PATH", str(tmp_path / "empty"))


def test_a_node_on_path_that_is_new_enough_is_found(tmp_path):
    fake_node(tmp_path / "old", "20.11.0")
    fake_node(tmp_path / "new", "22.12.0")
    path = os.pathsep.join([str(tmp_path / "old"), str(tmp_path / "new")])
    found = runtimes.find_node(path)
    assert found.path == tmp_path / "new" / "node" and found.version == (22, 12, 0) and not found.alpine_managed
    assert runtimes.status(path) == runtimes.NodeStatus(True, "22.12.0", "22.12", False)


def test_without_a_usable_node_nothing_is_found(tmp_path):
    fake_node(tmp_path / "old", "22.11.9")
    assert runtimes.find_node(str(tmp_path / "old")) is None
    assert runtimes.status(str(tmp_path / "old")) == runtimes.NodeStatus(False, None, "22.12", False)


def test_the_places_a_gui_apps_path_misses_are_searched_and_put_on_path(tmp_path, monkeypatch):
    brew = tmp_path / "opt-homebrew-bin"
    fake_node(brew, "24.1.0")
    monkeypatch.setattr(runtimes, "_extra_bins", lambda: [brew])
    monkeypatch.setenv("PATH", "/usr/bin")
    assert runtimes.find_node().path == brew / "node"
    assert runtimes.use_node().bin == brew
    assert os.environ["PATH"].split(os.pathsep)[0] == str(brew)


def test_alpines_own_copy_is_the_last_resort_and_leads_path_only_then(tmp_path, monkeypatch):
    own = runtimes.runtime_dir() / "bin"
    fake_node(own, "22.14.0")
    monkeypatch.setenv("PATH", "/usr/bin")
    found = runtimes.use_node()
    assert found.alpine_managed and os.environ["PATH"].split(os.pathsep)[0] == str(own)
    assert runtimes.status().alpine_managed is True

    # A system Node that appears later takes over by itself, and Alpine's bin leaves PATH.
    system = tmp_path / "usr-local-bin"
    fake_node(system, "22.12.1")
    monkeypatch.setenv("PATH", os.pathsep.join([str(own), str(system), "/usr/bin"]))
    chosen = runtimes.use_node()
    assert chosen.path == system / "node" and not chosen.alpine_managed
    assert str(own) not in os.environ["PATH"].split(os.pathsep)


# ---------------------------------------------------------------- installing


def release(tmp_path, version="22.14.0", *, content=None, sums_hash=None, evil=False):
    """A fake nodejs.org folder: the tarball and its SHASUMS256.txt. Returns the fetch function."""
    target = runtimes._target()
    name = f"node-v{version}-{target}"
    archive = tmp_path / "dist" / f"{name}.tar.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    script = content or f"#!/bin/sh\necho v{version}\n"
    with tarfile.open(archive, "w:gz") as tar:
        info = tarfile.TarInfo(f"{name}/bin/node")
        data = script.encode()
        info.size, info.mode = len(data), 0o755
        tar.addfile(info, io.BytesIO(data))
        if evil:
            bad = tarfile.TarInfo("../outside.txt")
            bad.size = 1
            tar.addfile(bad, io.BytesIO(b"x"))
    digest = sums_hash or hashlib.sha256(archive.read_bytes()).hexdigest()
    sums = tmp_path / "dist" / "SHASUMS256.txt"
    sums.write_text(f"{'0' * 64}  node-v{version}-win-x64.zip\n{digest}  {archive.name}\n")
    fetched: list[str] = []

    def fetch(url, progress=None):
        fetched.append(url)
        source = tmp_path / "dist" / url.rsplit("/", 1)[-1]
        if not source.exists():
            raise OSError("404")
        folder = Path(tempfile.mkdtemp(prefix="fake-download-"))
        shutil.copy(source, folder / source.name)
        if progress:
            progress(1.0)
        return folder / source.name

    fetch.urls = fetched
    return fetch


def test_install_downloads_checks_and_unpacks_into_alpines_folder(tmp_path):
    fetch = release(tmp_path)
    progress = []
    node = runtimes.install(progress.append, fetch=fetch, dist_url="https://nodejs.test/dist/latest-v22.x")
    assert node.alpine_managed and node.version == (22, 14, 0) and node.path == runtimes.runtime_dir() / "bin" / "node"
    assert fetch.urls[0].endswith("/latest-v22.x/SHASUMS256.txt") and fetch.urls[1].endswith(".tar.gz")
    assert progress == [1.0]
    assert runtimes.find_node("").alpine_managed
    # Installing again replaces the copy, leaving no half-written folder or staging folder behind.
    runtimes.install(fetch=release(tmp_path, "22.15.0"), dist_url="https://nodejs.test/dist/latest-v22.x")
    assert runtimes.find_node("").version == (22, 15, 0)
    assert sorted(p.name for p in runtimes.runtime_dir().parent.iterdir()) == ["node"]


def test_a_checksum_that_does_not_match_installs_nothing(tmp_path):
    fetch = release(tmp_path, sums_hash="f" * 64)
    with pytest.raises(NodeInstallError) as e:
        runtimes.install(fetch=fetch, dist_url="https://nodejs.test/dist")
    assert e.value.kind == "checksum"
    assert not runtimes.runtime_dir().exists()


def test_a_failed_download_is_reported_as_one(tmp_path):
    def fetch(url, progress=None):
        raise OSError("offline")

    with pytest.raises(NodeInstallError) as e:
        runtimes.install(fetch=fetch, dist_url="https://nodejs.test/dist")
    assert e.value.kind == "download"


def test_an_archive_that_reaches_outside_its_folder_is_refused(tmp_path):
    fetch = release(tmp_path, evil=True)
    with pytest.raises(NodeInstallError) as e:
        runtimes.install(fetch=fetch, dist_url="https://nodejs.test/dist")
    assert e.value.kind == "unpack"
    assert not (tmp_path / "outside.txt").exists() and not runtimes.runtime_dir().exists()


def test_an_installed_node_that_does_not_run_is_an_error(tmp_path):
    fetch = release(tmp_path, content="#!/bin/sh\nexit 1\n")
    with pytest.raises(NodeInstallError) as e:
        runtimes.install(fetch=fetch, dist_url="https://nodejs.test/dist")
    assert e.value.kind == "unpack"


def test_on_windows_the_zip_is_installed_with_node_exe_at_the_top(tmp_path, monkeypatch):
    monkeypatch.setattr(runtimes.sys, "platform", "win32")
    monkeypatch.setattr(runtimes.platform, "machine", lambda: "AMD64")
    monkeypatch.setattr(runtimes, "WINDOWS", True)
    monkeypatch.setattr(runtimes, "NODE_EXE", "node.exe")
    # node.exe cannot run here, so its "version" is read from the fake file.
    monkeypatch.setattr(runtimes, "node_version", lambda exe: (22, 14, 0) if Path(exe).is_file() else None)
    name = "node-v22.14.0-win-x64"
    archive = tmp_path / "dist" / f"{name}.zip"
    archive.parent.mkdir(parents=True)
    with zipfile.ZipFile(archive, "w") as zf:
        zf.writestr(f"{name}/node.exe", "fake")
        zf.writestr(f"{name}/npm.cmd", "fake")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (tmp_path / "dist" / "SHASUMS256.txt").write_text(
        f"{'0' * 64}  node-v22.14.0-darwin-arm64.tar.gz\n{digest}  {archive.name}\n"
    )

    def fetch(url, progress=None):
        folder = Path(tempfile.mkdtemp(prefix="fake-download-"))
        return Path(shutil.copy(tmp_path / "dist" / url.rsplit("/", 1)[-1], folder))

    node = runtimes.install(fetch=fetch, dist_url="https://nodejs.test/dist")
    assert node.path == runtimes.runtime_dir() / "node.exe" and node.alpine_managed
    assert (runtimes.runtime_dir() / "npm.cmd").is_file()
