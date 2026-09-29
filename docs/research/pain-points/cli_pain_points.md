# CLI 코딩 에이전트 사용자 고통 포인트 (Claude Code, Codex CLI, Gemini CLI, Aider, opencode, Crush)

Collected 2026-09-28. Primary evidence = GitHub issues pulled via the GitHub search API sorted by reactions (numbers below are `reactions.total_count` at collection time; "c=" = comment count where fetched). Secondary = HN threads, vendor engineering posts, blogs.

Method caveats (read first):
- Reaction counts are not comparable across repos: anthropics/claude-code has a far larger issue-filing audience than gemini-cli, aider, or crush. Compare within a repo, and use cross-repo appearance of the same pain as the "how widespread" signal.
- GitHub search matches bodies loosely; I used `in:title` searches for topic ranking, so some relevant issues with off-topic titles are missed.
- sst/opencode now lives at anomalyco/opencode (search on the old name fails).
- Several top Claude Code issues concern Desktop/mobile/Cowork rather than the CLI. They are excluded unless relevant.
- Widespread-ness scale used below: **Very high** = 500+ reactions or top-10 in repo, or appears in 3+ tools; **High** = 150–500; **Medium** = 50–150; **Low/niche but severe** = <50 but recurring reports.

---

## Q1. Terminal-UI-specific problems (flicker, scrollback, resize, copy/paste, multiline, IME/CJK, keybindings)

### Takeaway
Rendering/scrollback is the biggest pure-TUI pain in the whole category. In Claude Code it was the most-upvoted non-model issue for over a year, and Anthropic needed an opt-in renderer rewrite to deal with it. Close behind: copy/paste corruption from TUI formatting, collapsed paste blocks, Enter vs newline, and CJK IME composition, which is still broken for Korean in 2026 across many reports.

### Cited Findings
**Flicker / scroll-jump / scrollback (Very high)**
- Claude Code #826 "Console scrolling top of history when claude add text to the console": 822 reactions (690 +1), 354 comments, still **open** — [GitHub](https://github.com/anthropics/claude-code/issues/826)
- Claude Code #3648 "Terminal Scrolling Uncontrollably During Claude Code Interaction": 836 reactions, 337 comments, closed 2025-12-17 — [GitHub](https://github.com/anthropics/claude-code/issues/3648)
- Claude Code #769 "In-progress Call causes Screen Flickering": 335 reactions, 307 comments, open; #1913 "Terminal Flickering": 321 reactions, open; #36582 "Terminal keeps scrolling to top when conversation gets long" (2026-03): 135; #4851 scrollback rewind lag in tmux + VS Code: 97 — [#769](https://github.com/anthropics/claude-code/issues/769), [#1913](https://github.com/anthropics/claude-code/issues/1913)
- Root cause, as an Anthropic engineer put it: Claude Code writes into normal scrollback instead of the alternate screen, "which it has to clear entirely and redraw everything when it changes (causing tearing/flickering)". A "differential renderer" fixed about a third of flickering sessions. Users on the same HN thread still reported flicker in tmux ("terrible flicker in tmux still"), "flickering is giving me a headache", scrolling up whenever the window lost focus ("I had to use Codex today cause claude kept scrolling up"), and stuttering in long sessions — [HN: Claude Chill](https://news.ycombinator.com/item?id=46699072), [HN comment by Anthropic TUI engineer](https://news.ycombinator.com/item?id=46701013)
- Anthropic: "We've rewritten Claude Code's terminal rendering to reduce flickering by 85%" (Dec 2025) — [HN](https://news.ycombinator.com/item?id=46312507), [X/Thariq](https://x.com/trq212/status/2001439019713073626)
- Later, `CLAUDE_CODE_NO_FLICKER=1`: an experimental renderer that virtualizes the viewport and takes over mouse and keyboard scrolling. Claimed benefits are no flicker, constant memory/CPU as the conversation grows, and mouse support. The announcement itself says it "has tradeoffs" — [Boris Cherny on X](https://x.com/bcherny/status/2039421575422980329?lang=en), [blog "a fix a year in the making"](https://slyapustin.com/blog/claude-code-no-flicker.html)
- Third-party wrapper "Claude Chill" exists only to fix the flicker (a sign of how bad the pain was) — [HN](https://news.ycombinator.com/item?id=46699072)
- Codex CLI: #2558 "output truncated when scrolling in Zellij": 134 reactions, closed 2026-04-03; #2836 mouse scroll in zellij can't see earlier conversation (alt-screen): 23; #11901 "Extensive UI flickering when codex is working": 14, open; #6427 truncates messages when scrolling: 24 — [#2558](https://github.com/openai/codex/issues/2558), [#11901](https://github.com/openai/codex/issues/11901)
- Gemini CLI: #14708 "interface keeps flickering": 32; #2859 "flickering and duplicating output": 30; #22004 tmux spinner flicker (open); #2623 "Robust terminal resizing/scrolling": 12; #13059/#13107 "cant scroll" — [#14708](https://github.com/google-gemini/gemini-cli/issues/14708)
- Crush #737 "configurable keybindings to resolve terminal multiplexer conflicts": 29 — [GitHub](https://github.com/charmbracelet/crush/issues/737)

**Copy/paste and output formatting (High)**
- Claude Code #18170 "Copy/paste from terminal includes unwanted indentation and trailing spaces": 296, open; #15199 "CLI output formatting artifacts break copy/paste – workarounds waste tokens": 106, open; #22073 "Copy/paste has new lines instead of wrapping": 79; #13378 "2-space indent and hard wrap at 80 breaks copy-paste": 74 — [#18170](https://github.com/anthropics/claude-code/issues/18170), [#15199](https://github.com/anthropics/claude-code/issues/15199)
- opencode #4283 "Copy To Clipboard is not working": 130, open; #1168 "Make links clickable": 148 — [GitHub](https://github.com/anomalyco/opencode/issues/4283)

**Paste collapsing / input editing (High)**
- Claude Code #3412 "Allow viewing and editing content of 'pasted text' blocks before submission": 309 (closed); #23134 "Option to disable paste text collapse": 160, open — [#3412](https://github.com/anthropics/claude-code/issues/3412), [#23134](https://github.com/anthropics/claude-code/issues/23134)
- opencode #8501 "Allow to expand the pasted text (`[Pasted ~1 lines]`)": 326, open (the #3 most-reacted opencode issue) — [GitHub](https://github.com/anomalyco/opencode/issues/8501)
- Vim-mode requests: opencode #1764 "vim motions in input box": 197; Crush #1199 "Vim Mode": 42 — [opencode](https://github.com/anomalyco/opencode/issues/1764), [crush](https://github.com/charmbracelet/crush/issues/1199)
- Claude Code #6275 "Unexpected Text Loss on Up Arrow Key Press": 49 — [GitHub](https://github.com/anthropics/claude-code/issues/6275)

**Multiline input / Enter semantics (Medium)**
- Claude Code #2054 "Insert a new line with Enter key instead of sending": 193; #1758 "Support shift+enter in most terminals": 65; #1262 Shift+Enter broken in WSL: 33; #8034 `/terminal-setup` doesn't support GNOME Terminal: 36 — [#2054](https://github.com/anthropics/claude-code/issues/2054)

**IME / CJK input (High for CJK users; recurring, cross-tool)**
- Claude Code #1547 "IME input causes performance issues and duplicate conversion candidates": 261 (243 +1), **open since 2025-06** — [GitHub](https://github.com/anthropics/claude-code/issues/1547)
- Claude Code #8405 "Pressing Enter to confirm IME (Japanese) conversion unintentionally sends the prompt": 95 — [GitHub](https://github.com/anthropics/claude-code/issues/8405)
- Korean-specific Claude Code reports in 2026 (each has few reactions, but they keep being filed): #70007 Hangul decomposes into individual jamo; #83067 cursor fails to advance after each composed syllable (Windows); #73064 한/영 toggle ignored in Windows Terminal; #45055 IME toggle not working without a focus switch; #75507 text after the cursor disappears while composing mid-line (iTerm2); #87869 "[macOS] Korean IME composition is a daily usability blocker… consolidating related reports" (closed 2026-09-21); #97389 VS Code: composing text appears one line below the prompt. The attributed root cause is that the React Ink TextInput reads raw terminal input and bypasses the terminal's IME preedit. The only reported workaround is to type Korean elsewhere and paste it — [#70007](https://github.com/anthropics/claude-code/issues/70007), [#87869](https://github.com/anthropics/claude-code/issues/87869), [#83067](https://github.com/anthropics/claude-code/issues/83067), [#73064](https://github.com/anthropics/claude-code/issues/73064), [#75507](https://github.com/anthropics/claude-code/issues/75507), [#97389](https://github.com/anthropics/claude-code/issues/97389)
- Claude Code #83033: Sonnet 5 writes Korean tool-call parameters as \uXXXX escapes and misspells the hex, corrupting Hangul in files: 153, open (model/tooling, but hits Korean users directly) — [GitHub](https://github.com/anthropics/claude-code/issues/83033)
- Gemini CLI #1796 "Input with Japanese IME is not working well": 191 (the #2 most-reacted Gemini CLI issue, closed). A Claude Code issue titled "Korean IME Composition Broken — Gemini CLI Proves It's Fixable" (#27857) came up in search, but the issue now returns 404 — [Gemini #1796](https://github.com/google-gemini/gemini-cli/issues/1796)
- Codex: #3260 Japanese IME drops digits during composition; #2718/#2745 composition text not displayed until the next key; #11026 Enter confirming Japanese IME submits in Plan Mode (open); #26369 Chinese IME can't type in Desktop — [#11026](https://github.com/openai/codex/issues/11026), [#3260](https://github.com/openai/codex/issues/3260)

**Performance / memory of the TUI process (Medium–High)**
- Claude Code #4953 "Memory Leak – Process Grows to 120+ GB RAM and Gets OOM Killed": 78, 97 comments, open; #11315 "Consumed 129GB RAM and Caused System Freeze": 58, open; #26224 hangs/freezes on prompts for 5–20 min: 152 — [#4953](https://github.com/anthropics/claude-code/issues/4953), [#26224](https://github.com/anthropics/claude-code/issues/26224)
- opencode #20695 "Memory Megathread": 171 — [GitHub](https://github.com/anomalyco/opencode/issues/20695)
- Gemini CLI #22141 "becomes extremely slow (1+ HOURS) / stuck during small code-edit tasks": 164; #11511 "takes up to 39 seconds to load on Windows": 78 — [#22141](https://github.com/google-gemini/gemini-cli/issues/22141)
- Codex #28224 "SQLite feedback logs can write ~640 TB/year and rapidly consume SSD endurance": 615 (closed) — [GitHub](https://github.com/openai/codex/issues/28224)

**Visual / theming and whimsy vs. bugs**
- Crush #755 "Please support a light mode (or at least colorblind mode)": 43 — [GitHub](https://github.com/charmbracelet/crush/issues/755)
- Gemini CLI #5674 "How about you NOT implement stupid features like 'Corgi mode' and instead address real bugs": 55. The opposite sentiment also exists: Claude Code #45596 "Bring Back Buddy — A Consolidated Plea from the Community": 2,095, open (the #3 most-reacted issue in the repo; judging by the title, Buddy was a companion/mascot feature that got removed) — [Gemini #5674](https://github.com/google-gemini/gemini-cli/issues/5674), [CC #45596](https://github.com/anthropics/claude-code/issues/45596)

### Inferences
- Scrollback-mode (inline) TUIs built on React Ink hit flicker and scroll-jump structurally. Alt-screen TUIs (Codex, early Gemini) hit a different set of problems: you can't use native terminal scroll or copy, and multiplexers like zellij/tmux misbehave. Neither approach is free. Anthropic's final answer was to own the viewport and take over mouse scrolling.
- CJK IME is a persistent, cross-vendor blind spot, and Korean is especially badly served (jamo decomposition, cursor lag, toggle issues). A Python/prompt_toolkit TUI that works well with IME would stand out for Korean users.
- Users want the TUI's output to be copyable as clean text: no hard wraps, no indentation artifacts, links clickable.

### Gaps
- No exact date or version for NO_FLICKER going default. From the snippets, it looked like it was still opt-in and experimental.
- Couldn't verify how many Korean users are affected. Each Korean IME issue has few reactions; the pain shows up as many duplicate reports instead.

---

## Q2. Permission prompts, approval fatigue vs. YOLO, sandboxing, destructive actions

### Takeaway
Users are stuck between approval fatigue (Anthropic says users approve 93% of prompts) and "yolo" modes that have repeatedly deleted home directories. Permission rule matching for compound shell commands is a big bug cluster in its own right. Destructive-deletion incidents recur across Claude Code and Gemini CLI and get press coverage far beyond their reaction counts.

### Cited Findings
- Anthropic engineering (2026-03-25): "Claude Code users approve 93% of permission prompts", which leads to approval fatigue. Auto mode is meant to block scope escalation (e.g. deleting remote branches after "clean up old branches"), credential hunting, exfiltration via public gists, and retries with skip-verification flags — [Anthropic Engineering](https://anthropic.com/engineering/claude-code-auto-mode)
- Blogs frame the dilemma as prompts vs. sandboxes: "After 100+ approve/deny prompts, developers either stop reading and blindly approve, or use --dangerously-skip-permissions". Pulumi argues "YOLO mode is the right default; your laptop is the wrong place for it". There are also community sandbox wrappers: yoloAI, and codex-yolo, which auto-approves Codex prompts inside tmux — [Pulumi](https://www.pulumi.com/blog/sandboxing-coding-agents-yolo-mode/), [yoloAI](https://github.com/kstenerud/yoloai), [codex-yolo](https://github.com/codex-yolo/codex-yolo), [Docker](https://www.docker.com/blog/what-is-yolo-mode/)
- **Permission matching bugs** (Claude Code): #28240 "Permission prompt incorrectly triggers on cd instead of the actual command in compound bash statements": 207, open; #16561 "Parse compound Bash commands and match each component against permissions": 176 (closed 2026-08-17, presumably shipped); #30519 "Permissions matching is fundamentally broken — 30+ open issues, no staff engagement, community building workarounds": 80, open; #18950 skills/subagents don't inherit user-level permissions: 71 — [#28240](https://github.com/anthropics/claude-code/issues/28240), [#30519](https://github.com/anthropics/claude-code/issues/30519), [#16561](https://github.com/anthropics/claude-code/issues/16561)
- Codex: #2860 "Unusable on Windows due to permission ask for every shell command": 110, 77 comments (closed 2025-11); #13476 "Excessive approval prompts… for Playwright MCP": 39; #39973 "Retiring approval_policy='untrusted' without deprecation weakens the execution-approval boundary": 41 (open, 2026-08); #11915 "read-only" approval mode: 42; #2847 "A way to exclude sensitive files": 466 — [#2860](https://github.com/openai/codex/issues/2860), [#2847](https://github.com/openai/codex/issues/2847), [#39973](https://github.com/openai/codex/issues/39973)
- Gemini CLI: #3009 "Unclear how to disable or reset auto-approval for tools": 13; #19208 "'allow for future sessions' results in 'Failed to persist policy'"; #25872 browser tool needs constant approval even in YOLO — [#3009](https://github.com/google-gemini/gemini-cli/issues/3009)
- Aider #649 "option to force the AI to ask the user to confirm each change": 41 (Aider auto-applies edits by default) — [GitHub](https://github.com/Aider-AI/aider/issues/649)
- **Sandbox friction** (Claude Code sandbox mode): #28018 allow outbound localhost: 78; #23416 macOS sandbox breaks TLS verification for Go binaries (gh, terraform): 67; #78419 "Sandbox stubs break `git add .` and are indistinguishable from real repo state to the agent": 32; #70684 SOCKS5 proxy breaks SSH git. Codex: #3141 GPU access in sandbox: 62; bubblewrap version failures on Ubuntu 20.04 (#15283); Linux sandbox mountinfo failure (#47345, 2026-09) — [#23416](https://github.com/anthropics/claude-code/issues/23416), [#78419](https://github.com/anthropics/claude-code/issues/78419), [Codex #3141](https://github.com/openai/codex/issues/3141)
- **Destructive incidents**:
  - Dec 2025: a Claude Code user's Mac home directory was wiped by `rm -rf tests/ patches/ plan/ ~/`. Widely covered. Docker's writeup: "nothing sits between the model's decision and the shell's execution" — [Docker blog](https://www.docker.com/blog/coding-agent-horror-stories-the-rm-rf-incident/), [WebProNews](https://www.webpronews.com/anthropic-claude-cli-bug-deletes-users-mac-home-directory-erasing-years-of-data/)
  - Claude Code rm -rf issues: #10077 (2025-10), #12637 (2025-11), #88462 "ran rm -rf on $HOME in **auto mode** — destructive code hidden inside a script the assistant wrote itself (**5th report of this class**)" (2026-08, open), #93099 Opus 5 `rm -rf "$HOME"` during test cleanup, 57,235 files (2026-09, open), #95426 "deleted ~600GB: unprompted rm -rf on a substitution that resolved to a drive root" (2026-09, open). #6608 "ran rm -rf without permission": 14; #15711 rm -rf executed "despite explicit allow-list" — [#88462](https://github.com/anthropics/claude-code/issues/88462), [#93099](https://github.com/anthropics/claude-code/issues/93099), [#95426](https://github.com/anthropics/claude-code/issues/95426), [#10077](https://github.com/anthropics/claude-code/issues/10077), [#6608](https://github.com/anthropics/claude-code/issues/6608)
  - Gemini CLI, Jul 2025: a `mkdir` failed silently, then Gemini ran `move` commands into a directory that didn't exist, destroying the files ("I have failed you completely and catastrophically") — [HN](https://news.ycombinator.com/item?id=44651485), [AI Incident DB #1178](https://incidentdatabase.ai/cite/1178/). Gemini #26856 (Obsidian vault, "10000s of files… deleted not recoverable"): 170 reactions, 49 comments; #15821 deleted entire project directory; #14379 "original task was `ls`, gemini hallucinated a task to delete files" — [#26856](https://github.com/google-gemini/gemini-cli/issues/26856), [#14379](https://github.com/google-gemini/gemini-cli/issues/14379)
- A related pain is agents proceeding without an answer: Claude Code #73125 "AskUserQuestion: 'No response after 60s — continued without an answer'": 414 (closed); Codex #28969 "Add setting to disable the auto-resolve in 60 seconds for questions": 214, open — [CC #73125](https://github.com/anthropics/claude-code/issues/73125), [Codex #28969](https://github.com/openai/codex/issues/28969)

### Inferences
- Destructive incidents score low on GitHub reactions (victims file one-off reports) but high on press and HN. Their "widespread-ness" is better measured as recurring same-class reports (5+ for Claude Code home-dir deletion) than as votes.
- Permission rules keyed on command prefixes break on compound commands (`cd x && rm …`), on scripts the agent wrote itself (#88462), and on variable expansion (#95426). Prefix allow-lists are not a safety boundary.
- Users want: (a) fewer prompts for safe reads, (b) a hard filesystem boundary (project root, never $HOME), (c) deny-by-default for rm/git reset/force-push, and (d) never auto-proceeding on an unanswered question.

### Gaps
- No public numbers on how many users run `--dangerously-skip-permissions`/`--yolo` (the Anthropic post gives none).
- Couldn't confirm whether Claude Code sandboxing is on by default as of 2026-09. Byteiota's framing is that it "exists but is opt-in" — [byteiota](https://byteiota.com/claude-codes-rm-rf-bug-deleted-my-home-directory/).

---

## Q3. Reviewing what the agent changed (diffs, large changes, undo/checkpoints)

### Takeaway
Users want a real review surface: diff and approval inside an IDE or a structured review UI, plus reliable undo that reverts both code and conversation. Codex removing `/undo` is one of its top open complaints. In Claude Code, `/rewind` exists but fails in edge cases (edits made through Bash, after compaction).

### Cited Findings
- Codex #9203 "Please make '/undo' back": 513 reactions, 85 comments, open (top-10 in repo); #11626 "CLI: Add /rewind checkpoint restore that reverts both chat context and Codex-applied code edits": 225, open; #2998 "IDE-integrated diff / approval": 236, open — [#9203](https://github.com/openai/codex/issues/9203), [#11626](https://github.com/openai/codex/issues/11626), [#2998](https://github.com/openai/codex/issues/2998)
- Claude Code #353 "Undo/Checkpoint Feature for Correcting AI-Generated Code": 178 (closed; /rewind now exists). Remaining edge cases: #87575 "Auto mode… causes /rewind to silently fail on Bash-edited files": 41 (open, 2026-08); #24471 rewind history lost after compaction: 20; #53011 /rewind hangs the CLI: 21 — [#353](https://github.com/anthropics/claude-code/issues/353), [#87575](https://github.com/anthropics/claude-code/issues/87575), [#24471](https://github.com/anthropics/claude-code/issues/24471)
- Claude Code #33932 "VS Code Extension: Diff review UI similar to GitHub Copilot Edits Review": 276, open; #8660 edit preview/diff not showing in VS Code when confirming: 92; #23626 diff against branches other than main: 141 — [#33932](https://github.com/anthropics/claude-code/issues/33932)
- The opposite complaint (inline diffs are too noisy in the terminal): Claude Code #37951 "Option to hide inline diffs for Edit/Write tool output": 102, open; #25018 disable auto-opening diff tabs: 75 — [#37951](https://github.com/anthropics/claude-code/issues/37951)
- Scope creep makes review harder: comparison blogs call "loose focus discipline" a recurring Codex complaint ("editing adjacent files… sprawling diffs that are expensive to review") — [Tembo](https://www.tembo.io/blog/codex-cli-vs-claude-code)
- Claude Code #8477 "Always Show Claude's Thinking": 362 (transparency into why changes were made) — [GitHub](https://github.com/anthropics/claude-code/issues/8477)

### Inferences
- Undo is only trusted if it covers every write path, including shell-driven edits. Checkpoints based on snapshots or git are more robust than replaying the tool log.
- Diff display preferences split: some people want full inline diffs, others want summaries with the diff on demand. It should be configurable.

### Gaps
- Couldn't determine why Codex removed /undo, or whether it has been restored since (#9203 was still open at collection time).

---

## Q4. Session management (resume, history, parallel agents, context exhaustion, compaction)

### Takeaway
Compaction is a black box: it loses details, can fail, and afterwards you can't see what was there before. Resume is tied to the working directory and has regressed several times. People run agents in parallel by assembling worktrees and tmux themselves, and they want queueing, notifications, and "side questions" without interrupting the running task.

### Cited Findings
- Compaction: Claude Code #17428 "Enhanced /compact with file-backed summaries and selective restoration": 117, open; #7530 "Error during compaction": 100; #27242 "No working mechanism to review previous context after compaction, plan-mode clear, or branch navigation — data preserved but [inaccessible]": 89, open; #6689 "--no-auto-compact switch": 47 (closed 2026-08-17); #6354 "Claude forgets everything in CLAUDE.md after compaction": 30; #12505 plan mode resurfaces old plans after compaction — [#17428](https://github.com/anthropics/claude-code/issues/17428), [#27242](https://github.com/anthropics/claude-code/issues/27242), [#7530](https://github.com/anthropics/claude-code/issues/7530)
- Codex: #4106 "Control over auto-compaction parameters": 125, open; #11325 manual /compact in app: 156; remote compaction errors (#14860: 91; #17809: 56; #48232 401 for ChatGPT-auth users, 2026-09) — [#4106](https://github.com/openai/codex/issues/4106)
- Blog evidence of compaction loss: one developer measured 18,282 tokens of accumulated knowledge compressed into 122 tokens, with task accuracy dropping from 66.7% to 57.1% — [MindStudio](https://www.mindstudio.ai/blog/claude-code-compact-command-context-management) (secondary source; the original measurement couldn't be verified)
- Resume: Claude Code #5768 "Resuming sessions only works from the directory in which they were started": 61, open; #28745 resume from different directories: 80; #26123 "/resume is broken — session history inaccessible since v2.1.31": 60 (fixed in 2 days); #46445 /resume shows all projects' sessions (regression): 52; #63147 resuming extended-thinking session fails permanently with 400: 50 — [#5768](https://github.com/anthropics/claude-code/issues/5768), [#26123](https://github.com/anthropics/claude-code/issues/26123)
- Codex: #4163 "Named sessions for --resume": 132; #2080 session list/resume: 108; #1991 resume after unrecoverable errors: 81; #12564 rename threads for history navigation: 214 — [#4163](https://github.com/openai/codex/issues/4163)
- Gemini CLI: #3882 "Automatically save chat history": 52; #2554 conversation history export: 56; #26425 `--resume` fails and chats corrupt on empty .jsonl — [#3882](https://github.com/google-gemini/gemini-cli/issues/3882)
- Interrupt/queue/parallel: Claude Code #50246 "Message queue mode — queue messages instead of interrupting active tasks": 248 (closed); opencode #16992 "add /btw command" (side question without derailing): 399, the #2 opencode issue; opencode #4821 "unqueue messages": 126; Codex #3962 "Play a sound when Codex finishes": 220; Gemini #4310 audio notifications: 79; Claude Code #29438 push notification when approval needed: 69 — [CC #50246](https://github.com/anthropics/claude-code/issues/50246), [opencode #16992](https://github.com/anomalyco/opencode/issues/16992), [Codex #3962](https://github.com/openai/codex/issues/3962)
- Parallel agents: the worktree-per-agent pattern is the de-facto answer. "Stale worktrees are the single biggest reason teams give up on the pattern." Claude Code has since added `--worktree/-w` — [Developers Digest](https://www.developersdigest.tech/blog/git-worktrees-claude-code-parallel-agents-guide), [Claude Code docs](https://code.claude.com/docs/en/worktrees). Parallel tool calls also fail in cascades: Claude Code #22264 "parallel tool calls cascade-fail when one fails": 64 — [GitHub](https://github.com/anthropics/claude-code/issues/22264)
- Context visibility: Claude Code #516 "Always show available context percentage": 131; #18456 context % in VS Code: 162; opencode #6152 "Session context usage (like /context in Claude)": 145; Codex #23794 "Desktop no longer shows visible context/token usage indicator": 253 — [CC #516](https://github.com/anthropics/claude-code/issues/516), [opencode #6152](https://github.com/anomalyco/opencode/issues/6152), [Codex #23794](https://github.com/openai/codex/issues/23794)
- MCP context bloat: Claude Code #7336 "Lazy Loading for MCP Servers and Tools (95% context reduction possible)": 109 — [GitHub](https://github.com/anthropics/claude-code/issues/7336)

### Inferences
- The asks behind this cluster: make compaction inspectable and reversible, keep the full transcript searchable after compaction, always show a context meter, and let users steer or queue while the agent is running.
- Resume should be global and searchable, with sessions named, not only tied to the cwd.

### Gaps
- No quantitative data on how often auto-compaction fires or how often users /clear on purpose.

---

## Q5. Cost / usage / rate-limit pain

### Takeaway
This is the most-discussed category by comment volume. The Claude Code usage-limit issues have 1,500+ and 870+ comments, and Codex's "burning tokens" issue has 630. The complaints are about opacity (why was my quota used?), silent changes (cache TTL, per-token cost multipliers), and weekly caps. Users ask for auto-resume after the reset and visible counters.

### Cited Findings
- Claude Code #16157 "Instantly hitting usage limits with Max subscription": 726 reactions, **1,497 comments**, open; #38335 "Max plan session limits exhausted abnormally fast since March 23, 2026": 545, 873 comments, open; #41930 "Widespread abnormal usage limit drain across all paid tiers… multiple root causes": 97 (closed) — [#16157](https://github.com/anthropics/claude-code/issues/16157), [#38335](https://github.com/anthropics/claude-code/issues/38335), [#41930](https://github.com/anthropics/claude-code/issues/41930)
- Claude Code #46829 "Cache TTL silently regressed from 1h to 5m around early March 2026, causing quota and cost inflation": 341 (closed the same day); #53262 "HERMES.md in git commit messages causes requests to route to extra usage billing instead of plan quota": 533 (closed) — [#46829](https://github.com/anthropics/claude-code/issues/46829), [#53262](https://github.com/anthropics/claude-code/issues/53262)
- Weekly caps: Claude Code #9424 "Weekly Usage Limits Making Claude Subscriptions Unusable": 155, 110 comments (closed 2025-11) — [GitHub](https://github.com/anthropics/claude-code/issues/9424)
- Max-plan multiplier dispute: boosts apply to 5-hour sessions, not weekly totals; reported effective ~3.5x (Max 5x) and 6–8x (Max 20x); a June 2026 class action alleges deceptive marketing. The Sept 14 2026 "+25% permanent" increase came one day after a +50% temporary boost ended, a net ~17% cut from what users actually had — [MindStudio](https://www.mindstudio.ai/blog/claude-code-weekly-rate-limit-changes), [explainx](https://explainx.ai/blog/anthropic-claude-code-limits-17-percent-cut-september-2026-august-2026), [morphllm](https://www.morphllm.com/claude-code-usage-limits) (secondary sources; lawsuit details not verified against the court filing)
- Auto-continue asks: Claude Code #13354 "Continue when the session limit reached": 214; #35744 "Auto-continue after subscription rate limit resets": 104; Codex #21073 "Auto-resume CLI session when usage limit resets": 67 — [#13354](https://github.com/anthropics/claude-code/issues/13354), [Codex #21073](https://github.com/openai/codex/issues/21073)
- Codex: #28879 "rate-limit cost per token jumped ~10-20x since June 16, draining the 5h budget in 2-3 prompts": 560, 211 comments; #14593 "Burning tokens very fast": 308, **630 comments**; #34035 "Make the temporary removal of the 5-hour usage limit permanent": 268; #2448 Plus users hitting limits fast: 92; #16423 "Frustrated with arbitrary weekly limit resets": 51 — [#28879](https://github.com/openai/codex/issues/28879), [#14593](https://github.com/openai/codex/issues/14593), [#34035](https://github.com/openai/codex/issues/34035)
- Gemini CLI: #4300 "What is the quota limit?… daily gemini-2.5-pro quota": 52; #24937 "Tracking: 429 / Capacity Issues": 95, open; #1502 429 errors: 94; #2208 "Option to Disable Automatic Model Fallback (Pro to Flash)": 62; #2711 subscription not recognized, falls back to Flash: 50 — [#24937](https://github.com/google-gemini/gemini-cli/issues/24937), [#2208](https://github.com/google-gemini/gemini-cli/issues/2208)
- Truncating tool output to save tokens: Codex #6426 "Replace line-based tool output truncation with token-based limits": 137 — [GitHub](https://github.com/openai/codex/issues/6426)
- Plan and third-party access friction: Claude Code #17118 "Support for OpenCode and Max plan": 1,416; opencode #7410 "Broken Claude Max": 420 (the #1 opencode issue); Crush #457 Claude Max auth: 98 — [CC #17118](https://github.com/anthropics/claude-code/issues/17118), [opencode #7410](https://github.com/anomalyco/opencode/issues/7410)

### Inferences
- The pain is less "limits exist" and more "limits change silently and I can't see why". A local, per-turn token and cost ledger (input/output/cache split, which tool output ate the context) targets the exact complaint.
- Silent model fallback (Gemini Pro to Flash) and silent billing routing (HERMES.md) destroy trust. Any automatic switch has to be announced loudly in the UI.

### Gaps
- No official usage numbers; weekly-cap figures come from secondary blogs.

---

## Q6. Onboarding / setup pain (install, auth, Node/npm, Windows/WSL, config files, MCP)

### Takeaway
The single most-reacted issue across all these repos is about config-file fragmentation: "Support AGENTS.md" in Claude Code, 6,681 reactions. After that come Windows-native problems, XDG/dotfile clutter, auth edge cases (headless/SSH, Workspace accounts), and MCP configuration granularity.

### Cited Findings
- Claude Code #6235 "Feature Request: Support AGENTS.md": **6,681 reactions** (the #1 issue in the repo, closed); #31005 "Support for AGENTS.md and .agents/skills/, the community has been asking since August 2025": 513 (closed 2026-03-05); #34235 AGENTS.md as native context file alongside CLAUDE.md: 134, open — [#6235](https://github.com/anthropics/claude-code/issues/6235), [#31005](https://github.com/anthropics/claude-code/issues/31005), [#34235](https://github.com/anthropics/claude-code/issues/34235)
- Aider #3303 "Cursor Rules support, or equivalent": 37; Gemini CLI #11506 "Add Skill like Claude Code": 165 — [Aider](https://github.com/Aider-AI/aider/issues/3303), [Gemini](https://github.com/google-gemini/gemini-cli/issues/11506)
- XDG/dotfile clutter: Claude Code #1455 "does not respect the XDG Base Directory specification": 451, open since 2025-05; Gemini #1825 "respect XDG specs": 100; Aider #216 config location "modern specifications": 79, #2860 move .aider* files into .aider dir: 26; Crush #254 "should not create a .crush folder as soon as you start it": 26 — [CC #1455](https://github.com/anthropics/claude-code/issues/1455), [Gemini #1825](https://github.com/google-gemini/gemini-cli/issues/1825), [Aider #216](https://github.com/Aider-AI/aider/issues/216)
- Windows: Codex #13993 standalone Windows installer: 258; #2860 permission prompt for every shell command on Windows: 110; #4003 "Patched files have mixed line endings on Windows": 74. Claude Code #4928 "file named nul created on windows": 235. Gemini #11511 39s load on Windows: 78. Claude Code on native Windows needs Git for Windows (it uses Git Bash internally). The WSL1 native-binary "Exec format error" regression was closed as not planned on 2026-07-31. npm install is deprecated in favor of the native installer (June 2026) — [Codex #13993](https://github.com/openai/codex/issues/13993), [Codex #4003](https://github.com/openai/codex/issues/4003), [CC #4928](https://github.com/anthropics/claude-code/issues/4928), [morphllm install guide](https://www.morphllm.com/claude-code-install), [Claude Code setup docs](https://code.claude.com/docs/en/setup)
- Auth: Gemini #1432 "Login Failed: 'Ensure your Google account is not a Workspace account' for a Standard Account": 117; #1437 Google login not supported headless/SSH: 64; #24517 403 for Google One AI Premium subscriber: 65. Claude Code #34229 "Phone verification": 893, open — [Gemini #1432](https://github.com/google-gemini/gemini-cli/issues/1432), [Gemini #1437](https://github.com/google-gemini/gemini-cli/issues/1437), [CC #34229](https://github.com/anthropics/claude-code/issues/34229)
- Multi-account: Claude Code #18435 (Desktop, 995) and #36151 (mobile, 1,028) — not CLI, but the same "work vs. personal account" pain — [#18435](https://github.com/anthropics/claude-code/issues/18435)
- MCP setup and scoping: Claude Code #6915 "MCP tools available only to subagent": 377; #7328 "MCP Tool Filtering: enable/disable individual tools": 225; #4476 agent-scoped MCP config: 183; #1774 quick-toggle MCP servers: 161; #1788 MCP config deleted during auto-update: 11. Codex #2628 project-specific MCPs: 163; #5 MCP support: 285. Aider #3314 "MCP SUPPORT": 244, and #2525: 138 (the top two Aider issues; still open) — [CC #6915](https://github.com/anthropics/claude-code/issues/6915), [CC #7328](https://github.com/anthropics/claude-code/issues/7328), [Aider #3314](https://github.com/Aider-AI/aider/issues/3314)
- Editor/IDE bridging: Crush #990 ACP support: 97; Claude Code #6686 ACP: 552; Codex #8745 LSP integration: 605, open; Gemini #2465 LSP: 132 — [Codex #8745](https://github.com/openai/codex/issues/8745), [CC #6686](https://github.com/anthropics/claude-code/issues/6686)
- Hooks and plan mode are cross-tool "table stakes" asks: Codex #2109 Event Hooks: 689, #2101 Plan Mode: 505; Gemini #4666 Plan Mode: 203 (the #1 Gemini issue), #2779 hooks: 103; Crush #1734 Build/Plan modes: 62 — [Codex #2109](https://github.com/openai/codex/issues/2109), [Gemini #4666](https://github.com/google-gemini/gemini-cli/issues/4666)
- Aider #3030 "Add a way to uninstall in your docs": 38 — [GitHub](https://github.com/Aider-AI/aider/issues/3030)

### Inferences
- Users want one vendor-neutral instruction file (AGENTS.md), config under XDG paths, and no stray dotfolders dropped into the repo. These are cheap to get right and generate outsized goodwill.
- MCP pain is about granularity (per-tool enable, per-agent scoping, lazy loading) more than about the protocol itself.

### Gaps
- Didn't verify whether Claude Code natively reads AGENTS.md as of 2026-09. #6235 and #31005 are closed, but #34235 is still open.

---

## Q7. Which pains have the most reactions / discussion (ranking)

### Takeaway
By reactions and comments, the top UX pains (excluding model quality) are: (1) config-file standardization (AGENTS.md), (2) usage-limit opacity and drain, (3) flicker and scroll-jump, (4) undo/rewind and review, (5) third-party client and plan access, (6) plan mode and hooks, (7) permission matching and approval fatigue, (8) compaction and context visibility, (9) paste and copy handling, (10) IME/CJK.

### Cited Findings (consolidated ranking; reactions summed across top issues, approximate)
| Rank | Pain cluster | Key evidence (reactions) | Tools affected | Status (2026-09) |
|---|---|---|---|---|
| 1 | Instruction-file fragmentation (AGENTS.md vs CLAUDE.md) | CC #6235 6,681; #31005 513; #34235 134 | Claude Code, Aider, Gemini | Main issues closed; follow-up still open |
| 2 | Usage limits: drain, opacity, weekly caps, silent changes | CC #16157 726 (1,497 comments), #38335 545 (873 comments), #53262 533, #46829 341, #13354 214; Codex #28879 560, #14593 308 (630 comments), #34035 268; Gemini #24937 95 | All hosted-plan tools | Mostly open / recurring |
| 3 | Flicker, scroll-to-top, scrollback | CC #3648 836, #826 822, #769 335, #1913 321, #36582 135; Codex #2558 134; Gemini #14708 32 | CC (worst), Codex, Gemini | CC: 85% reduction (Dec 2025) plus opt-in NO_FLICKER; #826/#769/#1913 still open |
| 4 | Undo/rewind and diff review | Codex #9203 513, #2998 236, #11626 225; CC #33932 276, #353 178, #37951 102 | Codex, CC | Codex /undo missing; CC /rewind has edge cases |
| 5 | Third-party client / subscription access | CC #17118 1,416; opencode #7410 420; Crush #457 98 | opencode, Crush | Closed |
| 6 | Plan mode / hooks | Codex #2109 689, #2101 505; Gemini #4666 203 | Codex, Gemini, Crush | Largely shipped |
| 7 | Permission matching and approval fatigue; sensitive-file exclusion | Codex #2847 466, #2860 110; CC #28240 207, #16561 176, #30519 80; stat: 93% of prompts approved | All | CC compound parsing closed 2026-08 |
| 8 | Agent proceeds without answer (60s auto-resolve) | CC #73125 414; Codex #28969 214 | CC, Codex | CC closed; Codex open |
| 9 | XDG / dotfile clutter | CC #1455 451; Gemini #1825 100; Aider #216 79 | All | CC open |
| 10 | MCP granularity / context bloat | CC #6915 377, #7328 225, #4476 183, #7336 109; Aider #3314 244 | All | Mixed |
| 11 | Paste collapse / copy artifacts | opencode #8501 326; CC #3412 309, #18170 296, #23134 160, #15199 106; opencode #4283 130 | CC, opencode | Mostly open |
| 12 | Queue/steer/side-question while running; completion notifications | opencode #16992 399; CC #50246 248; Codex #3962 220 | All | Mixed |
| 13 | IME / CJK | CC #1547 261, #8405 95; Gemini #1796 191; many Korean duplicates | CC, Codex, Gemini | CC #1547 open; Korean reports still being filed |
| 14 | Compaction and context visibility | Codex #23794 253, #11325 156, #4106 125; CC #18456 162, #516 131, #17428 117, #7530 100, #27242 89; opencode #6152 145 | All | Mixed |
| 15 | Destructive actions (rm -rf $HOME, file wipes) | Gemini #26856 170; CC five or more rm -rf-on-$HOME reports (2025-10 to 2026-09) plus press coverage | CC, Gemini | Still recurring in auto mode (2026-09) |
| 16 | Memory leaks / hangs | CC #26224 152, #4953 78, #11315 58; opencode #20695 171; Gemini #22141 164 | All | Open |

Model-behavior complaints bleed into UX and top the Claude Code charts, but are out of scope here: CC #42796 "unusable for complex engineering tasks with the Feb updates": 3,287; #3382 "You're absolutely right!": 1,371 — [#42796](https://github.com/anthropics/claude-code/issues/42796), [#3382](https://github.com/anthropics/claude-code/issues/3382)

### Inferences
- For a minimal, own-identity CLI agent (alpine-code), these would be high-leverage, low-cost differentiators: flicker-free rendering that respects native scrollback; clean copyable output; correct Korean IME; paste blocks you can expand and edit; AGENTS.md support and XDG config; a visible context and token meter with a per-turn cost ledger; undo that covers shell edits; permissions that parse compound commands and hard-block paths outside the project/$HOME; never auto-proceeding on questions; message queueing and completion notifications.
- Mascot and personality features are divisive. CC #45596 (2,095 reactions to bring Buddy back) shows strong attachment, while Gemini #5674 shows backlash when whimsy ships before bug fixes.

### Gaps
- Reddit (r/ClaudeAI, r/codex) threads weren't fetched directly; search returned blog aggregators instead. Sentiment evidence leans on GitHub and HN.
- Amp got no coverage (no public issue tracker found in this pass). Crush evidence is thin; its issues are mostly feature requests with modest reactions.
- Reaction totals are a snapshot on 2026-09-28 and are biased by each repo's audience size.
