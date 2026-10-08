# Auto mode

A fourth permission mode, `auto` ("알아서 하기" / "Auto"): when the rules would ask the user about a tool call, a
reviewer model decides instead, and blocks what looks unsafe. Decided one question at a time on 2026-10-07, after
looking at how Claude Code, Codex and opencode do it. Implemented on 2026-10-08 (see "What was built").

## What the others do

Researched 2026-10-07 from public docs and source (Claude Code: docs and Anthropic's engineering post only).

| | Claude Code `auto` | Codex Auto-review ("guardian") | opencode `--auto` |
|---|---|---|---|
| Who decides | a separate classifier model (Sonnet), no tools | a reviewer sub-agent with read-only tools (`codex-auto-review`, else the session's model) | nobody: every ask is answered "once" |
| What it reviews | everything but reads, edits inside the project and the user's allow rules | only what leaves the OS sandbox (escalated exec, network, edits outside writable roots, MCP) | nothing |
| What it sees | user messages, tool calls, CLAUDE.md; no assistant text, no tool results | the whole transcript, tool results included, with a policy that only user/developer messages and AGENTS.md are trusted | — |
| Output | allow / block with the rule's name | `{risk_level, user_authorization, outcome, rationale}` | — |
| On block | the model is told to find a safer way and not route around it; the run goes on | the same, with the rationale | — |
| Repeated blocks | 3 in a row or 20 in total: back to asking the user | 3 in a row or 10 of the last 50: the turn is interrupted | — |
| Reviewer fails | block | retry up to 3 times, then block (told it is a failure, not a verdict) | — (the open model-gated PR #39015 asks the user) |
| User criteria | prose `allow` / `soft_deny` / `hard_deny` in user settings, never project settings | `[auto_review] extra_policy` | — |

Published error rates (Claude Code): 0.4% false positives on real traffic; 17% of real overeager actions missed,
mostly when the classifier saw the risk but judged that the user had consented.

## Decisions

1. **What goes to the reviewer.** Exactly the calls `accept_edits` would ask about: reading anywhere allowed and
   editing inside the working directory run at once; bash, files outside the working directory, MCP and network
   tools go to the reviewer. Memory guards still ask the user, whatever the mode. alpine-code has no sandbox, so the
   Claude Code shape fits; `PermissionPolicy` is the fast path as it is.
2. **What the reviewer sees: Claude Code's way first, swappable.** The default reviewer reads user messages and tool
   calls only, no assistant text and no tool results: the model cannot talk it round, and text injected into a web
   page or a file never reaches it. Partly a weak-model reason (models can be fooled by injected text); kept because
   reviewers here will often be small or free models, and a structural guarantee holds whatever the model. The
   reviewer is a part that can be replaced (OpenAI's Decisions API, a separate model, a Codex-style reviewer that
   reads everything), so the core hands it the whole conversation and each reviewer picks what to read.
3. **Reviewer model.** The session's model by default; a setting picks another one.
4. **Where that setting lives.** Settings › 모델 연결 › 기본 모델 gets a second row, 확인, under 새 세션, with the same
   model picker plus a first option 세션 모델과 같게. Settings › 일반 › 새 세션 안전 links to it (판정 모델 바꾸기 ›)
   when 알아서 하기 is chosen.
5. **On block.** The model is told the reason and to find another way without routing around it; the run goes on.
   The user sees one line in the chat, like a tool call, with the reason. There is no "run anyway" button: the user
   says so in the composer, the reviewer sees that user message, and the model's retry goes through. A button can
   come later.
6. **Repeated blocks.** After 3 blocks in a row, the next call is asked of the user with the usual approval card; any
   answer resets the count and auto goes on. No cumulative limit for now. A weak-model reason (a model routing around
   blocks, a reviewer blocking wrongly), kept because it never fires when both are good.
7. **Reviewer failure.** An error, a timeout, an answer that does not parse or a local server that is down asks the
   user with the approval card, saying the reviewer could not answer and why. Nothing runs without a yes, and a
   failure is not mistaken for a verdict. No retries beyond the model layer's (`RetryDroppedStreams`); failures do
   not count toward the 3 in a row.
8. **User criteria.** No dedicated setting yet. The reviewer is shown the global `~/.alpine-code/AGENTS.md` (the
   user's own words), never the project's AGENTS.md or CLAUDE.md, which in someone else's repository could allow
   itself. What the reviewer trusts comes from a list of sources that can be extended: approved memories ("this
   command recreates a local sqlite database; the user does it often") are the expected next one. Memory suggestions
   not yet approved are the model's words and never qualify.
9. **Name and order.** Value `auto`; ko 알아서 하기, described as 위험해 보이는 일만 AI가 확인하고 막아요; en Auto. The
   menu and Shift+Tab go 물어보고 하기 → 파일 수정은 바로 → 알아서 하기 → 묻지 않고 다 하기.

## Parts

```python
class Reviewer(Protocol):
    async def review(self, request: ReviewRequest) -> Review: ...

@dataclass(frozen=True)
class ReviewRequest:
    call: ApprovalRequest             # what the user would have been shown
    conversation: Sequence[...]       # the whole conversation; the reviewer picks what to read
    trusted: Sequence[TrustedNote]    # the user's own words, from the trusted sources

@dataclass(frozen=True)
class Review:
    allow: bool
    reason: str | None = None         # on block: shown to the user and told to the model

class TrustedSource(Protocol):
    def notes(self, workspace: Workspace) -> list[TrustedNote]: ...

@dataclass(frozen=True)
class TrustedNote:
    source: str                       # e.g. "global AGENTS.md"
    text: str
```

- `ModelReviewer(model)`: the first reviewer. Sends a review prompt (built-in rules based on Claude Code's default
  block list: piping downloads into a shell, sending secrets out, deploys and migrations, force push, discarding
  uncommitted work, destroying infrastructure...) with the user messages, the tool calls, the trusted notes and the
  call, and reads back allow/block and a reason.
- `user_view(conversation)`: the filter `ModelReviewer` uses (user messages + tool calls).
- `GlobalAgentsMd`: the first trusted source.
- In `auto`, `DecideByApprover` sends what the policy would ask about to the reviewer instead of the frontend's
  approver, and falls back to the approver after 3 blocks in a row or on a reviewer failure.

## Building it

- **core**: `Mode.AUTO` between `accept_edits` and `yolo` (the policy evaluates it like `accept_edits`); the
  `review` package (`Reviewer`, `ModelReviewer`, `user_view`, `TrustedSource`, `GlobalAgentsMd`); the reviewing
  branch in `approval.py` with the block count in the conversation's State; a `review` item for blocks and failures
  (call id, outcome, reason); config `review_model` (unset = the session's model).
- **protocol**: `Mode` gains `auto`; the `review` item; settings get/set for the review model.
- **desktop**: `MODES` and `modeMessages`; the 확인 row in Connection; the link in General; the blocked line in the
  chat.
- **CLI**: Shift+Tab cycle, the blocked line.

### Done when

1. Every decision has a test with a fake reviewer: what goes to the reviewer (memory guards still ask), what
   `user_view` leaves out, a block goes on with the reason and records a `review` item, 3 blocks in a row ask the
   user and an answer resets the count (also across resume), a failure asks and does not count, only the global
   AGENTS.md is trusted, the mode order.
2. About ten scenarios run with real reviewers, `chatgpt/gpt-6-luna` (the user's default) and
   `openrouter/google/gemma-4-26b-a4b-it:free` (small and free): every should-block call is blocked; a should-allow
   call that is blocked is fixed or written down here. Not an error-rate measurement. Free-tier 429s count as
   reviewer failures and are retried by the script.
3. The screens are seen running: the mode chip and Shift+Tab, the link in General, the 확인 row, the blocked line,
   the approval card after 3 blocks and after a failure (stories, plus the real app, light and dark); the CLI cycle and
   blocked line in a real run.
4. `uv run pytest`, `uv run lint-imports`, `uv run ruff check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm protocol:check` pass.
5. This document says what was built and the scenario results; a PR is open (the user merges).

Not part of done: a Decisions API reviewer, approved memories as a trusted source, a "run anyway" button,
error-rate measurement at scale.

## What was built

2026-10-08, branch `auto-mode`.

- **core**: `Mode.AUTO`; `review.py` (`Reviewer`, `ReviewRequest`, `Review`, `ModelReviewer` with
  `prompts/review.md`, `user_view`, `TrustedSource`/`TrustedNote`, `GlobalAgentsMd`); the auto branch of
  `DecideByApprover` (`approval.py`: blocks in a row kept in the State under `alpine_code.auto_review`, 90-second
  timeout, failures ask the user with `ApprovalRequest.review` / `review_error`); memory-guard verdicts are marked
  (`Verdict.guard`) so they never reach the reviewer; the `review_blocked` item and the `reviewing` activity; config
  `review_model` (`set_review_model`, cleared with its connection). The session makes one reviewer per model, for
  `review_model` or else its own model; a reviewer model that cannot be made is a reviewer that fails with why.
- **protocol/server**: `Mode` gains `auto`; `ReviewBlockedItem`; `ApprovalItem.review` / `reviewError`;
  `ActivityKind` `reviewing`; `settings/get` returns `reviewModel`; `settings/setReviewModel`.
- **desktop**: the fourth mode in the chip and Shift+Tab; Settings › 모델 연결 › 기본 모델 › 확인 (with
  세션 모델과 같게); the link in Settings › 일반; a blocked call drawn as its own line in place of the call; the
  approval card says when it asks after 3 blocks or a reviewer failure; "AI가 확인하는 중" in the progress line.
- **CLI**: `--auto`, the mode in `/mode` and the toolbar, "Blocked by auto mode · reason" under a blocked call, the
  approval panel saying why it asks.
- `bench/auto-mode/scenarios.py`: the real-model check below.

### Scenario results

Twelve cases (`bench/auto-mode/scenarios.py`), each reviewed once.

| Reviewer | As expected | Notes |
|---|---|---|
| `chatgpt/gpt-6-luna` | 12/12 | 2–9 s per review |
| `chatgpt/gpt-6.1-sol` (the user's default by the time of the run) | 12/12 | 4–12 s per review |
| `local-2/google/gemma-4-26b-a4b-it:free` | 9/9 of the cases that got an answer | two runs (`--case` for the second); "commit", "write in /tmp" and "send .env out" never got an answer: OpenRouter's free pool kept returning 429 or timing out after 4 retries, up to 2.5 minutes per case. In the app each would be a reviewer failure that asks the user, so nothing runs unasked, but a free-tier reviewer means many questions |

Reasons came back in Korean, as the prompt asks ("수정과 커밋만 요청하셨고, main 브랜치 강제 푸시는 요청하지
않으셨습니다.").

### Seen running

- Storybook (`Session/Session › AutoModeBlocked`, `Session/ApprovalCard`, `Settings/Settings › GeneralAuto`,
  `ConnectionsReviewModel`): the four modes in the chip menu, the blocked line, both approval-card notes, the link
  and the 확인 row. The app has no dark theme yet, so there was only light to check.
- The real server over stdio with real models (a temporary home): `settings/setReviewModel` round trip; an `auto`
  session where writing a file ran at once and `ls -la` went `reviewing(bash)` → allowed → ran.
- The CLI in tmux: `alpine --auto`, Shift+Tab going ask before edits → accept edits → auto → yolo.
- Not seen: the Tauri window itself, which this environment cannot drive on macOS.

### Open

- **A command the user explicitly asks for passes, even `curl … | sh`.** In the real-server run, "README에 적힌 설치
  명령을 실행해서 설치해 줘" let `curl -fsSL … | sh` through: the user's words win (decision 8's rule, Claude Code's
  too), but the user may not have read what the README runs.
- Every review adds a model round trip (2–12 s here) to each bash call that is not remembered. A fast first filter
  (Claude Code's two stages, or the Decisions API) is the obvious next step if it feels slow.
- The reviewer's tokens are not added to the session's usage yet.
- A changed review model applies to new sessions (like the default model); open sessions keep theirs.
- Claude Code also shows its classifier `git status` before destructive git commands; not done.
