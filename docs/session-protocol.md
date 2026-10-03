# Session protocol v1

How an app creates, runs, watches and resumes sessions, and what the core does underneath. Decided 2026-09-29/30;
implemented in the core, the server and the protocol package. [architecture.md](architecture.md) has the three rules every method follows.

## Scope

v1 covers what the core already does, plus keeping sessions across restarts:

- chat, tool calls, approvals, cancel
- saving every session and resuming it later, from the app or the CLI

Concepts that exist only on the design canvas (questions with a reason, rewind points, assumptions, learning
suggestions) come later, each together with its core feature. The ChatGPT sign-in came with
[chatgpt-sign-in.md](chatgpt-sign-in.md). The plan tools came and were removed again ([session-tools.md](session-tools.md)).

## Conversation shape: items

A conversation is a list of **items**. Events say that an item started, grew, finished or was thrown away. Only
finished items are stored; text deltas are sent live and never saved.

| Item kind | Fields | Shown as |
|---|---|---|
| `user_message` | `text` | the user's bubble |
| `agent_message` | `text` | the agent's prose |
| `tool_call` | `name`, `args`, `status`, `result`, `images` | a tool line or card; `id` is the model's call id; `images` is how many images the tool sent to the model (a count, not the images) |
| `approval` | `callId`, `title`, `preview`, `previewKind`, `reason`, `remember`, `decision`, `feedback` | while active: a card in the chat where the call will be; when finished: nothing of its own, a denied call shows the feedback |
| `notice` | `text`, `source` | a message the **model reads** that the user did not write (e.g. a hand-back after a reply with no tool call) |
| `status_line` | `text` | a line only the user reads (e.g. a model fallback) |
| `compaction` | `beforeTokens`, `afterTokens` | a divider |
| `run_stopped` | `reason`, `message` | why a run ended other than by answering: `interrupted`, `failed`, `limit`, `repeating`, `permission` |

Every item has `id` and `kind`. `tool_call.status` is `running`, then one of alpineagents' outcome kinds: `done`,
`error`, `input_error`, `aborted`, `interrupted`, `denied`, `cancelled`. When the user stops a turn at an approval,
the call they stopped is `denied` and the turn's other calls are `cancelled` (not run), including ones already
approved. The UI tells them apart by `status` alone.

An approval is an item, not a separate message type: it starts when the core asks, stays active while the dock shows
it, and finishes with the user's decision. A pending approval is therefore just an active `approval` item.

Why items and not a replayed event log: opening a session draws a list instead of replaying thousands of deltas;
the app and the CLI get the same items from the core instead of each writing a replayer; an ACP adapter can split
items into chunks later, which is easier than the reverse. Codex app-server and opencode work the same way.

## Methods (app → server)

JSON-RPC 2.0 over stdio, camelCase on the wire.

| Method | Params | Result |
|---|---|---|
| `initialize` | `protocolVersion`, `clientName` | `protocolVersion`, `server` |
| `session/new` | `cwd`, `model?`, `mode?` | `info` |
| `session/list` | — | `sessions`: every session of every project, most recently updated first |
| `session/open` | `sessionId` | a snapshot; loads the session from disk if it is not in memory |
| `session/send` | `sessionId`, `text` | `{}` at once; the run is reported by events. Error if the session is running |
| `session/cancel` | `sessionId` | `{}`; does nothing if idle |
| `session/answer` | `sessionId`, `requestId`, `decision`, `feedback?` | `accepted`: `false` if the approval was already answered |
| `session/setMode` | `sessionId`, `mode` | `info` |
| `session/setModel` | `sessionId`, `model` | `info`. Error if the session is running |
| `session/delete` | `sessionId` | `{}`; a running session is cancelled first |

`decision` is `allow`, `allow_always` or `deny`. `deny` skips the call and the run goes on: with `feedback` the model
is told what to do instead, without it the model is told to carry on without that call. Stopping the run is
`session/cancel`. (The core's `Decision` also has `stop`, a deny that ends the run, for the CLI's Esc; the protocol
does not send it.) There is no "edit and run": alpineagents has no such verdict, and the
model can be told what to run instead.

`session/setModel` switches the model from the next message on, and the conversation goes on: alpineagents 0.5 lets
any model continue a State, and each adapter drops what another provider left (such as hidden reasoning). The session
keeps its id, its items and the profile it started with, so its tools do not change under the conversation; the
default model does not change either. The chat shows no line for the switch; the composer's model chip shows the
model now. A smaller context window is handled by the usual compaction before the next turn.

Errors: `-32001` session not found, `-32002` session is running.

## Events (server → app)

One notification, `session/event`, with `sessionId`, `seq` and `event`. The server sends every session's events to
every window; a window keeps what it shows. (The Rust shell relays lines to all windows unread, so the server cannot
tell windows apart. A subscription filter can be added for remote transports without changing these messages.)

| `event.type` | Fields |
|---|---|
| `info_changed` | `info` (also announces a new session) |
| `deleted` | — |
| `item_started` | `item` |
| `item_delta` | `itemId`, `text` |
| `item_completed` | `item` (the whole item; replaces what the deltas built) |
| `item_discarded` | `itemId`: drop an unfinished item, e.g. a reply whose stream broke and is being asked again |

`seq` counts per session and only grows, across server restarts too.

### Session info

`id`, `title`, `cwd`, `model`, `mode`, `status`, `createdAt`, `updatedAt`, `usage` (`inputTokens`, `outputTokens`,
`cacheReadTokens`, `cacheWriteTokens`, `requests`, `cost`), `contextUsed`, `contextWindow`, `activity`, `runStartedAt`,
`runUsage`.

`cost` is dollars, or `null` when the model has no known price. `contextUsed` is tokens as of the last model call and
`contextWindow` the model's window in tokens (`null` if unknown). While a run goes, `runStartedAt` is its start and
`runUsage` (same shape as `usage`) is what it has used so far; both are `null` when idle. `activity` is `null` when
idle, else `{ kind, toolName, since }` with `kind` one of `thinking` (request sent, no text yet), `writing` (reply text
streaming), `running_tool` (`toolName` is the latest of the calls running together), `waiting_approval` or
`compacting`. `info_changed` is sent when the activity changes and after every model call, not for
every text delta. Context compaction inside a run shows as `thinking`.

`status` is `idle`, `running`, `waiting` (an approval is active: the rail's "my turn") or `failed` (the last run
failed; until the next message). The title is the first user message, shortened; model-written titles come later.

### Snapshot and reconnecting

`session/open` returns `info`, `seq`, `items` (finished) and `active` (unfinished items: a streaming reply, running
tool calls, an active approval).

A window that opens a session keeps the events for it that arrive while the request is in flight, then applies
those with `seq` greater than the snapshot's. If it ever sees a gap in `seq`, it calls `session/open` again. This is
how rule 2 ("ask for what you missed") holds: deltas are not stored, so the snapshot, which includes the text streamed
so far, is what fills the gap.

### Approvals and the first answer

When the core asks, an `approval` item starts (`requestId` is its `id`) and the status becomes `waiting`. The server
waits for `session/answer`; the first answer completes the item and later ones get `accepted: false`. `session/cancel`
while waiting completes it as a stop.

## Core underneath

The protocol is a thin wrapper: the core builds items and numbers them, so the CLI gets the same behaviour.

- **Async first.** `Session.asend` is the real one; `send` wraps it. An `Approver` implements `approve` or
  `aapprove`. Cancel is `task.cancel()` on alpineagents' `arun`. The server runs every session on one asyncio loop.
- **Permissions through alpineagents.** `Agent(permissions=[...])` (alpineagents 0.4) checks every call before
  `use_tools` runs anything, so no loop can skip it. The core's list is `AllowByPolicy` (what the mode and
  remembered answers allow), then `DecideByApprover` (describe the call and ask the approver; a deny with
  `stop` returns `Denied(stop=True)`). Files outside the working directory and secret files are not deny permissions: they still
  ask, because a deny permission can only refuse. The deny slot stays empty until users can write their own rules.
  `allow_always` answers live in `state.root.extra_data["alpine_code.approvals"]`, so they last for the conversation and
  are saved and resumed with it. This is not a sandbox.
- **Items.** The core turns alpineagents' `Reporter` calls into item events and assigns `seq`. A `notice` item comes
  from the core's own `state.add_notice` calls; notices alpineagents adds by itself are not reported yet (the
  `Reporter` has no callback for them).
- **Storage, in two parts.**
  - model memory: alpineagents `Store` (`FileStore`), as is
  - screen record: a new core port, `SessionLog`: `create`, `append` (items in `seq` order, skipping a `seq` already
    stored), `update` (info), `read`, `list`, `delete`. Same contract as `Store` entries, so it can move onto a
    persistence layer in alpineagents later by swapping the implementation.

  `Storage(log, states)` holds both; frontends call `file_storage(...)`, `Session(storage=...)` and
  `Session.resume(storage, id)` and never import alpineagents. The session id is the State id. If the process dies
  between the two writes, the State wins and the item list ends with `run_stopped: interrupted`.
- **Layout on disk.** `sessions/<id>/` is the screen record and `states/<id>/` is the model memory: sibling folders,
  because alpineagents' `FileStore` owns its whole folder. `SessionInfo.last_seq` is kept so `seq` keeps growing
  across restarts.
- **Home folder.** Everything lives in `~/.alpine-code` (`ALPINE_CODE_HOME` overrides; moved there with the
  first run): `config.toml`, `auth.json`, `projects.json`, `AGENTS.md`, `sessions/`, `states/`. One folder for all projects; each session records its `cwd` and the rail
  groups by it.
- **Quitting.** The server is the app's child process, so quitting the app ends running sessions; they reopen ending
  in `run_stopped: interrupted`.

## Model profiles (next, not part of v1 messages)

The harness stays model-agnostic; what changes per model is settings, in `config.toml`:

```toml
[models."motif-3"]
context_window = 131072
max_tokens = 16384
retry_dropped_streams = 3                            # resend when a stream breaks after it started
no_tool_reply = { action = "hand_back", max = 3 }    # default: end the run
stop_if_repeating = 3                                # default: off
```

- Model facts (`context_window`, price) live here: alpineagents keeps no catalog. alpine-code ships profiles for a
  few popular models; users add or override. A model without a profile falls back to alpineagents' defaults (128k
  for OpenAI-compatible), so the app asks for `context_window`: a 32k local model counted as 128k compacts too late.
- `make_model` becomes one call, `resolve_model(settings.model, api_key=..., base_url=..., context_window=...)`.
- Retrying a broken stream is a `Model` that wraps another: resend the whole request (never continue a partial
  reply), not after `AuthError` or `ContextTooLongError`, and report `ModelEvent("retry", ...)` first so the core
  emits `item_discarded`. Until alpineagents confirms its Anthropic adapter wraps mid-stream drops, also catch
  `httpx.TransportError`.
- Hand-back is a loop block calling `state.add_message(Message.notice(...))`, counting in `state.extra_data`; repetition is an extra `until`
  function (`state.stopped == StoppedByUntil("repeating")`).
- The loop is a short list of such blocks, so a behaviour is added or configured without rewriting the loop, and a
  user-supplied loop (later) can reuse them without bypassing permissions.
- `tool_choice: "required"` is out for now: providers disagree (recent Claude models refuse it; Ollama ignores it).
  Reconsider if Motif-3 honours it and hand-backs are not enough.

## Order of work

1. alpineagents: permissions, `ToolOutcomeKind.CANCELLED`, `state.stopped`, `resolve_model(**options)`
2. core: async, permissions, items and `seq`, `SessionLog` and `Session.resume`, home folder
3. protocol: the models above in `packages/protocol/python`, regenerated TypeScript
4. server: session manager, broadcasting, snapshots, first answer wins
5. desktop `shared/server`: request ids prefixed per window (numeric ids from two windows collide, since every
   response reaches every window), session state from snapshots and events, a scripted server for Storybook
