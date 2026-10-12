# Living product map

The desktop app's **제품 지도 / Product map** is a view of the product that already exists. A flow is a user or
caller journey. Selecting a feature opens its details; **여기서 확장 / Branch from here** attaches a planned branch
and starts an ordinary coding session. **바꿔줘 / Change it** changes a selected feature, and **동작 확인 / Check
behavior** asks the agent to exercise that feature and connected paths. The conversation, including existing
approval controls and cancellation, opens beside the canvas.

## Try it

```sh
pnpm install --frozen-lockfile
uv sync
pnpm desktop
```

Open a project and choose **제품 지도** underneath its name in the sidebar. **만들어진 기능 찾기** starts a discovery
session using the project's configured agent and model. It inspects actual sources and writes the initial map;
it does not seed an invented product. If the agent needs permission, open **작업 대화** to answer the normal approval.
The canvas supports drag-to-pan, zoom, fit-to-view, collapsed flows, branching, merging, and return paths. A shared
node is the same ID in multiple flows; its state and evidence update everywhere.

For a UI-only preview with **explicitly labeled example data**, without a model or Tauri:

```sh
pnpm --filter @alpine/desktop dev --port 1421
# http://localhost:1421/board?project=%2FUsers%2Fme%2Falpine-code
```

Browser mode uses the existing scripted server. It demonstrates adding branches and opening conversations; it does
not run an AI model or edit a real project. Storybook has ExistingProduct, Empty, SDK, and English states under
**Features / Product map**.

## Project document and agent integration

The server creates `.alpine/product-map.json` and its JSON Schema, `.alpine/product-map.schema.json`. The manifest is
project-owned, readable by the agent's ordinary file tools, and can be versioned with source code. The protocol's
Python models are the schema source of truth. A node has an ID, title, implementation phase, kind, sources, optional
screenshot path or input/output example, associated session, unresolved issue, and check reports. Flows reference
node IDs; edges connect nodes and can label alternate paths. Screens, APIs, SDKs, processes, and data use the same
model. Unassigned nodes remain visible instead of disappearing.

`flow/get` validates the document, loads bounded raster previews inside the project, and checks recorded source
hashes. `flow/prepare` uses a revision to detect stale UI writes, creates branches without discarding surrounding
work, associates the session, and returns the agent's instructions. Invalid manifests are never silently replaced.
The app polls while open, so edits from a session or another tool become visible. The agent is told to re-read before
editing and preserve unrelated IDs. UI prepare writes are serialized within a server process; arbitrary external
file editors are not part of that lock, so simultaneous external writers still need normal file coordination.

Existing projects with a map receive a small core prompt reminder to keep it current during ordinary sessions too.
The map's content is treated as data, not loaded into system instructions. The exact task context remains available
in the conversation behind **작업에 연결된 지도 정보**, while the human request stays readable.

## What a check means

Implementation and verification are separate. Finishing a chat or a successful build never turns a node into
“verified.” An unresolved issue remains visible while a fix runs. Reports include the command, conditions, output,
and outcome provided by the agent. The inspector also shows actual shell tool records from the linked session.
These are agent reports, not an independent proof that every condition works.

`sourceHashes` records SHA-256 of the relevant source and test files at check time. Empty baselines, missing files,
and mismatches flag the report for rechecking. This detects changes in the recorded files, not every possible
transitive dependency, environment change, external service change, or unrecorded file. The agent must identify an
appropriate scope and honestly report blocked checks. A prior failed report remains an issue until the agent
updates the current reports after rechecking; session history keeps earlier executions.

Screenshots are real project-relative PNG/JPEG/WebP files captured by available project/browser tools. Alpine does
not invent screenshots or install a universal browser runner. If the configured agent cannot capture one, the node
shows its description or input/output example. Test execution uses the project's existing commands and permission
policy. No model plan, extra permission bypass, third-party service, or dependency is added by this feature.

## Validation

```sh
pnpm typecheck
pnpm lint
pnpm test
TERM=xterm-256color uv run pytest
uv run ruff check
uv run lint-imports
pnpm --filter @alpine/desktop build
pnpm --filter @alpine/desktop build-storybook
pnpm protocol:check
```

The terminal type on the pytest command is for the existing Rich terminal wrapping test, which also fails on the
unchanged base checkout under `TERM=dumb`. New tests cover graph references, branch/merge/cycle layout, shared
features, source changes, path escapes, corrupt files, stale writes, real server/tool discovery, readable task
context, branch creation, and retrying failed sends without duplicate branches.

## Feature conditions

A feature represents an independently meaningful user/caller outcome. Each node can define `conditions`
with a stable `id` and an `expectation` describing a circumstance and its expected observable result.
The canvas shows passed conditions out of all defined conditions. The inspector lists every condition,
including unchecked, blocked, failed, and needing recheck, with expandable execution evidence.
Use **확인 조건 정리하기** on older features to draft a request for the agent to define conditions.

Checks link via `conditionId` and copy the condition's exact `expectation` at execution time. One current
check is allowed per condition. Missing or changed source baselines, or changed expectation text, require
rechecking and never count as a current pass. Unlinked legacy reports remain visible separately and do
not count toward condition coverage. Existing version 1 maps continue to load without a migration.
Conditions reflect requirements; inferred or uncertain business rules must not be presented as agreed promises.
