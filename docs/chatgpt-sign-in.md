# ChatGPT sign-in

How people use their ChatGPT Plus or Pro plan in alpine-code, through OpenAI's
[Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source) (SIWC) flow for open-source apps.
Designed 2026-09-30; nothing here is implemented yet.

## Why this flow

SIWC's plan usage is open to open-source projects and apps that run on the user's computer. alpine-code is both (MIT),
so it needs no approval. A paid or remotely hosted version must send OpenAI's interest form before offering it.

We do not reuse Codex CLI's OAuth client. SIWC registers a client for alpine-code itself during the first sign-in.

## Accounts are connections

Each signed-in ChatGPT account is one connection:

```toml
[connections.chatgpt]
provider = "chatgpt"

[connections.chatgpt-2]      # a second account or workspace
provider = "chatgpt"
```

The connection list, the default model (`chatgpt/<model>`), the settings screen and `/model` work unchanged, so there
is no separate account switcher. The first sign-in is named `chatgpt`, later ones `chatgpt-2`, `chatgpt-3`..., and can be
renamed. If a sign-in returns an account that already has a connection (same issued `client_id` and ID-token `sub`),
that connection's tokens are replaced instead of adding a new one.

The `chatgpt` provider preset: base URL `https://api.openai.com/v1`, billing `subscription`, API `responses`, auth
`chatgpt` (a new `Provider` field; every other preset is `api_key`).

## Sign-in (core)

Lives in `alpine_core/chatgpt/`. Every step follows
[Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in).

1. **Host ID.** `~/.alpine-code/host_id` holds `urn:uuid:<uuid4>`, created once. The CLI and the app share it (same
   computer, same host). It is an identifier, not a secret.
2. **Listener.** An asyncio HTTP server on `127.0.0.1:1455`, path `/auth/callback`, or an OS-chosen port if 1455 is
   busy (only the port may change). It is cancellable and closes after 10 minutes.
3. **Authorize URL.** `https://auth.openai.com/api/accounts/authorize` with a fresh `state`, `nonce` and PKCE (S256).
   Scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Resource:
   `https://api.openai.com/v1`.
   - New account: `client_id=dynamic_agent_client`, `agent_name_hint=alpine-code`, `ext_agent_host_id`.
   - Signing in again: the saved `client_id`, `id_token_hint`, `login_hint`, and no `agent_name_hint`.
4. **Callback.** Check `state`. `error=access_denied` ends the attempt. A new registration must return an issued
   `client_id` (`oaiapp_...`); a reauthorization that returns a different one is rejected.
5. **Exchange.** POST to `https://auth.openai.com/api/accounts/oauth/token` with the issued `client_id`, `code`,
   `code_verifier`, and the same `redirect_uri` and `resource`. There is no client secret. The response also has
   `earliest_refresh_at`: do not refresh before it.
6. **Validate.** Check the ID token's signature against OpenAI's JWKS, plus its issuer, audience (the issued
   `client_id`), expiry and nonce. This uses `pyjwt[crypto]`, a new core dependency. Without
   `chatgpt.tokens.use.direct` in the granted scopes, the connection is saved with plan usage off (see
   [Declined](#declined-consent)).

## Credentials

`auth.json` (mode 600) keeps one entry per connection. Today an entry holds `{"api_key": ...}`; a ChatGPT connection
holds `{"oauth": {...}}` instead, with the record shape from the SIWC docs: email, issuer, subject, `client_id`,
`id_token`, `access_token`, `refresh_token`, expiry, scopes, `saved_at`.

A new `OAuthTokens` port (`load` / `save` / `clear`) sits next to `Secrets`, and `FileSecrets` implements both. A
keychain implementation later covers both.

- **Refresh.** Tokens refresh five minutes before the access token expires (it lasts one hour), and once after a 401.
  The call is a form POST `grant_type=refresh_token` with the issued `client_id`, `refresh_token` and `resource`.
  The refresh token rotates. If two processes refresh with the same token, OpenAI answers `refresh_token_reused` and
  the sign-in is lost. So a refresh takes an exclusive lock on `auth.json.lock` (`fcntl.flock`) and re-reads the file
  first: if another process already refreshed, it uses that result.
- **Refresh fails for good** (`invalid_grant`, `refresh_token_expired`, `refresh_token_reused`, ...). Clear the tokens but keep
  `client_id`, subject and email. The connection shows "needs sign-in".
- **Network or 5xx.** Keep the tokens and retry later. Never erase credentials over a temporary failure.
- **Sign out.** Revoke the refresh token at the `revocation_endpoint` from
  `https://auth.openai.com/.well-known/openid-configuration`, then clear the tokens. Keep `client_id`, subject, email
  and the host ID for the next sign-in. If revocation cannot be confirmed, say so.
- **Removing a connection** signs out and deletes its config entry.

Tokens never leave the core: not in protocol messages, logs, URLs or session files.

## Model

`ChatGPTModel` subclasses `alpineagents.Model` in the core. It uses the openai SDK's `responses` with
`api_key=<function>`. The SDK calls that function before every request, and it returns a fresh token, refreshing when
needed. `max_retries=0`: retries are ours.

What the plan usage route requires
([Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)):

- `store: false`, `stream: true`, and the whole history in `input` every time (no `previous_response_id`).
- The system prompt goes in `instructions`. The docs say `role: system` items are rejected; the spike saw one
  accepted, but we follow the docs.
- Omit `temperature`, `top_p`, `max_output_tokens`, `metadata`, `truncation`, `user`, `prompt_cache_retention` and the
  other fields listed there. The spike sent `temperature` and got a 400 with `{"detail": "Unsupported parameter: temperature"}`.
- Plain top-level function tools (`{"type": "function", "name", "description", "parameters"}`). The docs ask for
  namespaces; the spike found both forms work, and a namespaced call comes back with `"namespace": "alpine"`. Plain
  tools need no mapping back.
- **Output items come from `response.output_item.done` events.** `response.completed` carries an empty `output`
  (the models are marked `use_responses_lite`). Success still means `response.completed`. A limit error can arrive as
  `response.failed` after streaming started.
- **Reasoning carries across turns.** Send `include: ["reasoning.encrypted_content"]` and put the `reasoning` item
  (with `encrypted_content`) back into `input` on the next request. Drop every item's `id` and `status`, since nothing
  is stored. The spike's model remembered a number it had only reasoned about. Assistant messages carry
  `phase: "final_answer"`.
- `usage` reports `input_tokens_details.cached_tokens` and `cache_write_tokens`. No response header tells how much of
  the plan is left.

**Models.** `GET /v1/models?client_version=1.0.0` with the access token returns `models[]`. Without
`client_version`, or with an older Codex version, the catalog is an old one that lacks newer models (on 2026-10-02 it
had no `gpt-6-sol`, `gpt-6-luna` or `gpt-6.1-sol`), so we send a version above any real Codex release. Keep `visibility == "list"`, show
`display_name`, and send `slug`. Each entry also carries `context_window` (for example 272000), `max_context_window`,
`supported_reasoning_levels`, `default_reasoning_level`, `input_modalities` and `supports_parallel_tool_calls`. The
context window comes from here, so ChatGPT models need no model profile for it. `list_models` gets a branch for
ChatGPT connections.

**Errors.** OpenAI never switches billing on its own, and neither do we.

| Code | What we do |
|---|---|
| `subscription_sharing_usage_limit_exceeded` (429) | stop the run (`run_stopped: limit`), no retry; the app shows the usage limit screen |
| `subscription_sharing_usage_unavailable`, `subscription_sharing_user_unavailable`, admission 503 | bounded retry, then stop with the message |
| `subscription_sharing_user_not_eligible` (403) | stop; explain the plan or workspace cannot use this |
| `subscription_sharing_invalid_user`, admission 401 | refresh once; if it still fails, the connection needs sign-in |
| `subscription_sharing_unsupported_capability` (400) | our bug: stop and show `error.param` |

A pre-stream admission error may be `{"detail": "..."}` instead of an error object; its text is shown, not parsed.

**Later.** The generic part (Responses API, `api_key` as a function) moves into alpineagents as `OpenAIResponses`. The
ChatGPT parts (OAuth, route limits, error codes) stay here.

## Protocol

| Method / event | Params → result | Notes |
|---|---|---|
| `chatgpt/signIn` | `{connection?}` → `{attemptId, url}` | no `connection` means a new account; the server starts the listener and returns the URL |
| `chatgpt/cancelSignIn` | `{attemptId}` → `{}` | closes the listener |
| event `chatgpt/signInFinished` | `{attemptId, result, connection?, email?, planUsage}` | `result`: `connected`, `declined`, `failed`, `cancelled` |
| `chatgpt/signOut` | `{connection}` → `{revoked}` | |
| `ConnectionInfo` | gains `account?: {email, planUsage, needsSignIn}` | |

Waiting for the browser takes seconds to minutes, so this needs the async server from the session protocol.

The app opens `url` with `tauri-plugin-opener`. Its capability must allow `https://auth.openai.com`. The CLI uses
`webbrowser` and also prints the URL, for machines without a browser.

## App

Boards go on the design canvas first. Wording follows OpenAI's
[UI/UX guidelines](https://developers.openai.com/siwc/ui-ux-guidelines).

- **First run and Settings › Model connection.** The ChatGPT row is enabled; its action reads "Continue with ChatGPT".
- **Waiting.** "Finish signing in in your browser", with Open again and Cancel.
- **Welcome, once per connection.** "You're using your ChatGPT plan: AI requests in this app use your ChatGPT plan.
  Manage usage in ChatGPT settings." [Got it]
- **In use.** "Using ChatGPT plan · Manage usage" next to the composer's model selector when the session's model is
  on a ChatGPT connection.
- **Usage limit.** A modal or compact message. The primary action is Manage usage (ChatGPT settings → Usage,
  `https://chatgpt.com/settings/usage`). The secondary action is switching to another connection; we sell no credits.
  The core ends such a run as `run_stopped` with reason `plan_limit` (and an ended sign-in as `signed_out`), so the app
  words it itself.
- **No numbers we do not have.** SIWC reports neither what is left of the plan nor when it resets, so no screen shows
  a ChatGPT percentage or a reset time; only tokens used, plus Manage usage.
- **Declined consent.** "ChatGPT plan use isn't allowed", with [Allow again] (the same `client_id` plus
  `prompt=consent`) and [Connect with an API key].
- **Needs sign-in.** The connection row shows [Sign in again].
- **Connection row.** Email, Manage usage, Sign out.

## CLI

`/login` signs in to a new ChatGPT account or signs in again, and `/logout [connection]` signs out. Both call the same
core functions as the server.

## Order of work

0. Try `worktree-core-async` in the Tauri window, fast-forward main to it, and branch from main.
1. **Spike** (done 2026-09-30, a script, not shipped). A real sign-in, the model list, tool calls, a tool round trip
   and reasoning carried across turns all worked. The findings are folded into [Model](#model) above.
2. **Core** (done 2026-09-30). `alpine_core/chatgpt/`: `oauth.py` (host ID, `SignIn`, refresh, revoke), `tokens.py`
   (`ChatGPTTokens` and the errors `UsageLimitError`, `SignInNeeded`, `PlanUsageOff`), `model.py` (`ChatGPTModel`,
   `fetch_models`) and `connections.py` (`save_account`, `sign_out`). There is also the `chatgpt` preset (`Auth.CHATGPT`,
   `Api.RESPONSES`) and the `OAuthTokens` port on `FileSecrets`. Tests run against a fake authorization server
   (`tests/test_chatgpt.py`). A real sign-in ran the CLI end to end (`alpine-code -p` with a `read` tool call) and a
   forced refresh.
3. **Protocol and server methods** (done 2026-09-30). The methods and the notification in [Protocol](#protocol), in
   `alpine_server/chatgpt.py`. A real sign-in through `alpine-server` over stdio went from `chatgpt/signIn` to
   `connected` to `connections/models`. Still open: a used-up plan reaches the app only as a `failed` run with a
   message. The limit screen needs its own reason, which is a change to the core's session (step 4).
4. **Canvas boards, then the desktop** (done 2026-09-30). Boards FirstRunChatGPT, FirstRunChatGPTDone and
   FirstRunChatGPTDeclined, plus fixes to Connection, Usage and LimitHit (canvas v59). Desktop:
   `shared/components/connect/ChatGPTSignIn.tsx` (waiting, the one-time welcome with a model, declined), `PlanLine`
   near the input, ChatGPT rows in Settings › Model connection, the first run's ChatGPT row, and `useChatGPTSignIn`
   in `shared/server/chatgpt.ts`. The core got `run_stopped` reasons `plan_limit` and `signed_out`; the chat words
   them and links to Manage usage. Checked in Storybook against the scripted server. Not yet: the LimitHit dock's
   choices (the session screen cannot change its model yet), and a run in the real Tauri window.
5. **CLI** (done 2026-09-30). `/login [connection]` and `/logout [connection]` (`alpine_cli/commands.py`).
6. Decision rows in [architecture.md](architecture.md) (done).

## Decisions

| Date | Decision | Instead of | Because |
|---|---|---|---|
| 2026-09-30 | Official SIWC OSS flow | reusing Codex CLI's OAuth client | the approved path for open-source local apps; a borrowed client can be cut off |
| 2026-09-30 | Responses adapter in alpine-code core first | alpineagents first | start now; the generic part moves to alpineagents later |
| 2026-09-30 | One ChatGPT account = one connection | one connection with an account switcher | reuses the connection list, the default model and settings |

## Open

- The LimitHit dock (see the usage limit, API key, another model) once the session screen can change its model.
- Signing in offline: the JWKS fetch and its cache.
