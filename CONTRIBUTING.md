# Contributing

alpine-code is the repository behind Alpine: a desktop app on an agent core, built on
[alpineagents](https://tgoddessana.github.io/alpineagents/).

## Layout

```
apps/                 what runs — one folder per program
  server/             runs the core for an app over stdio (Python) — the desktop app starts it
  desktop/            desktop app (Tauri: React screens in src/, Rust shell in src-tauri/)
packages/             what is imported — never runs on its own
  core/               the agent: loop, tools, permissions (Python)
  protocol/           messages between apps and server (Python source → JSON Schema → TypeScript)
  ui/                 design system: tokens and primitives (React)
```

Dependencies point from `apps/` to `packages/`, never back, and apps never import each other.

| I want to change… | Go to |
|---|---|
| what the agent does | `packages/core` |
| a message between desktop and server | `packages/protocol/python`, then `pnpm protocol:generate` |
| a desktop screen | `apps/desktop/src/features/<feature>` |
| colours, type, spacing | `packages/ui/src/tokens.css` |

## Develop

Needs [uv](https://docs.astral.sh/uv/), Node 24 with pnpm, and Rust (for the desktop app).

```sh
uv sync && pnpm install

# Python: core, server, protocol
uv run pytest
uv run lint-imports        # layer boundaries
uv run ruff check

# TypeScript: desktop, ui, protocol types
pnpm lint                  # includes layer boundaries and token-only styling
pnpm typecheck
pnpm test
pnpm storybook             # every primitive and screen state, in Korean and English
pnpm desktop               # the desktop app, with the server run from source
pnpm protocol:check        # generated protocol files are up to date
```

CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs these checks, except Storybook and the app, on every
pull request and every push to main.

## Brand

Brand masters live in `assets/brand/source`. Use `pnpm brand:build` to export icons and wordmarks. See [the brand guide](assets/brand/README.md). The multilingual website is maintained independently in [alpinecode.app](https://github.com/hypercodism/alpinecode.app); it carries its own snapshot of exported brand assets and has no build dependency on this repository.
