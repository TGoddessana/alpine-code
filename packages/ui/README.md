# @alpine/ui

The design system: what can change when the look changes, and nothing that knows about alpine.

| Layer | Where | Rule |
|---|---|---|
| 1. Tokens | `src/tokens.css` | The only place a raw colour, size or font appears. Named by role (`fg-muted`, `interactive`, `danger`). |
| 2. Primitives | `src/primitives/` | Base UI for behaviour (keys, focus, screen readers), tokens for looks. No alpine words. |
| 3. Product components | `apps/desktop/src/features/*`, `apps/desktop/src/shared/components/` | Compose primitives. Never a raw value: lint rejects `text-[#123]` and Tailwind's default palette does not exist. |

A primitive is added when a second product component needs the same behaviour. Each has a `*.stories.tsx` next to it;
`pnpm storybook` shows them with the app's components.
