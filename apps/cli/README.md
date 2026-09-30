# alpine-code (CLI)

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

Or save connections in `~/.alpine-code/config.toml` (the desktop app writes the same file):

```toml
default_model = "anthropic/claude-sonnet-5"   # <connection>/<model>

[connections.anthropic]
provider = "anthropic"          # anthropic, openai, google, openrouter, zai-coding-plan, kimi-for-coding, minimax-coding-plan

[connections.local]
base_url = "http://localhost:11434/v1"
```

A connection's key comes from its provider's variable (`ANTHROPIC_API_KEY`, `ZAI_API_KEY`...) or from
`~/.alpine-code/auth.json`, where the app saves keys (readable only by you). `ALPINE_CODE_HOME` moves the folder.

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
`~/.alpine-code/AGENTS.md`.

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

## Tools

| Tool | Does | Asks first |
|---|---|---|
| `read`, `glob`, `grep` | read a file or list a directory, find files, search contents | never, inside the working directory |
| `write`, `edit` | create or replace a file, replace an exact piece of text | unless *accept edits* or *yolo* |
| `bash` | run a shell command | unless *yolo*, or its commands were allowed before |

Deliberately few. More will come as they prove necessary.

`glob` and `grep` run [ripgrep](https://github.com/BurntSushi/ripgrep), so they respect `.gitignore`. The `rg` on
your `PATH` is used when there is one; otherwise a pinned release is downloaded once (checksum-verified) into
`~/.cache/alpine-code/ripgrep/`.

