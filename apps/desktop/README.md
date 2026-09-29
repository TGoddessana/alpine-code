# Alpine desktop

The desktop app: React screens in `src/`, a Tauri (Rust) shell in `src-tauri/`. Layers and rules are in
[docs/architecture.md](../../docs/architecture.md).

```sh
pnpm desktop      # from the repo root: the app, with the server run from source through uv
pnpm storybook    # every primitive and screen state
pnpm --filter @alpine/desktop dev   # screens only, in a browser, against a scripted server
```

## Adding a screen part

1. Find its board on the design canvas and the feature it belongs to (`rail`, `conversation`, `dock`,
   `status-panel`, `settings`...). New part of the map → new folder in `src/features/`.
2. Write its copy in the feature's `messages.ts`, Korean first.
3. Build it from `@alpine/ui/primitives` and token classes. Need a control that does not exist yet? Add a primitive
   to `packages/ui` with a story.
4. Read server data through `src/shared/server`; never import another feature.
5. Add a `*.stories.tsx` with the canvas board's state as a `parameters.server` script, and check it in both
   languages.
6. Place it on screen from `src/app` (a route or the three-column frame).

`pnpm lint` catches a feature importing another, and raw colours or sizes instead of tokens.
