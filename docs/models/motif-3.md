# Motif-3

What the polyglot run (gen0, [bench/polyglot](../../bench/polyglot/README.md)) and a reading of Motifcode and
mini-swe-agent showed about running alpine-code on Motif-3, and what a Motif-3 variant of the loop should change.

Motif-3 is a 314B mixture-of-experts model (13.2B active) from Motif Technologies, MIT-licensed, served here by
Infron at `https://llm.onerouter.pro/v1`. Its published SWE-bench Verified score was measured with mini-swe-agent
(one `bash` tool), its Terminal-Bench score with Terminus 2 (a persistent tmux session).

## How the model fails

From Motifcode's README table and REPORT.md (measured on the same endpoint, 2026-09-20/21), and from gen0:

| behaviour | seen in |
|---|---|
| A dropped tool call and a final answer look the same. The typical form is one sentence announcing an action ("Let me write the file directly:", median 37 completion tokens), or an empty reply, and no call. | Motifcode loop.ts; gen0: 4 failed rows ended on an empty reply with exit 0 |
| The router aborts a generation it judges repetitive: `ProviderError: Repetition was detected in the model's output and generation was stopped`. Temperature is 1.0, so asking again usually succeeds. | OpenCode lost 21 rows to it, Motifcode none (its transport retries); gen0: 5 rows |
| One reasoning step on the hosted endpoint takes 200–300 s. Clients with a 300 s header or idle timeout drop the stream. | Motifcode; Codex needed `stream_idle_timeout_ms` raised |
| Streams are sometimes cut mid-reply (`Connection error`). The OpenAI SDK's retries do not cover a stream that has already started. | gen0: 2 rows |
| Tool-call JSON breaks on escapes (`\$` in shell, `\s` in regex); the endpoint occasionally leaves a bare, untagged call in the body. | Motifcode; not a visible loss in gen0 (the router's parser caught what alpine saw) |
| The chat template renders the tool block before the system prompt; swapping two tools leaves about 24% of the cached prefix. Intermediate reasoning is rendered only when tools are registered. | Motifcode, measured on the template |

## Where gen0 lost

Against Motifcode, 30 instances Motifcode passed and alpine failed (6 the other way):

| class | rows | notes |
|---|---|---|
| timeout | 21 | Motifcode also had 22 timeouts. alpine's are mostly 3–8 tool calls and then one step that never finished. alpine sends no `max_tokens`, so a step has no output cap (Motifcode: 16,384). Not yet measured: per-step duration and token counts are not logged. |
| repetition abort | 5 | no retry on the provider error |
| empty final reply | 3 | a no-tool reply ends the loop (`State.is_answered`), in `-p` as in the REPL |
| transport | (2) | re-run and passed; the same gap as above |

## Three loops compared

| | Motifcode (task mode) | mini-swe-agent | alpine-code gen0 |
|---|---|---|---|
| tools | `done`, `bash`, `read`, `write`, `apply_patch`, `term`, `skill`, `task`, `mcp`, fixed order | `bash` only | `read`, `glob`, `grep`, `write`, `edit`, `bash` |
| how a task ends | `done`, then a confirming `done` with the same summary | a command whose output starts with `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` | a reply with no tool call |
| reply with no tool call | handed back, with an escalating message that names the 37-token stall | `FormatError` handed back; 3 in a row ends the run | ends the run |
| malformed call | schema-checked repair ladder; the turn is applied whole or refused whole | `FormatError` handed back | alpineagents default |
| provider errors | classified (refused, timeout, 5xx, 429); retryable ones back off, `Retry-After` honoured, session intact | model-class retries | SDK retries before the stream starts; nothing after |
| guards | 40 turns, loop guard (3 identical calls or 4 identical outputs), 2 repair turns after a tool failure | step, cost and wall limits | 200 turns |
| output per step | 16,384 tokens | model default | server default |
| tool output | head and tail, 10 KB | head and tail with a warning over 10,000 chars | tail, 30,000 chars |
| reasoning in history | returned every turn | — | returned (`reasoning_content` via `RawBlock`) |
| prompt | ~2k tokens, 90–98% prefix-cache hits | short system prompt, workflow in the task message | not measured |

## Candidates for a Motif-3 variant (gen1)

In order of expected effect on this benchmark; each can be confined to headless mode and the model's settings so
the REPL does not change:

1. **Retry provider errors after the stream has started**: connection drops and the repetition abort. Resend the
   same request; a repetition abort at temperature 1.0 usually does not recur. Motifcode's evidence: 0 of 213 rows
   lost to either.
2. **Hand back a reply with no tool call** in `-p` mode, a bounded number of times, naming the behaviour
   ("the last reply had no action; take the next action or say you are done"). Both Motifcode and mini-swe-agent
   do this.
3. **Cap output per step** (`max_tokens`, e.g. 16,384), after measuring per-step time and tokens on a few of the
   timeout rows to confirm that long steps are the cause.

One seed resolves only differences above about 8 pp; judge a variant by a paired comparison with gen0
(`compare.py results/gen1 --vs results/gen0`).
