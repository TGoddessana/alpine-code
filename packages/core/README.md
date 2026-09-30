# alpine-code-core

The UI-agnostic agent core (`alpine_core`): agent loop, tools, permissions, prompt, config. Every app drives it; it
knows none of them.

```
src/alpine_core/
  session.py     Session — the one object a frontend drives
  events.py      what the core reports (TurnStarted, TextDelta, ToolFinished, ...)
  approval.py    Approver protocol — how the core asks a frontend for permission
  loop.py        the alpineagents @loop: compact → think → permission gate → use tools
  bridge.py      alpineagents Reporter → core events
  permissions.py what runs without asking, what "don't ask again" remembers
  shell.py       bash command analysis (tree-sitter) for permissions
  tools/         one module per tool
```

A frontend gives `Session` two things — an `on_event` callback and an `Approver` — and calls `send(text)`. It
imports only from `alpine_core`, never from alpineagents or core submodules. The core may not import any app, the
protocol, `rich` or `prompt_toolkit`; `uv run lint-imports` checks this.
