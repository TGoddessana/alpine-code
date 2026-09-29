# alpine-code

A terminal coding agent built on [alpineagents](https://tgoddessana.github.io/alpineagents/).
If you use Claude Code, Codex, opencode or pi, you already know how to use it.

```
  ▀▀   ▀▀    alpine-code v0.1.0
  ██   ██    model anthropic/claude-sonnet-5
▄█████████▄  cwd   ~/projects/my-app
███▀█▀█▀███  /help for commands · ctrl+d to exit
 ▀▀█████▀▀

› fix the failing test in tests/test_api.py
◆ read(tests/test_api.py)
  └  Read 84 lines
◆ bash(uv run pytest tests/test_api.py -x)
  └  FAILED tests/test_api.py::test_create - KeyError: 'id'
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

**Permissions** (every rule is skipped in *yolo*):

- Reading and searching inside the working directory never asks. Paths outside it (symlinks resolved) ask, and so
  does reading `.env` / `.env.*` files (`.env.example` is fine).
- Editing asks unless the mode is *accept edits*.
- `bash` asks. "Don't ask again" remembers command prefixes for the session — `git status`, `uv run pytest`,
  `npm run dev` — parsed with tree-sitter, so `git status; rm -rf x` or `git status $(curl …)` still ask, as do
  commands that write files through `>`. Commands that can run anything (`python`, `sudo`, `bash -c`, `xargs`, …)
  are never remembered.
- `bash` also checks the paths it names — arguments, `--flag=/path` values and redirection targets, following
  `cd` — with the same rules as the file tools. Paths known only at run time (`$HOME/.ssh`, `cd "$(…)"`) ask every
  time. Remembering an outside directory for `bash` means edit access to it, so that is only offered under your
  home directory or a temp directory; system directories, your home directory itself and `/` always ask.
- With `-p`, calls that would ask are declined.

