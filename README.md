# alpine-code

A terminal coding agent built on [alpineagents](https://tgoddessana.github.io/alpineagents/).
If you use Claude Code, Codex, opencode or pi, you already know how to use it.

```
✻ alpine-code v0.1.0
  model anthropic/claude-sonnet-5
  cwd   ~/projects/my-app

❯ fix the failing test in tests/test_api.py
● read(tests/test_api.py)
  ⎿  Read 84 lines
● bash(uv run pytest tests/test_api.py -x)
  ⎿  FAILED tests/test_api.py::test_create - KeyError: 'id'
```

## Install

```sh
uv tool install alpine-code     # or: pipx install alpine-code
```

## Configure a model

```sh
export ALPINE_MODEL=anthropic/claude-sonnet-5   # uses ANTHROPIC_API_KEY
export ALPINE_MODEL=openai/gpt-5                 # uses OPENAI_API_KEY
export ALPINE_MODEL=ollama/qwen3-coder           # local Ollama

# Any OpenAI-compatible server (OpenRouter, vLLM, LM Studio, ...)
export ALPINE_MODEL=<model> ALPINE_BASE_URL=https://.../v1 ALPINE_API_KEY=...
```

Or put the same settings in `~/.config/alpine-code/config.toml` (`model`, `base_url`, `context_window`, `mode`).
Keep API keys in the environment.

## Use

```sh
alpine                        # interactive
alpine "explain this repo"    # interactive, starting with a message
alpine -p "summarize README"  # print the answer and exit (scripts, CI)
git diff | alpine -p "review this diff"
```

| Key | Action |
|---|---|
| Enter | Send |
| Alt+Enter, Ctrl+J | New line |
| Shift+Tab | Cycle permission mode: ask before edits → accept edits → yolo |
| Ctrl+C | Stop the agent · clear the input · exit (twice) |
| Esc (in a permission prompt) | Decline and stop |
| Ctrl+D | Exit |

Commands: `/help`, `/clear`, `/compact`, `/model [name]`, `/mode [mode]`, `/cost`, `/exit`.

**Project instructions**: `AGENTS.md` files from the git root down to the current directory are added to the
system prompt (`CLAUDE.md` is read where there is no `AGENTS.md`). A global one can go in
`~/.config/alpine-code/AGENTS.md`.

**Permissions**: reading and searching never asks. Editing files asks unless the mode is *accept edits* or *yolo*.
Commands ask unless the mode is *yolo* (`--yolo`). With `-p`, calls that would ask are declined.

## Tools

| Tool | Does | Asks first |
|---|---|---|
| `read`, `ls`, `glob`, `grep` | read files, list directories, find files, search contents (ripgrep when installed) | never |
| `write`, `edit` | create or replace a file, replace an exact piece of text | unless *accept edits* or *yolo* |
| `bash` | run a shell command | unless *yolo* |

Deliberately few. More will come as they prove necessary.

## Architecture

```
src/alpine_code/
  core/            UI-agnostic: agent loop, tools, permissions, prompt, config
    session.py     Session — the one object a frontend drives
    events.py      what the core reports (TurnStarted, TextDelta, ToolFinished, ...)
    approval.py    Approver protocol — how the core asks a frontend for permission
    loop.py        the alpineagents @loop: compact → think → permission gate → use tools
    bridge.py      alpineagents Reporter → core events
    tools/         one module per tool
  cli/             terminal frontend (rich + prompt_toolkit)
```

A frontend gives `Session` two things — an `on_event` callback and an `Approver` — and calls `send(text)`.
It imports only from `alpine_code.core`, never from alpineagents or core submodules. The reverse is enforced:
`core` may not import `cli`, `rich` or `prompt_toolkit` (checked by `lint-imports`). This keeps room for other
frontends (a full-screen TUI, an IDE extension, a web UI) on the same core.

## Develop

```sh
uv sync
uv run pytest
uv run lint-imports   # core/UI boundary
uv run ruff check
uv run --env-file .env alpine
```
