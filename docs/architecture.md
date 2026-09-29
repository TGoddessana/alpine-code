# Architecture

How the repository is split and why. Decisions are dated; change them here when they change.

## Repository

`apps/` holds programs, `packages/` holds what they import. A new platform (Android, iOS, an ACP adapter for editors)
is one more folder under `apps/`.

```
apps/cli ──────→ packages/core
apps/server ───→ packages/core, packages/protocol
apps/desktop ──→ packages/protocol (TypeScript), packages/ui
```

Nothing in `packages/` imports from `apps/`, and apps do not import each other. Python enforces this with
import-linter (`uv run lint-imports`), TypeScript through package dependencies.

Python members form a uv workspace (root `pyproject.toml`); TypeScript members a pnpm workspace
(`pnpm-workspace.yaml`). The Rust crate lives inside the desktop app (`apps/desktop/src-tauri`), as Tauri expects.

## Desktop ↔ core

The desktop app starts `apps/server` as a child process and talks JSON-RPC 2.0 over its stdin/stdout, one JSON object
per line. The CLI needs none of this: it is Python and imports the core directly.

The Rust shell starts and stops the server and relays lines between it and every window without reading them, so the
protocol is implemented once, in TypeScript (`apps/desktop/src/shared/server`).

Every protocol method follows three rules, which keep the door open for a WebSocket transport (mobile, several
clients on one session) without changing the messages:

1. The server owns session state. An app shows what it is sent and asks for a snapshot when it (re)connects.
2. Every session event carries a sequence number, so an app can ask for what it missed.
3. Answers and approvals name the question they answer; the first answer wins.

The protocol is our own, shaped like [ACP](https://agentclientprotocol.com) so an ACP adapter (`apps/acp`) can be thin
later. Its source is pydantic models in `packages/protocol/python`; the JSON Schema and TypeScript types are generated
(`pnpm protocol:generate`) and checked for drift (`pnpm protocol:check`).

## Desktop app

```
apps/desktop/src/
  app/          assembles: entry, providers, routes, the three-column frame
  features/     one folder per part of the screen map (rail, conversation, dock, status-panel, settings...)
  shared/
    server/     connection to the server (real and scripted), session state
    i18n/       dictionaries, language, Intl formatting
    components/ product components more than one feature uses
```

- **Features never import each other.** `app/` puts them side by side. Deleting or rewriting one breaks no other.
- **Session data lives only in `shared/server`**, built from server events. Features read it; their own state is
  screen state (is a menu open).
- **Features map to the design canvas's information architecture**, so a board and its code have the same name.

ESLint (`eslint-plugin-boundaries`) enforces the import rules.

Libraries: React, TanStack Router (typed routes), TanStack Query (request/response data), zustand (session state),
Vite, Vitest, Storybook.

## Design system

Three layers, so the look can change without touching the screens:

| Layer | Where | Changes when |
|---|---|---|
| 1. Tokens | `packages/ui/src/tokens.css` | colours, type or spacing change |
| 2. Primitives | `packages/ui/src/primitives` — Base UI behaviour, token looks | a control's look changes |
| 3. Product components | `apps/desktop/src/features`, `shared/components` | the information architecture changes |

Tokens are named by role (`fg-muted`, `interactive`, `attention`, `danger`), not by colour. Tailwind's default palette
is switched off and ESLint rejects bracketed raw values (`text-[#123]`), so layer 3 cannot use anything but tokens.
`packages/ui` knows no alpine words (session, plan, dock); a component that does belongs to the app.

Storybook shows primitives and screens together. Every story runs against a scripted server
(`parameters.server`), so each board of the design canvas can be reproduced as a story, in Korean and English.

## Language

Korean and English. Each feature has a `messages.ts` with both; Korean is the source and the build fails when
English is missing a key or takes different arguments. Words shared everywhere are in `shared/i18n/common.ts`.
Particles that depend on a name (을/를) use `josa()` from es-hangul; times and numbers use `Intl` (`useFormat`).
The language follows the OS until chosen in Settings.

## Decisions

| Date | Decision | Instead of | Because |
|---|---|---|---|
| 2026-09-29 | `apps/` + `packages/` | per-language roots, one flat folder | platforms are added as apps; libraries and programs never share a level |
| 2026-09-29 | Server as a child process over stdio | a resident local server | no port or token to secure; remote use can add a transport later |
| 2026-09-29 | Own protocol, ACP later as an adapter | ACP as the protocol | rewind, usage, learning and dock rules are outside ACP |
| 2026-09-29 | Protocol source in Python | a neutral schema language | the server side changes it most; the schema is still generated for every language |
| 2026-09-29 | React | Solid | the headless and tooling ecosystem |
| 2026-09-29 | Base UI | React Aria, Radix | active, concise; Radix maintenance has slowed |
| 2026-09-29 | Tailwind v4, tokens only | CSS Modules, StyleX | tokens become the only classes that exist |
| 2026-09-29 | Feature folders + two rules | FSD, by kind | least ceremony that still keeps features apart |
| 2026-09-29 | Per-feature TS dictionaries | i18next, Paraglide | two languages written in-house; copy lives with its feature |

## Open

- **Shipping the server.** A bundled app runs `alpine-server` next to its own binary; building that binary
  (PyInstaller, one-folder) and signing and notarising it on macOS (tauri#11992) is untested.
- **Session protocol.** Only `initialize` exists. Session methods and events come next, with the three rules above.
