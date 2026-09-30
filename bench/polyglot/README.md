# Aider polyglot benchmark

alpine-code on the [Aider polyglot benchmark](https://github.com/Aider-AI/polyglot-benchmark) (213 Exercism
exercises in C++, Go, Java, JavaScript, Python and Rust), run through the kit Motifcode published with its
harness comparison, so every row pairs with the published Motifcode, Codex CLI and OpenCode rows for the same
model, instances, budget and grader.

What was learned about the model and the harness is in [docs/models/motif-3.md](../../docs/models/motif-3.md).

## Results

Motif-3 (`motif/motif-3` via Infron), seed 0, one attempt per instance, 870 s cap.

| harness | passed | rate (95% CI) | alpine minus it, paired | McNemar p |
|---|---|---|---|---|
| Motifcode 0.3.0 | 196 | 92.0% (87.6–95.0) | −11.3 pp (−16.9, −6.1) | < 0.001 |
| OpenCode 1.17.9 | 177 | 83.1% (77.5–87.5) | −2.3 pp (−8.9, +3.8) | 0.56 |
| **alpine-code gen0** (`eb337d3`) | **172** | **80.8%** (74.9–85.5) | — | — |
| Codex CLI 0.154.0 | 170 | 79.8% (73.9–84.7) | +0.9 pp (−4.7, +6.6) | 0.87 |

gen0's 41 failed rows, by how they ended ([`results/gen0/failures.tsv`](results/gen0/failures.tsv)):

| class | rows | what happened |
|---|---|---|
| `timeout` | 31 | hit the 870 s cap; most made 3–8 tool calls and spent the rest inside one model step |
| `repetition_abort` | 5 | the router stopped generation ("Repetition was detected"); alpine exited on the provider error |
| `empty_final_reply` | 4 | the model returned no text and no tool call; alpine took it as the final answer |
| `wrong_solution` | 1 | finished normally, tests failed |

Two further rows ended with `ProviderError: Connection error` mid-stream; both were re-run as infrastructure
failures (as the report does) and passed. Without the re-run gen0 is 171/213.

## Layout

| path | |
|---|---|
| `kit/alpine.sh` | the adapter: the runner's argv/journal contract around `alpine -p --yolo`; writes each row's token usage to `logs/.../usage.json` |
| `kit/motifcode-kit.patch` | changes to Motifcode's kit: `alpine` in the harness lists, pytest venv on `PATH`, provider connection errors classified as transport |
| `kit/install.sh` | applies the patch and copies the adapter into a Motifcode checkout |
| `baselines/motif-3.json` | the published per-instance rows (Motifcode REPORT.md Appendix A, Apache-2.0) |
| `compare.py` | pass rates, paired bootstrap CI and McNemar against the baselines and other alpine runs; token totals with input split into uncached / cache read / cache write |
| `collect.py` | copies a finished campaign out of the kit into `results/<name>/`, adding each row's token totals as `usage` |
| `results/<name>/` | `rows.jsonl`, `rerun.jsonl`, `failures.tsv`, `summary.txt`, `meta.json`, `manifest.json`, `campaign.log`; `logs.tar.gz` is git-ignored |

## Run

Prerequisites are the kit's own ([Motifcode `polyglot-bench/README.md`](https://github.com/TaewoooPark/Motifcode/tree/main/packages/eval/polyglot-bench)):
node ≥ 20, pnpm, git, Go, Rust, JDK 21, a C++ compiler, Boost headers (`brew install go boost`), and pytest.
alpine-code needs its venv (`uv sync`); the adapter runs `.venv/bin/alpine` from `ALPINE_REPO`
(default `~/Developments/alpine-code`), so pointing `ALPINE_REPO` at a worktree benchmarks that variant.

```bash
git clone https://github.com/TaewoooPark/Motifcode ~/Developments/Motifcode
cd ~/Developments/Motifcode && git checkout a5624b0 && pnpm install && pnpm build
~/Developments/alpine-code/bench/polyglot/kit/install.sh ~/Developments/Motifcode

cd packages/eval/polyglot-bench
git clone https://github.com/Aider-AI/polyglot-benchmark && git -C polyglot-benchmark checkout 7e0611e77b54
(cd js-deps && npm install)
uv venv -p 3.13 .venv && uv pip install -p .venv/bin/python pytest

set -a && source ~/Developments/alpine-code/.env && set +a && export MOTIF_API_KEY="$ALPINE_API_KEY"
source env.sh
./verify.sh                    # the same 12 exclusions as the report -> 213 instances
python3 make_manifests.py
python3 make_chunks.py 12
nohup caffeinate -is ./run_pool.sh alpine p1 > results/alpine-pool.log 2>&1 &   # ~9 h at concurrency 3

# afterwards: list infrastructure failures in results/rerun.txt ("alpine <instance> <reason>"), then
./run_rerun.sh alpine
python3 ~/Developments/alpine-code/bench/polyglot/collect.py . gen1
python3 ~/Developments/alpine-code/bench/polyglot/compare.py ~/Developments/alpine-code/bench/polyglot/results/gen1 \
  --vs ~/Developments/alpine-code/bench/polyglot/results/gen0
```

Clear `results/alpine/`, `logs/alpine/` and `chunks/claimed/alpine/` in the kit before starting another campaign.

Token usage is recorded from gen1 on; gen0 has none. `alpine -p --usage-file` rewrites the file before every
model request, so a row killed at the deadline keeps every step but the one in flight (`complete: false`). Infron
reports cache reads (`prompt_tokens_details.cached_tokens`) but not cache writes, so `cache_write_tokens` stays 0 there.

One seed at temperature 1.0 does not resolve differences below about 8 pp; compare variants paired, on the same
instances.
