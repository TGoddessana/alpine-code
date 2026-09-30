#!/usr/bin/env python3
"""Copy one finished alpine campaign out of the Motifcode kit into results/<name>.

    python3 bench/polyglot/collect.py ~/Developments/Motifcode/packages/eval/polyglot-bench gen1

Writes rows.jsonl and rerun.jsonl (each final row gets a ``usage`` field from the adapter's usage.json: token totals
with input split into uncached / cache read / cache write, and ``complete: false`` for a row killed mid-step),
rerun.txt, campaign.log (alpine lines), manifest.json, failures.tsv (one line per failed row, classified from the
logs) and logs.tar.gz (git-ignored, with each row's per-step usage.json). Run compare.py afterwards for summary.txt.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def with_usage(kit: Path, text: str, skip: set[str] = frozenset()) -> str:
    """Adds ``usage`` (totals, ``complete``, ``steps`` count) from each row's usage.json; the per-step counts stay
    in the logs."""
    lines = []
    for line in text.splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        lang, ex = r["instanceId"].split("/")
        f = kit / f"logs/alpine/alpine--{lang}/{ex}--0--1/usage.json"
        if r["instanceId"] not in skip and f.exists():
            doc = json.loads(f.read_text())
            r["usage"] = {**doc["total"], "complete": doc["complete"], "steps": len(doc["steps"])}
        lines.append(json.dumps(r) + "\n")
    return "".join(lines)


def main() -> None:
    kit, name = Path(sys.argv[1]).expanduser().resolve(), sys.argv[2]
    out = HERE / "results" / name
    out.mkdir(parents=True, exist_ok=True)

    # Grader output quotes toolchain paths under the home directory; keep the username out of the repository.
    home = str(Path.home())
    chunks = sorted((kit / "results/alpine").glob("chunk*.jsonl"))
    rerun_file = kit / "results/alpine/rerun.jsonl"
    rerun_text = rerun_file.read_text() if rerun_file.exists() else ""
    # A row's log directory holds its last attempt, so usage goes on the re-run row when there is one.
    rerun_ids = {json.loads(line)["instanceId"] for line in rerun_text.splitlines() if line.strip()}
    rows_text = "".join(c.read_text() for c in chunks)
    (out / "rows.jsonl").write_text(with_usage(kit, rows_text, skip=rerun_ids).replace(home, "~"))
    if rerun_text:
        (out / "rerun.jsonl").write_text(with_usage(kit, rerun_text).replace(home, "~"))
    for src, dst in (("results/rerun.txt", "rerun.txt"), ("results/campaign.log", "campaign.log")):
        if (kit / src).exists():
            lines = [line for line in (kit / src).read_text().splitlines() if "alpine" in line or "reruns" in line]
            (out / dst).write_text("\n".join(lines) + "\n")
    shutil.copy(kit / "manifests/alpine.json", out / "manifest.json")

    rows = {}
    for f in ("rows.jsonl", "rerun.jsonl"):
        if (out / f).exists():
            for line in (out / f).read_text().splitlines():
                if line.strip():
                    r = json.loads(line)
                    rows[r["instanceId"]] = r
    base = json.loads((HERE / "baselines/motif-3.json").read_text())["rows"]
    table = ["instance\tend_reason\tclass\twall_s\ttool_calls\tpatch_bytes\tmotifcode\topencode\tcodex"]
    for i, r in sorted(rows.items()):
        if (r.get("grade") or {}).get("status") == "passed":
            continue
        lang, ex = i.split("/")
        logs = kit / f"logs/alpine/alpine--{lang}/{ex}--0--1"
        err = (logs / "agent.err").read_text() if (logs / "agent.err").exists() else ""
        answer = (logs / "agent.log").stat().st_size if (logs / "agent.log").exists() else 0
        patch = (logs / "patch.diff").stat().st_size if (logs / "patch.diff").exists() else 0
        reason = r.get("agentEndReason")
        cls = {"wall_timeout": "timeout", "done": "empty_final_reply" if answer == 0 else "wrong_solution"}.get(
            reason, reason
        )
        verdicts = ("pass" if base[i][h]["passed"] else "fail" for h in ("motifcode", "opencode", "codex"))
        table.append(
            "\t".join(map(str, [i, reason, cls, (r.get("wallMs") or 0) // 1000, err.count("◆ "), patch, *verdicts]))
        )
    (out / "failures.tsv").write_text("\n".join(table) + "\n")

    subprocess.run(["tar", "-czf", str(out / "logs.tar.gz"), "-C", str(kit), "logs/alpine"], check=True)
    print(f"{len(rows)} rows, {len(table) - 1} failed -> {out}")


if __name__ == "__main__":
    main()
