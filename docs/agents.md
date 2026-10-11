# Agents

An agent is a model, instructions and the tools it may use, with a name and a face. The user builds agents on one
screen and puts one to work on a project, the way a new hire is put on a team. Agents replace profiles
(`alpine_core/profiles.py`), the Settings › 도구 tab and the separate tool editor page. Decided one question at a time
on 2026-10-09 and built the same day. 스킬, MCP and 서브에이전트 are 준비 중: the screen shows them, nothing
else yet.

Why: people who are not developers do not know what a tool is, and they got stuck in the profile screen, whose
precedence rule (project and model → project → model → default) explains nothing they care about. One agent per
profile, built like a character, shows that an agent is a loop with tools: add a tool and the agent can do one more
thing; remove it and it can't.

Design canvas: https://claude.ai/artifact/5hUaLZdmudJJXxUQtvzViW (boards 에이전트 화면, 새 에이전트, 새 세션, 세션 중에
바뀌는 것, 캐릭터 그림, 캐릭터 모음).

## What the others do

| | Claude Code subagents | ChatGPT GPTs | Cursor modes |
|---|---|---|---|
| What one holds | tools, model, prompt (`.claude/agents/*.md`) | instructions, knowledge, actions | tools and instructions |
| Who picks it | the user, or the main agent hands work to it | the user, before the chat | the user, in the composer |
| Automatic choice by project or model | no | no | no |

None of them picks a configuration from where the user is working, which is what profiles did.

## Decisions

1. **What an agent holds.** A name, a description, a model, instructions (지침) and tools. The user picks the agent
   for each session in the composer; each project remembers the agent it used last, and a new session there starts
   with it. There is no automatic matching by project or model.
2. **What it does not hold.** Safety (the permission mode) belongs to the session and keeps its own composer chip.
   Memory belongs to the project. An agent is a capable new hire put on a project: whoever is put on it works under
   the project's rules and reads the project's memory. Both were first given to the agent and then moved out.
3. **Kinds of tools, by their standard names.** The UI uses the words people meet elsewhere, never made-up ones:
   - 기본 도구: read, glob, grep, write, edit, bash. On by default; each can be removed and added back.
   - 사용자 정의 도구: the user's Python tools (`~/.alpine-code/tools`), as built on 2026-09-30.
   - 스킬: a name and description the agent always sees, and a body it reads when it judges it needs it.
   - MCP: a service connected once; its tools can be picked one by one per agent.
   - 서브에이전트: another agent from the user's list, which the main agent can hand work to and get results from.

   스킬, MCP and 서브에이전트 are shown as 준비 중 (a row with one line of explanation, a disabled menu item) until
   they are built. Words like 장비, 끼우기, 책, 친구 were tried and dropped as game words or off-standard.
4. **A library shared by every agent.** Everything the user owns (their tools, skills, connected services, other
   agents) is in one library; each agent picks from it. The same tool can be on several agents. Adding is dragging a
   card onto the agent, or the card's + 추가 button.
5. **One screen.** A top-level rail item 에이전트 opens it. Settings › 도구 and `/settings/tools/$name` go away. The
   left side is the agent being edited; the right side is the library, and opening any item (to read or change a
   tool's code, a skill's body, an MCP server's tools) replaces the library in place, with ← 라이브러리 to go back.
   Creating is visible where it is needed: each row has 새로 만들기 (사용자 정의 도구), 새로 쓰기 (스킬), 새로 연결
   (MCP) next to 라이브러리에서 추가, and the library starts with a + 새로 만들기 card.
6. **Layout.** A top strip lists the agents (avatar, name, model, tool count) and 새 에이전트. Under it, a header
   with the agent's drawn character, its name and its description, then rows that all share one shape, label and
   note on the left and content on the right: 모델, 지침, 기본 도구, 사용자 정의 도구, 스킬, MCP, 서브에이전트. Added
   items are tiles that say what clicking does (코드 보기 · 고치기 ›) and have × to remove. A derived "할 수 있는
   것" summary was drawn and removed: it repeated the rows under it. Slots arranged around the character were drawn
   and removed: two settings beside the picture and the rest below it read as inconsistent.
7. **Game feel without game words.** Each agent has a drawn character; dragging a card turns the agent's side into
   a drop area showing the character and "여기에 놓으면 ○○를 홈페이지 담당에 추가해요"; an added tile lights up
   briefly; a toast with the character says what was added or removed, with 되돌리기.
8. **When things are saved.**

   | Change | Saved | Shown |
   |---|---|---|
   | adding or removing a tool, skill, MCP server or subagent | at once | the toast, and ✓ 저장됨 in the header |
   | name and description | on Enter (Esc cancels) | ✓ 저장됨 |
   | a tool's code, a skill's body | on the 저장 button | ✓ 저장했어요 inside the editor |

   The header reads 바꾸면 바로 저장돼요 until something is saved. Code keeps an explicit save because only code
   saved through the app, and checked, runs (the hash approval of 2026-09-30); half-edited code must never save
   itself. Name and description are edited in place as bare text (no box, no white field), both from one pencil
   next to them.
9. **Switching agents during a session.** Allowed. The project, the conversation and the safety setting stay; the new
   agent reads the conversation so far. A divider in the chat says so: "꼼꼼한 검토자로 바꿨어요 · 프로젝트, 대화,
   안전 설정은 그대로예요", and each answer carries the avatar and name of the agent that wrote it.
10. **Editing an agent that is working.** The change applies from the next message in each session that uses it,
    never in the middle of an answer (a tool removed mid-call would break the run). No confirmation dialog: nothing
    breaks and adding or removing can be undone, so a dialog would only teach people to click through. Instead the
    agent screen shows "● 지금 일하는 중 · <sessions> — 바꾼 내용은 그 세션의 다음 메시지부터 적용돼요", and the
    chat gets a divider before the next answer: "홈페이지 담당 설정이 바뀌었어요 · 웹 페이지 읽기 추가 · 이 메시지부터
    적용돼요 · 보기". Cost: tools and instructions sit at the start of the prompt, so the next message after a change
    misses the prompt cache once and reads the whole conversation at full price; later messages are cached again.
    Changing the model drops the cache entirely, as switching agents does. Name and description are not sent to the
    model, so changing them costs nothing (until subagents, whose descriptions the main agent reads).
11. **Moving profiles to agents.** Each profile becomes an agent with the same id, name and tools. A profile's model
    becomes the agent's model (none: the current default model). A profile's project records that agent as the
    project's last used one, so new sessions there start as before. The default profile becomes 기본 에이전트.
    Sessions saved with a profile id open with the agent of that id. What is lost: switching tools automatically
    when the model changes within a project. Few people have profiles (they shipped as experimental on 2026-09-30,
    the first release on 2026-10-05), so this costs little.

12. **The character.** Picked from figures Alpine draws: 12 looks (안테나, 안전모, 안경, 베레모, 헤드폰, 야구모자, 요리사
    모자, 새싹, 리본, 비니, 나비넥타이, 학사모) in 8 colours (the five avatar colours plus 청록, 회색, 살구). A new agent
    gets a look and colour no other agent has; clicking the character (a small pencil on its corner) opens a picker,
    and a pick is saved at once. No uploads: photos and emoji would break the screen's one look. More looks can be
    added later without changing anything else.
13. **Instructions (지침): where and how long.** Edited in place in the 지침 row, as bare text like the name; it is
    several lines, so Enter is a new line and leaving the field saves. Under it: the length in characters and
    "메시지마다 읽어요"; past 2,000 characters a yellow line adds "길어요 · 길수록 메시지마다 비용이 늘어요". No limit:
    the cost is a fact worth showing, while a cap would mostly guard against weak models that lose long
    instructions. Once skills exist, the line suggests moving long parts into a skill, read only when needed.
14. **Instructions next to project rules.** The model gets each text with where it came from and what it is for,
    and no sentence saying which one wins: the project's AGENTS.md is the project's working rules; the agent's
    instructions are the role and way of working the user gave this agent. The model judges a conflict and asks
    the user when it can't tell. Example: project rules say "commit when done", the reviewer's instructions say
    "don't change files, only comment"; a "project rules win" sentence could push the reviewer to commit, while
    labelled sources let it see the rule is for whoever does the work. What must hold is enforced by tools, not
    words (the reviewer has no write tools), and what the user says in the chat comes before both. Codex writes an
    order into its prompt (deeper AGENTS.md, then the user's own messages, win) and Claude Code wraps CLAUDE.md in
    "these instructions override default behavior"; an order sentence is mostly a weak-model reason, so it is left
    out.
15. **Starting points for a new agent.** 새 에이전트 offers four, each filling name, description, character,
    instructions and which 기본 도구 are on (user tools, skills, MCP and subagents differ per user or don't exist
    yet, so starting points never include them); the model is picked in the same dialog:

    | Starting point | 기본 도구 | 지침 |
    |---|---|---|
    | 빈 에이전트 | all six | empty |
    | 만드는 사람 · 웹사이트나 앱을 만들고 고쳐요 | all six | 바꾸기 전에 무엇을 바꿀지 먼저 말해 줘. 끝나면 화면에서 어떻게 보이는지 알려 줘. |
    | 검토하는 사람 · 고치지 않고 읽고 의견을 줘요 | 파일 읽기, 파일 찾기, 내용 검색 | 파일은 고치지 말고 의견만 적어 줘. 꼭 고칠 것과 취향인 것을 나눠 줘. |
    | 글 쓰는 사람 · 소개 글, 안내문, 블로그 글을 써요 | all but 명령 실행 | 쉬운 말로, 짧은 문장으로 써 줘. |

    The dialog also links 지금 있는 에이전트를 복제할래요. Describing an agent in words and letting the model fill it
    in was considered and left for later.

## What was built

Core (`packages/core/src/alpine_core`):

- `agents.py`: `AgentConfig` (id, name, description, model, instructions, tools, look, colour) and `AgentList`, kept
  in `~/.alpine-code/agents.json`. The default agent (`default`) always exists and comes first; it cannot be deleted.
  A new agent gets a look and colour no other agent has (`free_character`). Deleting a user tool turns it off in
  every agent (`forget_tools`).
- The decision-11 migration runs the first time the list is read with no `agents.json`: each profile in
  `profiles.json` becomes an agent with its id, name, model and tools, and a free character; the default profile
  becomes the default agent with an empty name (the app shows 기본 에이전트). Each project keeps one of its profiles
  as `last_agent` (the one with no model if several). `profiles.json` is left where it is, and `profiles.py` is gone.
- `projects.py`: `Project.last_agent` and `ProjectList.set_agent`.
- `prompt.py`: `build_system_prompt(cwd, memory, instructions)` labels each text by where it came from and says
  nothing about which one wins (decision 14). The headers are `# Instructions from <path>` with "The project's
  working rules, for whoever works in it." (for `~/.alpine-code/AGENTS.md`: "The user's own rules for every
  project."), then `# Instructions for this agent` with "The role and way of working the user gave this agent."
- `session.py`: `Session` takes `agents` and `agent`, and `tools`, the folder's tool sources (`tool_sources.py`: the
  built-ins, the project's memory, the user's toolbox; built-ins only unless told otherwise). A new session starts
  with that agent, else the project's `last_agent`, else the default agent; a saved one reopens with its own agent.
  The agent brings its model (unless `model` is given) and its instructions, and picks its tools from what the
  sources offer (`pick(gather(sources), agent.tools)`): an optional tool (built-in or user) only if the agent names
  it, a non-optional one (the memory's `propose_memory`) always. Without agents the session gets every offered tool.
  `set_agent` switches between turns (not during a run), records an `agent_switched` item and remembers the agent
  in the project. Before each message `_refresh_agent` takes edits made since the last one: a deleted agent becomes
  the default agent; a change to tools, instructions or model rebuilds the agent and, once the conversation has
  begun, adds an `agent_changed` item; name, description and look only update what the session knows. The tool diff
  counts only tools an agent can turn on or off, so naming a non-optional tool never adds a divider.
- `items.py`: `AgentSwitched`, `AgentChanged`, and `AgentMessage.agent`, the id of the agent that wrote the answer.
- `SessionInfo.agent` is the session's agent id; `agent_applied` (model, instructions, tools as last applied) is
  saved with the session so that it reopens as it was and the next edit shows as a change. Core only: it is not
  in the protocol's session info.

Protocol (`packages/protocol`, version 2) and server (`apps/server`):

- `agents/list`, `agents/save` (an empty id adds) and `agents/delete`; `session/setAgent` (`sessionId`, `agent`; error
  `agent_not_found`, and an error while the session runs); `session/new` takes `agent`; `SessionInfo.agent`; the
  items `agent_switched` and `agent_changed`; `agent` on `agent_message`. Tool methods take an agent id where they
  used a profile id.
- `alpine_server/agents.py` serves `agents/*` over `AgentList`; `sessions.py` gives sessions the agent list and
  `SessionManager.tool_sources(project)` (built-ins, the project's memory, the toolbox), and handles
  `session/setAgent`. `tools/list` (optional `cwd`) is answered by `SessionManager` from the same sources, as
  `tools: OfferedTool[]` with each tool's `origin` (`builtin`, `memory`, `user`) and `optional`, so the agents screen
  shows what a session gets.

Desktop (`apps/desktop/src`):

- A rail item 에이전트 and the route `/agents` (`?agent=<id>`, `?create`). Settings › 도구 and
  `/settings/tools/$name` are gone, with `settings/Tools.tsx` and the old editor files.
- `features/agents/`: the strip of agents, the header (character, name, description, 저장됨 and the working-now line),
  the rows (기본 도구 lists the non-user tools from `tools/list`; a non-optional one, 기억 제안, is a locked tile
  marked 항상 켜짐 with no ×), the character picker, the 새 에이전트 dialog with its four starting points (`starts.ts`), and a toast with
  되돌리기. `features/agents/library/` is the library: cards, drag and drop onto the agent, and the tool editor
  folded in as a detail view with ← 라이브러리 (`code.tsx` is the old editor's code part). 스킬, MCP and 서브에이전트
  are 준비 중 rows and disabled menu items.
- `shared/components/agent/`: the drawn `Character` (12 looks in `looks.ts`, 8 colours; tokens `avatar-6` to
  `avatar-8` in `packages/ui/src/tokens.css`), agent names and the words of the tools.
- `shared/components/composer/`: `AgentChip` replaces `ProfileChip` and sits beside the safety chip (`ModeChip`);
  `ModelPicker` is controlled now (`value`, `onChange`, `allowDefault`), used by the model row and the new-agent
  dialog as well as the composer.
- `features/session/Chat.tsx`: the `agent_switched` and `agent_changed` dividers, and the avatar and name on each
  answer.

The CLI has no agents: its sessions get every tool their sources offer (the built-ins and the project's memory).

## Open

- 스킬, MCP and 서브에이전트 themselves, each its own design and outside this one.
