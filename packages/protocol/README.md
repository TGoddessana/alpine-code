# protocol

Messages between alpine-code apps and `apps/server`: JSON-RPC 2.0, one JSON object per line, over stdio.

| Folder | What | Edit? |
|---|---|---|
| `python/` | pydantic models — **the source of truth** (`alpine_protocol`) | yes |
| `schema/` | JSON Schema generated from the models: the readable contract | no |
| `typescript/` | TypeScript types generated from the schema (`@alpine/protocol`) | no |

After changing a model, run `pnpm protocol:generate` and commit all three. CI runs `pnpm protocol:check`, which fails
when the generated files are out of date.

Every method follows three rules (see `python/src/alpine_protocol/__init__.py`): the server owns session state,
session events carry a sequence number, and answers name the question they answer.
