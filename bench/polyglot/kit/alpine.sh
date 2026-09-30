#!/bin/bash
# alpine-code (github: tgoddessana/alpine-code) against Motif-3, headless (`alpine -p`) with every call allowed.
HARNESS=alpine
source "$(cd "$(dirname "$0")" && pwd)/common.sh"
ALPINE_REPO="${ALPINE_REPO:-$HOME/Developments/alpine-code}"
# The binary, not `uv run`: uv would put alpine-code's own venv first on PATH, and the agent's `python3 -m pytest`
# must see the same interpreter the grader uses.
export ALPINE_API_KEY="$MOTIF_API_KEY"
# Per-row state, so the REPL history and ripgrep cache of concurrent rows never collide.
export XDG_STATE_HOME="$ROWDIR/xdg/state" XDG_CACHE_HOME="$ROWDIR/xdg/cache" XDG_CONFIG_HOME="$ROWDIR/xdg/config"
mkdir -p "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME"
# The runner passes the endpoint root (https://llm.onerouter.pro); alpine wants the OpenAI-compatible base.
BASE_URL="${ENDPOINT%/}"; case "$BASE_URL" in */v1) ;; *) BASE_URL="$BASE_URL/v1" ;; esac
cd "$CWD" || exit 97
# usage.json: token totals and per-step counts, input split into uncached / cache read / cache write. It is
# rewritten before every model request, so a row killed at the deadline keeps the steps it finished.
run_with_deadline "$ALPINE_REPO/.venv/bin/alpine" -p --yolo -m "$MODEL" --base-url "$BASE_URL" \
  --usage-file "$LOGDIR/usage.json" "$PROMPT" \
  < /dev/null > "$LOGDIR/agent.log" 2> "$LOGDIR/agent.err"
code=$?
reason=done
if [ $code -ne 0 ]; then reason="$(classify_failure)"; fi
write_journal "$reason"
finish "$code" "$reason"
exit $code
