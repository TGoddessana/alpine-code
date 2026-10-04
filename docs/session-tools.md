# Session tools

The tools that let the model fill the session's right panel (plan, verification, changes, out of the ordinary) and
talk to the user mid-run (questions, review), and what the harness observes on its own. Decided one question at a
time on 2026-10-02.

Removed (2026-10-03): the plan tool (`update_plan`) and the check tool (`check`) were implemented end to end on
2026-10-02 and removed the next day, with the plan and verification parts of the right panel (see Decisions). Their
sections below stay as the record of what was built. Panel content written by model tools is to be designed again
as something users can build for their own tools. Nothing else here is implemented yet.

The rules behind every decision:

- The model writes only what only it knows (its intent, its questions). Everything that can be observed (what ran,
  what changed) is filled by the harness, so the panel shows facts. When the model does judge something, the panel
  says it is the agent's claim and shows its evidence.
- Every tool call shows in the chat through the same interface as any other: counted in the collapsed line, one
  `name(target)` row with a result line when opened. No tool is hidden because its effect shows elsewhere.
- Design for a model far smarter than today's. The harness does not second-guess the model's process (when to stop
  trying, when to ask); it keeps what the user needs whatever the model's skill: facts told apart from claims, and
  guards against mechanical breakdowns (the same call repeated). Decisions whose reason was a weak model are marked
  so they can be revisited.

| Panel part | Written by |
|---|---|
| Plan | the model, through the plan tool |
| Verification | which checks: the model, in the plan tool; whether each passed: the harness, the agent (with evidence) or the user, as the check says |
| Changes | the harness |
| Out of the ordinary | the harness (what it observes) and the model (`flag`: assumptions, risks) |

## Plan tool

### What it holds

Steps and checks, in one tool. A check says what will be verified (`label`), how (`how`, free text: a command, a
screenshot from an emulator or a browser, a rerun compared with the last one...), and who judges it (`judge`). The
methods are open-ended; the judges are three:

| `judge` | Passed when | Shown as |
|---|---|---|
| `harness` | the harness sees it: for now a `command` that exits 0 (later e.g. values equal to the last run) | a fact |
| `agent` | the model says so through the check tool, citing evidence: tool calls of this session (e.g. three screenshots) | "the agent's judgement", evidence one click away |
| `user` | the user marks it checked in the review dock, next to the evidence the model gathered | the user's check |

```json
{
  "steps": [
    {"text": "Add the sale badge to the product card", "status": "done"},
    {"text": "Check the card on three screen sizes", "status": "now"}
  ],
  "checks": [
    {"label": "type check", "judge": "harness", "command": "pnpm tsc --noEmit"},
    {"label": "screen · badge clear of the price", "judge": "agent", "how": "mobile, tablet, desktop screenshots"},
    {"label": "check by hand", "judge": "user", "how": "before/after screenshots"}
  ]
}
```

A check with no result yet is "not run". Why not a separate checks tool: the model forgets one of two tools, and plan
and checks are decided at the same moment. Why not let the harness guess checks from commands: a check that never ran
could not be shown as "not run", and checks by eye cannot be guessed. Why three judges and not just harness and
user: with no tests (screens, notebooks), every check would land on the user, including ones a non-developer cannot
judge (is this correlation or cause?). Claude Code, Codex, Cursor and Cline keep verification as a plan step the
model ticks itself, so a claim looks the same as a fact.

### Updating it

Every call sends the whole list of steps; `checks` is sent only when it changes (left out = unchanged). The harness
keeps a step's identity across calls by matching it to the previous list: same text = same step, otherwise the step
in the same position. Claude Code (`TodoWrite`), Codex (`update_plan`), Gemini CLI (`write_todos`) and opencode
(`todowrite`) also replace the whole list. Ids (Cursor's `todo_write` merge) were rejected because local and
coding-plan models get ids wrong, and each wrong id costs a retry (a weak-model reason, but the whole list is also
what Claude Code and Codex use with strong models); the whole list costs about 100–150 output tokens
for six steps.

### Step states

The model picks one of three: `todo` (○), `now` (●), `done` (✓). At most one step is `now`; more is an input error
the model fixes. The word next to ● (working, question, review, paused...) is not the model's: the harness takes it
from the session's state, so the plan's word always matches the dock's.

A step that disappears from the list (and is not matched to a new one by text or position) leaves the plan and
shows in out of the ordinary as "step dropped from the plan · <text>". Other apps let it vanish; here an agent that
quietly skips a hard step must be visible. A "dropped" mark in the plan was rejected: it would be a fourth status
shape.

### Where it shows

The plan lives in the session's info (`SessionInfo.plan`), with the harness's check results and dropped steps
worked in, so the app draws the right panel from it and a reopened session shows it as it was. The CLI prints it as
a checklist in the conversation, like Claude Code.

In the app's chat the call is a tool call like any other. The collapsed line counts it ("파일 3개 읽음 · 계획 1번
고침 ›"); opened, its row is `계획` and its result line says only what changed, not the whole list (the right panel
has that): "5단계 세움 · 확인 3개" the first time, then "'원인 찾기' 끝냄 · '고치기' 시작", "'재현 테스트 먼저' 뺌".
Clicking the result line opens the plan tab without changing the panel's width.

## Check tool

The model runs or records a check by its label.

- `judge: harness`: `check("type check")` makes the harness run the declared command as written, under the same
  approval rules as `bash`. A `bash` call with exactly the same command counts too, so a model that uses `bash`
  is not penalised. Prefix matching was rejected: `pnpm -F web test src/one.test.ts` would pass as the whole suite.
  To run something else, the model changes the check in the plan first, which the plan shows.
- `judge: agent`: `check("screen · …", passed, evidence=[call ids], note)`. Evidence is required and must name tool
  calls of this session; without it the call is an input error.
- `judge: user`: not through the tool; the review dock asks the user.

A check that passed goes back to ○ "changed since it passed" when files change after it; the review dock then stops
recommending the commit. In the chat a check is a tool row like any other: `확인(type check)` → "통과" or the first
lines of the output; for an agent check, "에이전트 판단 · 통과 · 근거 3".

### Repeated failures

The harness never stops a run because a check keeps failing; the model decides when to change approach or ask (the
canvas's Task4Failed dock becomes a question the model asks: try another way / skip and review / I'll look).
Claude Code and Codex have no such rule either; Cline counts only malformed tool calls, opencode only identical
repeated calls. The existing stop for the same call repeated stays: it catches a mechanical loop, not a judgement.

## Ask tool

### Waiting for the answer

The ask tool waits: the call ends when the user answers, and the answer is its result, the same way approvals work
(Claude Code's `AskUserQuestion`, Cline's `ask_followup_question` and Codex's plan-mode questions also wait). A
question is its own item linked to the call id, like an approval, so a later "keep working while asking" option
(the canvas's QSingle board) changes only when the tool returns, not the item or the protocol. Not now, because a
model that keeps working may do the work that depends on the answer, and an answer injected as a notice is easier
to miss than a tool result. Both are weak-model reasons: this is the first option to turn on as models improve.

### Questions per call

Up to four questions per call (as Claude Code's `AskUserQuestion`). The dock still shows one at a time with `1/4`
in its header and a way back to the previous one; all answers go back to the model together. Questions whose wording
depends on an earlier answer are asked in a later call (the tool's description says so). One question per call was
rejected: between questions the user waits while the model thinks again (usually 5–20 s), and a user who stepped away
would come back to each question at a different time.

### A question

Each question has the question, a `reason` (the dock's "why I'm asking"), and a kind:

| Kind | Options | In the dock |
|---|---|---|
| `single` | 2–4, each with a one-line trade-off; exactly one recommended, preselected | the option list; Enter confirms |
| `multiple` | 2–4, each with a one-line trade-off; zero or more recommended, preselected | the same list; chosen rows get the blue selection background (no checkbox, so no new shape); "확정" confirms |
| `text` | none; the model may give a one-line example | the question and its reason; the composer answers, the example is its placeholder |

Whatever the kind, an answer can always be written in the composer instead.

A question always waits for its answer: there is no timeout that picks the recommendation, so unanswered questions
make no assumptions (Claude Code, Codex and Cline also wait). Options carry no "irreversible" mark either: its only
job was to stop a timeout, and actions that cannot be undone still go through an approval card. The canvas boards
that show a timeout, "기다려 줘" or timeout assumptions (QSingle, QAfter, stickyQRule, stickyQVs) are to be updated.

### Answering

Three ways, from the canvas: pick, pick and add a note to the picked row, or write in the composer. While a question
is in the dock, text sent from the composer answers the question shown (the same place where, at an approval, it
means "skip this and do this instead"). A reply that is itself a question ("what does this mean?") goes back as the
answer; the tool's description tells the model to explain and ask again. The harness does not try to tell questions
from answers.

In the chat the call is a tool call like any other: counted as "질문 n개" in the collapsed line; opened, its row is
`질문(<question>)` with the answer on the result line ("조합 확정만 · 덧붙임 “…”"). It is a tool row, not a bubble, so
the canvas rule "no 선택 bubble after answering" still holds.

### Option previews

An option may carry a preview, drawn side by side in the dock (the canvas's QPreview): Markdown (code blocks
included, through the app's Markdown component) or HTML. HTML is shown in a sandboxed iframe (`srcdoc`, no
`allow-scripts`, no network, no forms), so it can draw a mock-up of a screen but not run anything. Markdown alone was
rejected because this app's users mostly build screens, and a question like "which button style?" needs a picture.
Screenshots of the real app come with checking by hand (dev servers and screenshots), not with questions.

### Pointing at the work

A question may carry `points_to` (a file and a line range), as on the canvas's QContent board. When the question
arrives, the right panel switches to the changes tab at those lines on its own (its width never changes); a file
the session changed shows as a diff, any other file as plain content, in the same place. A comment on those lines
answers the question like text from the composer, with the place attached ("49–53행에 대해: …"). A link in the dock
only was rejected: users who rarely look right would answer without seeing the lines.

## Review and done

The harness opens the review dock, not the model: whenever a run ends and the session has changed files. A run that
changed nothing (an answer to a question) opens no dock. The dock's evidence line is the harness's facts (files,
check results, "tests · api not run"); "approve and commit" is recommended only when every check passed. Approving
makes the harness commit: the model writes the message in one tool-less call, the dock shows it and it can be
edited, and no approval card follows (the user just approved). Suggestions such as "add a concurrent-write test"
stay in the model's last reply; the user asks for them in the composer. Codex's app (diff with commit and PR buttons
after a turn) and Cursor (Keep / Undo) also leave this to the harness. A `request_review` tool was rejected: a model
that forgets to call it leaves changes unreviewed.

After the commit the dock turns into the done summary (canvas Task6Done): the commit, and undo this commit · create
a PR · open in the editor.

## Snapshots

The changes part and rewind points rest on snapshots of the project folder, kept in a hidden git repository of the
app's own (`~/.alpine-code/`, one per project; `--git-dir` there, `--work-tree` the project), as Cline does. A
snapshot is taken at each user message (a rewind point) and around each tool call (so the harness knows which call
changed which file, and that a change came from outside any tool). It follows the project's `.gitignore`, or a
default exclude list (`node_modules`, build output...) without one, and has a size cap for huge data files. Only
changed files are stored again, so snapshots after the first are quick.

Why not record only what the edit tools change (Claude Code's and Cursor's checkpoints): changes made through `bash`
(sed, code generators, `npm install`, formatters) would be missed, and smarter models use `bash` for such work more,
not less. Why not hidden commits in the user's own git (Codex's undo, Aider's auto-commits): projects without git
(notebooks) would have no rewind, and the canvas rule is that the user's git is never touched.

### Changes and rewind

The changes part counts what this session changed (its tab number too). The diff header picks the baseline: this
session · since <time> (each user message) · against main (only with git). Clicking the composer's git numbers
(`+188 −42`, which are against the branch's base) opens the tab against main.

Rewind follows the canvas: pick files, code only / conversation only / both, the user's git untouched, a rewind can
itself be rewound. Calls that reached outside the folder (the tool's `open_world` hint) cannot be undone by a
snapshot; the rewind preview lists them first.

## Out of the ordinary

Two sources. The harness adds what it can observe: a step dropped from the plan; a file changed outside the edit
tools (from snapshots: "sed로 직접 고침 · core/scan.py"); uncommitted changes at the start; a change across several
packages (from the project's workspace graph); checks judged by the agent ("'겹치지 않아요'는 에이전트의 주장").

The model adds what needs understanding through a `flag` tool: `flag(text, kind, points_to?)`, `kind` being
`assumption` (decided without asking: "계획에 없던 파일 잠금 · 추정") or `risk` ("force_destroy = true · 객체도 삭제",
"결론에 인과 표현 2곳"). With `points_to`, clicking the line opens the changes tab at those lines. In the chat the
call is a tool row like any other; the canvas's `!` line under the reply is dropped, so a flag shows in two places
(the tool row and the panel), not three. A `flags` field in the plan tool was rejected: the plan is resent whole, and
a flag belongs to the moment it happened. No other agent app has this part to compare with.

### Self-review

Self-review is the model rereading its own changes for what tests cannot catch (an untested lock, a missed case, a
risky setting). It needs no tool of its own: each finding is a `flag(kind="risk", points_to=…)` on the lines, which
shows on the diff and in this part, and "self-review" is an agent-judged check whose evidence is those flags. A
`review` tool with a fresh model (Codex's and Claude Code's `/review`, both started by the user) and a review the
harness always runs were rejected for now: fresh eyes are better served later by a general subagent tool (hand a task
to an agent with a clean context), which also serves research and parallel work.

## Learning suggestions

Two kinds, as on the canvas's Learning board. Permission suggestions ("don't ask for `gh pr view*` · asked 23 times in
two weeks, always allowed") are counted from approvals by the harness. Rule suggestions need understanding, so the
working agent makes them with `propose_memory(text, scope, evidence)` the moment it notices (typically the user
correcting it); `scope` is team, this project · me or me · every project, and the evidence is messages of this
session. The agent cannot see other sessions, so the harness joins a suggestion to a similar pending one, adding its
evidence ("you corrected this twice · 9/25, 9/27"), and never raises a suggestion again on the evidence it was
rejected for. The call is a tool row in the chat and does not interrupt the run; the suggestion waits in 기억과 학습.
Approved, it is written to its scope's folder (a team memory is changed in the repository, not committed) and
running sessions get it as a notice. AGENTS.md is never edited. The memory design continues in
[memory.md](memory.md): kinds beyond rules, folders, recall and swappable parts.

A reviewer model reading finished sessions was rejected (another model call per session, and a judge other than the
agent that did the work); remembering without approval (Claude Code's auto memory, ChatGPT's memory) contradicts the
canvas rule that only approved learning takes effect.

## Long-running processes

`bash(command, background=true)` returns at once with an id and the first lines of output; `process(id, action)`
reads the output so far or stops it. Claude Code (`run_in_background` plus tools to read and stop) and Cursor
(background commands) work the same way. In the chat the call's row stays live: "백그라운드에서 n분째 · 로그 보기 ·
멈추기", and the user can stop it there. A process lives as long as its session: it survives the end of a run and
stops when the session is deleted or the app quits. Whether a server is ready is the model's call, from the output.
A dedicated `start_server(command, ready_when)` was rejected: the harness would judge readiness for the model, and
other long-running work (watch builds, workers) would need yet another tool. Interactive terminal sessions (Codex)
are more than checking a screen needs.

### Seeing screens

A built-in browser tool for the web: go to a URL, click, type, resize, screenshot. It runs with an app-owned profile
(never the user's sign-ins), allows `localhost` freely and asks through an approval card for any other address, and
uses the user's Chrome or a Chromium the app downloads on first use (about 150 MB). Cursor (a built-in browser the
agent drives) and Replit Agent (clicking through the app to test it) do the same; Claude Code leaves it to a
Playwright MCP or its Chrome extension. In the chat a browser call is a tool row like any other, with the screenshot
as a thumbnail. Screenshots are evidence for agent- and user-judged checks, so they are kept even for models that
cannot see images.

Screenshots only were rejected: flows behind a click (sign-in, cart) could not be checked. Leaving it to MCP was
rejected: this app's users would not wire it up themselves, and MCP is not built yet. Emulators and desktop apps come
later through connected services (MCP) or the user's own tools; controlling the whole screen (computer use) was
rejected as too broad.

Secrets in any tool's output are masked on screen (`STRIPE_SECRET_KEY=••••`): values from `.env` files and common key
shapes. Whether the model's copy is masked too is a separate question, not decided.

## In the chat

Every new tool is counted in the collapsed line like the existing ones, in this order, zeros left out:
"명령 2개 실행 · 파일 1개 읽음 · 1번 검색 · 파일 1개 편집 · 1번 확인 · 화면 1번 봄 · 계획 1번 고침 · 질문 1개 · 표시 1개 ·
기억 제안 1개 · 도구 1개 사용 · 실패 1 · 안 함 1 ›". Opened, the rows are `계획`, `확인(<check>)`, `브라우저(<url>)`,
`질문(<question>)`, `표시(<text>)`, `기억 제안(<text>)`; a background command stays an `실행(…)` row. A waiting
question's row reads "답을 기다리는 중" and is shown even when collapsed, like any running call, and the progress line
says "답을 기다리는 중" with the orange dot. In the verification part, the grey word on the right says who judged
a check: none for the harness, "에이전트" for the agent, "나" for the user.

## Summary

New model tools: `update_plan` (steps and checks), `check`, `ask`, `flag`, `process` (with `bash(background=true)`),
`browser`, `propose_memory`. New harness work: snapshots (changes part, rewind, edits outside tools), check judging,
the review dock and commit, out-of-the-ordinary rules, permission suggestions, secret masking on screen.

Not decided, for later: masking secrets in what the model reads; asking while working on (`ask` that returns at
once); a general subagent tool; emulators and desktop apps (through MCP or the user's own tools).

The design canvas was updated to these decisions on 2026-10-02 (version 62): boards QMultiple and QText added,
stickyAgentTools added, stickyQRule, stickyQVs, stickyDS and stickyLoop rewritten.

## Decisions

| Date | Decision | Rejected | Why |
|---|---|---|---|
| 2026-10-02 | Checks are declared in the plan tool; the harness judges them | a separate checks tool; the harness guessing | one tool to remember; "not run" can be shown |
| 2026-10-02 | The plan tool sends the whole step list each time; the harness matches steps | ids for changed steps; both | weak models don't get ids wrong (a weak-model reason) |
| 2026-10-02 | A dropped step shows in out of the ordinary | a "dropped" mark; vanishing | skipped work is visible without a new status shape |
| 2026-10-02 | Plan calls show in the chat like any tool call (changes only) and in the right panel | right panel only; a checklist in the chat | every tool is transparent through one interface; the full list is not shown twice |
| 2026-10-02 | The ask tool waits for the answer; the question is an item, so "keep working" can be added later | keep working; the model choosing per question | simple, weak models don't do work that depends on the answer (a weak-model reason) |
| 2026-10-02 | Up to 4 questions per ask call, the dock shows one at a time | one per call; up to 3 | answered in a row without waiting for the model between them |
| 2026-10-02 | Questions always wait; no timeout, no irreversible mark | the recommendation after 10 minutes; a timeout set by the model | predictable; dangerous actions are guarded by approvals anyway |
| 2026-10-02 | Three question kinds: single, multiple, text; the composer always answers | single choice only | the user asked for all three |
| 2026-10-02 | Option previews in Markdown or sandboxed HTML | Markdown only; none | screen questions need a picture |
| 2026-10-02 | `points_to` switches the panel to the changes tab at those lines; line comments answer | a link only; not now | the lines are seen before answering |
| 2026-10-02 | The harness opens the review dock when a run ends with changes, and commits on approval | a `request_review` tool; harness plus model options | a model cannot forget it; works the same for weak models |
| 2026-10-02 | Checks have three judges (harness, agent with evidence, user); methods are free | harness and user only; the model ticking every check | screens and notebooks have no tests; claims stay marked as claims |
| 2026-10-02 | A `check` tool runs harness checks as declared; an identical `bash` command counts | exact match only; prefix match | no false passes from partial runs |
| 2026-10-02 | No stop on repeated check failures; the model decides and may ask | stop after 3 or 2 failures | design for smarter models; other harnesses leave it to the model |
| 2026-10-02 | Snapshots in an app-owned hidden git repository, at each message and around each tool call | edit-tool tracking; hidden commits in the user's git | catches `bash` changes, works without git, never touches the user's git |
| 2026-10-02 | A `flag` tool for the model's assumptions and risks; no `!` line under the reply | a plan field; harness only | the most useful warnings need understanding; one interface for every tool |
| 2026-10-02 | `bash(background=true)` plus a `process` tool | a dedicated server tool; interactive sessions | one general tool; the model judges readiness |
| 2026-10-02 | A built-in browser tool for the web; emulators and desktop later through MCP or user tools | screenshots only; MCP only; computer use | this app's users build web screens; clicking through flows matters |
| 2026-10-02 | Self-review findings are `flag`s on the lines; no review tool | a `review` tool; a review the harness always runs | no new tool; fresh eyes later through a general subagent tool |
| 2026-10-02 | Rule suggestions through `propose_memory` by the working agent; permission suggestions by the harness | a reviewer after sessions; no approval | made where the context is; only approved learning applies |
| 2026-10-03 | Remove `update_plan` and `check`, and the plan and verification parts | keep both; keep `update_plan` only | they are procedures for the model, which smarter models will not need; a check the model could not record (likely because it cannot see call ids) showed verified work as unverified; panel content from model tools is to be something users build |
