"""The macOS sandbox a script runs in: no writes, no network, no other programs, and nothing to read but Python's own
files and the worker. Alpine's permissions check an agent's tool calls only, so the script itself must not be able to
do anything an agent would need approval for (decision 1).

Other systems have no sandbox here yet, so TF is off there."""

from __future__ import annotations

import os
import sys
from pathlib import Path

SANDBOX_EXEC = Path("/usr/bin/sandbox-exec")

WORKER = Path(__file__).with_name("worker.py")

#: System folders Python needs to start (the dynamic linker cache, system libraries, time zones).
_SYSTEM = (
    "/usr/lib",
    "/usr/share",
    "/System",
    "/private/var/db/dyld",
    "/private/var/db/timezone",
    "/dev",
)


def available() -> bool:
    """Whether scripts can run here: macOS with ``sandbox-exec``."""
    return sys.platform == "darwin" and SANDBOX_EXEC.exists()


def profile(python: Path, prefix: Path, worker: Path = WORKER) -> str:
    """The sandbox profile: everything else allowed (memory, threads, pipes), file writes, network, starting a
    program other than ``python`` and reading anything outside Python and the worker denied. File metadata stays
    readable, so whether a path exists is not hidden."""
    readable = " ".join(f"(subpath {_quote(path)})" for path in (*_SYSTEM, str(prefix)))
    return "\n".join(
        [
            "(version 1)",
            "(allow default)",
            "(deny network*)",
            "(deny file-write*)",
            '(allow file-write* (literal "/dev/null"))',
            "(deny process-fork)",
            "(deny process-exec)",
            f"(allow process-exec (literal {_quote(str(python))}))",
            "(deny file-read*)",
            "(allow file-read-metadata)",
            '(allow file-read* (literal "/") (literal "/private") (literal "/private/etc/localtime"))',
            f"(allow file-read* {readable})",
            f"(allow file-read* (literal {_quote(str(worker))}))",
        ]
    )


#: The worker's whole environment: string hashing fixed, so a set iterates the same way every run (decision 8).
ENV = {"PYTHONHASHSEED": "0", "PYTHONIOENCODING": "utf-8"}


def command(worker: Path = WORKER) -> list[str]:
    """The command that runs the worker in the sandbox, with the Python running Alpine: no user site, no
    ``site-packages``, no bytecode written, not even the worker's own folder on the path. Run it with ``ENV``
    as the environment."""
    python = Path(os.path.realpath(sys.executable))
    prefix = Path(os.path.realpath(sys.base_prefix))
    return [str(SANDBOX_EXEC), "-p", profile(python, prefix, worker), str(python), "-s", "-S", "-B", "-P", str(worker)]


def _quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
