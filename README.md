# alpine-code

A coding agent built on [alpineagents](https://tgoddessana.github.io/alpineagents/), with a terminal app and a
desktop app on one agent core. Using the CLI: see [apps/cli](apps/cli/README.md).

## Layout

```
apps/                 what runs — one folder per program
  cli/                terminal app (Python) — published as `alpine-code`, command `alpine`
  server/             runs the core for an app over stdio (Python) — the desktop app starts it
  desktop/            desktop app (Tauri: React screens in src/, Rust shell in src-tauri/)
packages/             what is imported — never runs on its own
  core/               the agent: loop, tools, permissions (Python)
  protocol/           messages between apps and server (Python source → JSON Schema → TypeScript)
  ui/                 design system: tokens and primitives (React)
bench/                benchmarks
docs/                 architecture, research
```

Dependencies point from `apps/` to `packages/`, never back, and apps never import each other.
[docs/architecture.md](docs/architecture.md) explains the layers and why they are this way.

| I want to change… | Go to |
|---|---|
| what the agent does | `packages/core` |
| a message between desktop and server | `packages/protocol/python`, then `pnpm protocol:generate` |
| a desktop screen | `apps/desktop/src/features/<feature>` |
| colours, type, spacing | `packages/ui/src/tokens.css` |
| the terminal UI | `apps/cli` |

## Develop

Needs [uv](https://docs.astral.sh/uv/), Node 24 with pnpm, and Rust (for the desktop app).

```sh
uv sync && pnpm install

# Python: core, cli, server, protocol
uv run pytest
uv run lint-imports        # layer boundaries
uv run ruff check
uv run --env-file .env alpine

# TypeScript: desktop, ui, protocol types
pnpm lint                  # includes layer boundaries and token-only styling
pnpm typecheck
pnpm test
pnpm storybook             # every primitive and screen state, in Korean and English
pnpm desktop               # the desktop app, with the server run from source
pnpm protocol:check        # generated protocol files are up to date
```
