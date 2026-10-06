# Memory

What the agent learns about a project and its user across sessions, and how that learning is proposed, approved,
stored, read and pruned. Decided one question at a time from 2026-10-05; it extends "Learning suggestions" in
[session-tools.md](session-tools.md), where rule suggestions through `propose_memory` were decided on 2026-10-02.

## What the research says

Read on 2026-10-04 for this design. Ages well unless marked.

- **Change items, never rewrite the whole memory.** A full rewrite collapsed an 18,282-token context to 122 tokens
  and lost accuracy ([ACE](https://arxiv.org/abs/2510.04618)). A capped list with remove-before-add held up best at
  about 15 to 20 insights ([ExpeRepair](https://arxiv.org/abs/2506.10484)).
- **Keep the reason with the rule.** Instruction files grow +226% over their life and old lines become hard to delete;
  writing the reason next to each instruction cut the excess growth from +211% to +1.4%
  ([Catastrophic Remembering](https://arxiv.org/abs/2608.11095)).
- **Memory is an attack surface.** Injection through ordinary queries succeeded 98.2% of the time
  ([MINJA](https://arxiv.org/abs/2503.03704)); approval is a real defence.
- **Use what is free first.** Git history alone improved code localisation
  ([Repository Memory](https://arxiv.org/abs/2510.01003)); Claude Code skips what the code or CLAUDE.md already says.
- **Shared beats personal** unless a preference recurs
  ([Personalized Skills](https://arxiv.org/abs/2608.10319)).
- **Always-loaded files are not free** (2025 models; may be a weak-model result). AGENTS.md did not generally raise
  success and cost over 20% more; unneeded requirements made tasks harder
  ([ETH](https://arxiv.org/abs/2602.11988)). Another study saw 28% less runtime
  ([Lulla et al.](https://arxiv.org/abs/2601.20404)).
- **Written is not followed** (may be a weak-model result). With Mem0, 57.5% of applicable preferences were still
  violated; corrections turned into small rules plus runtime checks cut that to 2 to 38%
  ([TRACE](https://arxiv.org/abs/2606.13174)). Compliance falls as a session grows
  ([McMillan](https://arxiv.org/abs/2605.10039)).

Chat memory services (Mem0, Honcho, Hindsight) were not adopted: they model who the user is rather than how to work
in a project, cost a model call per turn plus an embedding store, write without approval, and report vendor-run
conversation benchmarks (LoCoMo, LongMemEval) that vendors dispute. Ideas kept for later questions: Hermes' character
caps, "do not save" list and forked review that reuses the prompt cache; Holographic's trust score and contradiction
check; Codex leaving out conversations that read MCP or web content; Claude Code's index loaded at start with topics
read on demand. Cursor shipped approved memories and removed them in 2.1 as no different from rules files, so the
difference here has to come from evidence, pruning and checking that memories are followed.

## Six parts that can be swapped

Each is a port with one default. Only the inbox's rules are fixed: approval is a product rule, not a setting.

| Part | Decides | Default |
|---|---|---|
| Kinds | what is worth keeping, which scopes each kind may use, what its index line says | rule, fact, lesson, user |
| Store | where memories are kept | a folder per scope: `index.md` plus one file per memory |
| Recall | how memories reach the model | the index in the system prompt at session start; bodies read with `read` |
| Proposer | who suggests memories, and when | the working agent, through `propose_memory` |
| Check | how a memory is checked while the agent works | when/expect/say checks on observed facts |
| Guard | which calls a must-hold rule asks the user about | command prefixes and paths, matched as permissions match today |

The inbox sits between the proposer and the store: it joins a suggestion to a similar pending one, drops one whose
evidence was already rejected, waits for approval and hands the approved memory to the store. Every suggestion
records its source, so the panel can say who made it. Evidence (the sessions a memory came from) and counters are kept
by the inbox under `~/.alpine-code`, never in a repository.

The ports live in `alpine_core/memory/` first. Nothing in them is specific to coding, so they can move into
alpineagents later, as the storage ports may.

### Kinds

| Kind | Example | Index line | Scopes |
|---|---|---|---|
| Rule | 화면 문구는 해요체로 쓴다 | the rule | all |
| Fact (not in the code) | 배포는 Vercel, 운영 DB는 Supabase `flower-prod` | the fact | all |
| Lesson (a problem and its fix) | 예약이 안 보이면 Supabase RLS 정책부터 확인 | symptom → what to do | all |
| User | 코드를 잘 모르니 설명은 쉬운 말로 | the trait | me only |

Not kinds: work in progress (goes stale fast; a stale goal believed is harmful; sessions keep it) and procedures
(anything that can run becomes a project tool through `propose_tool`). Kinds are kept apart because mixed memory
types contaminate each other ([MemGuard](https://arxiv.org/abs/2605.28009)); lessons are kept because failures carry
the most signal ([ReasoningBank](https://arxiv.org/abs/2509.25140)).

### Store

| Scope | Folder | Shared |
|---|---|---|
| Team | `.alpine/memory/` in the repository | committed |
| This project · me | `~/.alpine-code/projects/<project>/memory/` | outside the project |
| Me · every project | `~/.alpine-code/memory/` | not in a repository |

AGENTS.md (and CLAUDE.md) stay rules people write; memory never edits them. `index.md` holds one line per memory:
what must be known without opening it. The memory's own file holds the reason, examples, and for a lesson what
happened.

### Recall

The index is put into the system prompt when a session starts and stays fixed, so the prompt cache holds. A memory
approved during a session reaches running sessions as a notice appended to the conversation, not as a new system
prompt. Bodies are read on demand with the ordinary `read` tool.

### Proposer

The first proposer is the working agent alone, through `propose_memory`. A review in a fork (every few turns, or
once before compacting) is another proposer, to add if suggestions are seen to be missed; its reason would be weaker
models forgetting to propose. Which proposer runs can follow the model profile. A review before compacting can cost
no extra call: the extraction instructions ride on the compaction request the harness already makes
([opencode-working-memory](https://github.com/sdwolf4103/opencode-working-memory) does this).

### Pruning

A suggestion adds, changes or removes a memory. Each scope's index has a cap (a setting; 30 lines to start, between
ExpeRepair's 15 to 20 and opencode-working-memory's 28 entries). When a scope is full, a new suggestion must also name
what it merges or removes, and the user approves both at once. The harness raises removals and changes only from what
it observes, and these are one more proposer through the same inbox:

- a fact names a file or path that no longer exists;
- a new suggestion is close to an approved memory (it was not followed, or needs changing).

Nothing fades out of the prompt on its own: what is approved is what applies. A recall budget that leaves some
memories out (opencode-working-memory) can be added later as a Recall, showing what it left out as resting.

### Following

Written is not followed by itself, so three layers, each for a different strength of rule:

1. **Observed and shown.** When a suggestion is close to an approved memory, the memory gets "said again after
   approval, n times" with the dates, and the inbox raises a change that states it more clearly. No extra cost.
2. **Rules that must hold become guards.** A rule memory may carry a guard: before a matching command or path, the
   harness stops and asks the user with an approval card, whether or not the agent remembered the rule.

   ```yaml
   guard: always ask before command "supabase db execute --linked*"
   say: 운영 DB에 직접 SQL을 실행하려고 해요.
   ```

   Guards only ask; there is no deny, so the user can always say "this time it is fine". Team guards are committed
   with team memory: a guard only adds questions and grants nothing, so it is safe to come from a repository (allow
   rules never may). Guards ask in every mode, yolo too: yolo is a general setting, a guard is a specific rule the
   user approved. They run in alpineagents' permission step with before-command checks. Asking is for the user's
   safety, whatever the model's skill.

3. **Checks the harness runs.** A memory may carry a check on what the harness observes. Checks judge observed facts
   only (commands run, files changed), never the model's claims, so they avoid what sank the removed `check` tool.
   Their reason is partly weaker models ([TRACE](https://arxiv.org/abs/2606.13174),
   [compliance falls in long sessions](https://arxiv.org/abs/2605.10039)), so they are to be revisited.

   | When | Example | When it fails |
   |---|---|---|
   | before a command | before `git commit*`, did `pnpm lint` run after the last file change? | that one call is refused with the reason; the run goes on (like 건너뛰기) |
   | after a file changes | an existing file under `supabase/migrations/` was edited instead of a new one added | a notice to the agent |
   | when the run ends | `*.tsx` changed and no build ran | a notice to the agent |

   A check is written in a fixed form people can read and the agent can propose:

   ```yaml
   when: before command "git commit*"
   expect: command "pnpm lint" ran after the last file change
   say: 커밋 전에 `pnpm lint`를 먼저 돌려 주세요.
   ```

   Before-command checks run in alpineagents' permission step (`Agent(permissions=)`), which no loop can skip.
   Checks in Python (approved by hash, like user tools) can come later through the Check port.

Executable procedures become tools, rules that must hold become permissions, and the rest stays text that is
observed.

## Building it

1. **Done:** `alpine_core/memory/`: kinds, `MarkdownStore`, `IndexRecall`, `AgentProposes` (`propose_memory`) and
   the inbox, with a second implementation of each port in `tests/test_memory.py`. Not yet connected to sessions.
2. **Done but the app:** `Memories` (one memory per project, shared by sessions and the server) puts the index into
   `build_system_prompt`, `propose_memory` into every profile's tools, the memory folders into what `read` may open
   without asking, and approvals into open sessions as `notice` items. The protocol has `memory/*` and
   `memory/changed` ([session-protocol.md](session-protocol.md)). The interactive CLI suggests and recalls; `-p`
   has no memory, so benchmarks and scripts run the same each time. **The app:** a suggestion is a card under
   its call in the chat (기억하기 · 안 함 · 내용 보기); it does not hold up the run, and once kept it is one quiet line.
   The project menu in the rail opens 기억 (`/memory?project=`): waiting suggestions, then what is kept by scope, each
   opening to its reason, where it came from, when it was said again, its file, and 지우기.
3. **Done:** pruning. A suggestion can remove a memory (`remove`, approved like any other; declining it on the same
   evidence is final). A project has several proposers; after every run each looks (`on_run_end`). `MissingPaths`
   checks the backticked paths of team and this-project memories: a relative path with a `/` whose first folder still
   exists but which is gone is suggested for removal, with the missing paths as the evidence, so a branch
   (`origin/main`) or a package (`@alpine/ui`) is never taken for a path. The run ends with a `memory_review` item that
   only the user reads ("기억 하나가 가리키는 파일이 없어졌어요 · 확인하기 ›"); the suggestion waits on the memory page.
   Memories said again were already handled by the inbox in step 1. Removing a memory (approved, or with 지우기)
   reaches open sessions as a notice.
4. Checks and guards in the permission step.

## Decisions

| Date | Decision | Rejected | Why |
|---|---|---|---|
| 2026-10-05 | Learned memory has its own place per scope; AGENTS.md is never edited | team memory written into AGENTS.md | AGENTS.md stays rules people write; learned and written rules stay apart so pruning never touches people's text; Claude Code, Codex and Hermes keep the two apart |
| 2026-10-05 | Each memory keeps its reason; evidence and counters stay outside the repository | the rule alone; a structured store with generated files | reasons keep files from only growing and let people judge them; evidence is personal |
| 2026-10-05 | No chat memory service (Mem0, Honcho, Hindsight) | adopting one as a provider | built for modelling users in chat; a model call per turn and a vector store; no approval |
| 2026-10-05 | Proposers are swappable behind one inbox; the first is the working agent through `propose_memory` | a fixed timing; adding a forked review now | when and who can change with models and evidence; the merge, rejection and approval rules stay one place; a forked review fixes forgetting, a weak-model reason |
| 2026-10-05 | Recall by an index in the system prompt, bodies read on demand | everything always loaded; embedding search | the user's choice; what is always paid for stays small |
| 2026-10-05 | The index line is what must be known without opening (the rule, the fact, symptom → action) | a title only (Claude Code); one file per scope | a memory is followed even when its file is never opened |
| 2026-10-05 | The index is fixed at session start; approvals mid-session arrive as a notice | a new system prompt from the next message | changing the system prompt throws away the prompt cache |
| 2026-10-05 | Four kinds: rule, fact, lesson, user (me scopes only) | rules only; also work in progress; procedures as memory | lessons carry the most signal; stale goals mislead; what can run becomes a tool |
| 2026-10-05 | Kinds, store, recall and proposer are ports, each with one default; the inbox's approval rules are fixed | one built-in design | the user wants every part replaceable; approval is a product rule |
| 2026-10-05 | A cap per scope (30 index lines to start); when full, a suggestion names what it merges or removes, approved together; the harness proposes removals only from observed facts | a recall budget where old memories fade out; no cap with periodic model review; removing what was not opened for N days | what is approved is what applies; a whole-memory review risks collapse; rules followed from the index are never opened |
| 2026-10-05 | Following in three layers: re-corrections observed and shown; must-hold rules proposed as "always ask" permissions; optional checks on observed facts that remind the agent | observing only; checks that stop the run | the user chose all three; stopping belongs to permissions; checks judge facts, not claims (partly a weak-model reason) |
| 2026-10-05 | Checks hook three moments (before a command, after a file change, when the run ends) in a fixed when/expect/say form; a failed before-command check refuses that one call | notices only; Python checks now | a notice after a commit comes too late; refusing one call keeps the run going; non-developers can read the form |
| 2026-10-05 | Must-hold rules carry guards that always ask the user; no deny; team guards committed; guards ask in yolo too | deny guards; guards skipped in yolo | the user can still say yes in the moment; a guard grants nothing, so a repository may carry it; a specific approved rule beats a general mode |
| 2026-10-05 | "This project · me" memory lives outside the project, under `~/.alpine-code/projects/<project>/memory/`; a moved folder is joined again through `projects.json` | `.alpine/local/memory/` with a `.gitignore` entry | the user's folder and `.gitignore` are never changed quietly; personal memory can never be committed; Claude Code does the same |
| 2026-10-06 | Suggestions are answered in a card under their call in the chat; the project menu's 기억 열기 lists everything | a memory page only, with a badge; one card when the run ends | answered where the context is, without holding up the run; a kept memory reaches the open session at once |
| 2026-10-06 | The context meter is 대화 길이 (Conversation length), not 대화 기억 | keeping two meanings of 기억 | 기억 now means what was learned; the meter is how much of what the model can read at once the chat fills |
| 2026-10-06 | Deleting a project removes the user's own memory of it (`~/.alpine-code/projects/<project>/`); team memory and the memory for every project stay | keeping it | the delete dialog promises Alpine's records of the project go; team memory lives in the folder, which delete never touches |
| 2026-10-06 | Harness suggestions end the run with one quiet line that only the user reads, and are answered on the memory page | the memory page only, with a count; a card in the chat | told where it happened without holding up the conversation; the harness's judgement is not shown as the agent's |
| 2026-10-06 | Missing paths are relative paths with a `/` whose first folder still exists, in team and this-project memories | every backticked token; files without a folder | a false "gone" is worse than a missed one; memories for every project name no project's paths |
