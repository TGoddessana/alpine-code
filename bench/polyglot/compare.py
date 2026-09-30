#!/usr/bin/env python3
"""Compare an alpine-code run with the published baselines, paired by instance.

    python3 bench/polyglot/compare.py results/gen0            # against baselines/motif-3.json
    python3 bench/polyglot/compare.py results/gen1 --vs results/gen0 --rows

A run directory holds rows.jsonl (the runner's rows) and optionally rerun.jsonl (rows re-run after an
infrastructure failure, which replace the originals). --vs adds another alpine run as a baseline.
Statistics: Wilson 95% CI per harness, paired bootstrap CI on the difference, McNemar exact p.
"""

from __future__ import annotations

import argparse
import collections
import json
import math
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load_run(path: Path) -> dict[str, dict]:
    rows = {}
    for name in ("rows.jsonl", "rerun.jsonl"):
        f = path / name
        if f.exists():
            for line in f.read_text().splitlines():
                if line.strip():
                    r = json.loads(line)
                    rows[r["instanceId"]] = r
    return rows


def passed(row: dict) -> bool:
    return (row.get("grade") or {}).get("status") == "passed"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return c - h, c + h


def mcnemar_exact(b: int, c: int) -> float:
    n = b + c
    if n == 0:
        return 1.0
    return min(1.0, 2 * sum(math.comb(n, i) for i in range(min(b, c) + 1)) / 2**n)


def boot_ci(diffs: list[int], reps: int = 20000, seed: int = 0) -> tuple[float, float]:
    rng, n = random.Random(seed), len(diffs)
    means = sorted(sum(diffs[rng.randrange(n)] for _ in range(n)) / n for _ in range(reps))
    return means[int(0.025 * reps)], means[int(0.975 * reps) - 1]


def print_usage(usage: list[dict], n: int) -> None:
    """Token totals. The three input counts do not overlap: uncached + cache read + cache write is all input."""
    keys = ("input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "requests")
    total = {k: sum(u[k] for u in usage) for k in keys}
    all_input = total["input_tokens"] + total["cache_read_tokens"] + total["cache_write_tokens"]
    incomplete = sum(not u["complete"] for u in usage)
    print(f"\ntokens ({len(usage)} of {n} rows report usage; {incomplete} were killed mid-step and miss that step)")
    print(f"  input total    {all_input:>14,}")
    for k, label in (
        ("input_tokens", "uncached"),
        ("cache_read_tokens", "cache read"),
        ("cache_write_tokens", "cache write"),
    ):
        share = total[k] / all_input if all_input else 0
        print(f"    {label:12s} {total[k]:>14,}  {share:6.1%}")
    print(f"  output         {total['output_tokens']:>14,}")
    print(f"  requests       {total['requests']:>14,}  ({total['requests'] / len(usage):.1f} per row)")
    costs = [u.get("cost") for u in usage]
    if all(c is not None for c in costs):
        print(f"  cost           {'$' + format(sum(costs), ',.2f'):>14s}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run", type=Path, help="run directory with rows.jsonl")
    ap.add_argument("--baselines", type=Path, default=HERE / "baselines/motif-3.json")
    ap.add_argument("--vs", type=Path, action="append", default=[], help="another alpine run to compare with")
    ap.add_argument("--rows", action="store_true", help="list instances where the run and each baseline disagree")
    args = ap.parse_args()

    run = load_run(args.run)
    published = json.loads(args.baselines.read_text())["rows"]
    base = {h: {i: published[i][h]["passed"] for i in published} for h in next(iter(published.values()))}
    for other in args.vs:
        base[other.name] = {i: passed(r) for i, r in load_run(other).items()}

    ids = sorted(i for i in run if all(i in b for b in base.values()))
    n = len(ids)
    print(f"{args.run.name}: {len(run)} rows, {n} paired with every baseline\n")
    if not n:
        return
    a = {i: passed(run[i]) for i in ids}

    print(f"{'harness':12s} {'pass':>9s} {'rate':>7s}  95% CI")
    for name, results in [(args.run.name, a), *((h, {i: b[i] for i in ids}) for h, b in base.items())]:
        k = sum(results.values())
        lo, hi = wilson(k, n)
        print(f"{name:12s} {k:4d}/{n:<4d} {k / n:6.1%}  ({lo:.1%}-{hi:.1%})")

    print(f"\n{args.run.name} minus baseline, paired")
    for h, b in base.items():
        diffs = [int(a[i]) - int(b[i]) for i in ids]
        only_run, only_base = diffs.count(1), diffs.count(-1)
        lo, hi = boot_ci(diffs)
        print(
            f"  vs {h:10s} {sum(diffs) / n * 100:+6.1f} pp  ({lo * 100:+.1f}, {hi * 100:+.1f})  "
            f"run-only {only_run:3d}  {h}-only {only_base:3d}  McNemar p {mcnemar_exact(only_run, only_base):.3g}"
        )

    print(f"\nper language ({args.run.name} / {' / '.join(base)})")
    by = collections.defaultdict(list)
    for i in ids:
        by[i.split("/")[0]].append(i)
    for lang, li in sorted(by.items()):
        cells = [sum(a[i] for i in li)] + [sum(b[i] for i in li) for b in base.values()]
        print(f"  {lang:11s} n={len(li):3d}  " + "  ".join(f"{c:3d}" for c in cells))

    reasons = collections.Counter(run[i].get("agentEndReason") for i in ids)
    print("\nend reasons:", dict(reasons))
    failed = collections.Counter(run[i].get("agentEndReason") for i in ids if not a[i])
    print("end reasons of failed rows:", dict(failed))

    usage = [run[i]["usage"] for i in ids if "usage" in run[i]]
    if usage:
        print_usage(usage, n)

    if args.rows:
        for h, b in base.items():
            print(f"\ndisagreements with {h}:")
            for i in ids:
                if a[i] != b[i]:
                    print(
                        f"  {i:34s} run {'✓' if a[i] else '✗'}  {h} {'✓' if b[i] else '✗'}  "
                        f"({run[i].get('agentEndReason')})"
                    )


if __name__ == "__main__":
    main()
