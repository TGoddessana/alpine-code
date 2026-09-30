import type { Activity, ApprovalItem, SessionInfo, ToolCallItem, Usage } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script, ScriptContext } from './scripted';
import { applyEvent, toSnapshot, type Item, type SessionEvent, type SessionState } from './sessionState';

export const SESSION_NOT_FOUND = -32001;
export const SESSION_RUNNING = -32002;

export interface SessionScriptOptions {
  /** Sessions that exist at the start, with their finished items. */
  sessions?: { info: SessionInfo; items?: Item[] }[];
  /** Milliseconds between the steps of a run. `0` (the default) makes a run go as fast as promises allow, for tests. */
  stepMs?: number;
  /** Milliseconds between the words of a streamed reply; defaults to `stepMs`. */
  wordMs?: number;
  /**
   * When given, every run only streams this reply, the way models deliver text: small pieces in bursts with pauses
   * between them (`wordMs` per piece on average). For seeing long markdown stream in.
   */
  reply?: string;
}

/** A session info with sensible values, for scripts and stories. */
export function sessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
  const now = new Date().toISOString();
  return {
    id: 's-0',
    title: '',
    cwd: '/Users/me/alpine-code',
    model: 'anthropic/claude-sonnet-5',
    mode: 'default',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, cost: 0 },
    contextUsed: 0,
    contextWindow: 200_000,
    activity: null,
    runStartedAt: null,
    runUsage: null,
    profile: 'default',
    ...overrides,
  };
}

interface Live {
  state: SessionState;
  /** The run in progress, if any. */
  run: { cancelled: boolean; wake: (() => void) | null } | null;
  /** The approval waiting for an answer. */
  waiting: {
    id: string;
    answer: (decision: NonNullable<ApprovalItem['decision']>, feedback: string | null) => void;
  } | null;
  counter: number;
}

class Cancelled extends Error {}

const ANSWER = 'I read the README, then ran the check you asked for. ';

/**
 * A simulated server for the session methods. `session/send` runs a script of a turn:
 *
 * 1. the user's message, then a streamed reply that says what the agent will do
 * 2. a tool call that reads a file, which finishes at once
 * 3. a call that needs approval, an `approval` item (`edit_file` with a diff if the message mentions "edit",
 *    otherwise `bash`), which waits for `session/answer` or `session/cancel`
 * 4. a final streamed reply, and the session is idle again
 *
 * Along the way `info` changes as on the real server: the activity (thinking, writing, a tool, waiting for approval),
 * `runStartedAt`, and the usage after every model call (`runUsage` for the run, `usage` and `contextUsed` for the session).
 *
 * A denial with feedback goes on to the final reply; one without it ends the run with `run_stopped: permission`.
 * `session/cancel` ends the run with `run_stopped: interrupted` wherever it is.
 */
export function sessionScript(options: SessionScriptOptions = {}): Script {
  const stepMs = options.stepMs ?? 0;
  const wordMs = options.wordMs ?? stepMs;
  const sessions = new Map<string, Live>();
  let nextSession = 1;

  for (const { info, items = [] } of options.sessions ?? [])
    sessions.set(info.id, {
      state: { info, seq: 0, items, activeIds: [], deleted: false },
      run: null,
      waiting: null,
      counter: 0,
    });

  const find = (id: string): Live => {
    const live = sessions.get(id);
    if (!live) throw new ServerError(SESSION_NOT_FOUND, `No session ${id}`);
    return live;
  };

  const sleep = (ms: number) => (ms > 0 ? new Promise<void>((done) => setTimeout(done, ms)) : Promise.resolve());

  function emit(context: ScriptContext, live: Live, event: SessionEvent) {
    if (live.state.deleted) return;
    const seq = live.state.seq + 1;
    const params = { sessionId: live.state.info.id, seq, event };
    const next = applyEvent(live.state, params);
    if (typeof next === 'string') throw new Error('unreachable: the script numbers its own events');
    live.state = next;
    context.emit({ method: 'session/event', params });
  }

  function setInfo(context: ScriptContext, live: Live, changes: Partial<SessionInfo>) {
    emit(context, live, {
      type: 'info_changed',
      info: { ...live.state.info, ...changes, updatedAt: new Date().toISOString() },
    });
  }

  /** What the agent is doing now, since now; `null` when idle. */
  function setActivity(
    context: ScriptContext,
    live: Live,
    kind: Activity['kind'] | null,
    toolName: string | null = null,
  ) {
    setInfo(context, live, {
      activity: kind ? { kind, toolName, since: new Date().toISOString() } : null,
    });
  }

  /** One request to the model: it adds tokens to the whole session and to this run, and the conversation grows. */
  function modelCall(
    context: ScriptContext,
    live: Live,
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number },
  ) {
    const add = (usage: Usage): Usage => ({
      inputTokens: usage.inputTokens + tokens.input,
      outputTokens: usage.outputTokens + tokens.output,
      cacheReadTokens: usage.cacheReadTokens + tokens.cacheRead,
      cacheWriteTokens: usage.cacheWriteTokens + tokens.cacheWrite,
      requests: usage.requests + 1,
      cost: (usage.cost ?? 0) + 0.0031,
    });
    const { info } = live.state;
    setInfo(context, live, {
      usage: add(info.usage),
      runUsage: info.runUsage ? add(info.runUsage) : null,
      contextUsed: info.contextUsed + tokens.output + tokens.cacheWrite,
    });
  }

  const id = (live: Live, prefix: string) => `${live.state.info.id}/${prefix}_${++live.counter}`;

  async function run(context: ScriptContext, live: Live, text: string) {
    const control = { cancelled: false, wake: null as (() => void) | null };
    live.run = control;
    const step = async (ms = stepMs) => {
      await sleep(ms);
      if (control.cancelled) throw new Cancelled();
    };
    const say = async (
      reply: string,
      pieces = (reply.match(/\S+\s*/g) ?? []).map((text) => ({ text, ms: wordMs })),
    ) => {
      const message: Item = { id: id(live, 'msg'), kind: 'agent_message', text: '' };
      emit(context, live, { type: 'item_started', item: message });
      let streamed = '';
      try {
        for (const piece of pieces) {
          await step(piece.ms);
          streamed += piece.text;
          emit(context, live, { type: 'item_delta', itemId: message.id, text: piece.text });
        }
      } finally {
        // A reply cut short is kept as far as it got.
        emit(context, live, { type: 'item_completed', item: { ...message, text: streamed } });
      }
    };

    const first = live.state.info.title === '';
    setInfo(context, live, {
      status: 'running',
      title: first ? shorten(text) : live.state.info.title,
      runStartedAt: new Date().toISOString(),
      runUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, requests: 0, cost: 0 },
      activity: { kind: 'thinking', toolName: null, since: new Date().toISOString() },
    });
    const user: Item = { id: id(live, 'user'), kind: 'user_message', text };
    emit(context, live, { type: 'item_started', item: user });
    emit(context, live, { type: 'item_completed', item: user });

    if (options.reply !== undefined) {
      try {
        await step();
        setActivity(context, live, 'writing');
        await say(options.reply, bursts(options.reply, wordMs));
        modelCall(context, live, { input: 1800, output: 900, cacheRead: 0, cacheWrite: 1500 });
      } catch (error) {
        if (!(error instanceof Cancelled)) throw error;
      }
      finish(context, live, 'idle');
      return;
    }

    let read: ToolCallItem | null = null;
    let call: ToolCallItem | null = null;
    let approval: ApprovalItem | null = null;
    try {
      await step();
      setActivity(context, live, 'writing');
      await say('Let me look at the project first.');
      modelCall(context, live, { input: 1800, output: 40, cacheRead: 0, cacheWrite: 1500 });
      setActivity(context, live, 'running_tool', 'read_file');
      await step();
      read = {
        id: id(live, 'call'),
        kind: 'tool_call',
        name: 'read_file',
        args: { path: 'README.md' },
        status: 'running',
        result: null,
        images: 0,
      };
      emit(context, live, { type: 'item_started', item: read });
      await step();
      read = { ...read, status: 'done', result: '# alpine-code\n\nA coding agent with a core and a UI.\n' };
      emit(context, live, { type: 'item_completed', item: read });
      read = null;
      setActivity(context, live, 'thinking');
      await step();
      modelCall(context, live, { input: 300, output: 90, cacheRead: 1500, cacheWrite: 350 });

      const editing = /\bedit\b/i.test(text);
      call = {
        id: id(live, 'call'),
        kind: 'tool_call',
        name: editing ? 'edit_file' : 'bash',
        args: editing ? { path: 'README.md' } : { command: 'pnpm test' },
        status: 'running',
        result: null,
        images: 0,
      };
      emit(context, live, { type: 'item_started', item: call });
      setActivity(context, live, 'running_tool', call.name);
      await step();
      approval = {
        id: id(live, 'req'),
        kind: 'approval',
        callId: call.id,
        title: editing ? 'Edit README.md' : 'Run a command',
        preview: editing ? '-A coding agent with a core and a UI.\n+A coding agent for your desktop.' : 'pnpm test',
        previewKind: editing ? 'diff' : 'command',
        reason: editing ? null : 'Runs a command in your project',
        remember: editing ? 'Edits to README.md' : 'pnpm test',
        decision: null,
        feedback: null,
      };
      emit(context, live, { type: 'item_started', item: approval });
      setInfo(context, live, {
        status: 'waiting',
        activity: { kind: 'waiting_approval', toolName: call.name, since: new Date().toISOString() },
      });

      const answer = await new Promise<{ decision: NonNullable<ApprovalItem['decision']>; feedback: string | null }>(
        (resolve) => {
          live.waiting = { id: approval!.id, answer: (decision, feedback) => resolve({ decision, feedback }) };
          control.wake = () => resolve({ decision: 'deny', feedback: null });
        },
      );
      live.waiting = null;
      control.wake = null;
      approval = { ...approval, decision: answer.decision, feedback: answer.feedback };
      emit(context, live, { type: 'item_completed', item: approval });
      if (control.cancelled) {
        // Stopped at the approval: the call they stopped is denied.
        emit(context, live, { type: 'item_completed', item: { ...call, status: 'denied' } });
        call = null;
        throw new Cancelled();
      }
      setInfo(context, live, {
        status: 'running',
        activity: { kind: 'running_tool', toolName: call.name, since: new Date().toISOString() },
      });

      if (answer.decision === 'deny') {
        call = { ...call, status: 'denied' };
        emit(context, live, { type: 'item_completed', item: call });
        call = null;
        if (!answer.feedback) {
          emit(context, live, {
            type: 'item_completed',
            item: { id: id(live, 'stop'), kind: 'run_stopped', reason: 'permission', message: null },
          });
          finish(context, live, 'idle');
          return;
        }
      } else {
        await step();
        call = { ...call, status: 'done', result: editing ? 'Edited README.md' : 'Tests passed (12)' };
        emit(context, live, { type: 'item_completed', item: call });
        call = null;
      }
      setActivity(context, live, 'thinking');
      await step();
      modelCall(context, live, { input: 200, output: 60, cacheRead: 1850, cacheWrite: 120 });
      setActivity(context, live, 'writing');
      await say(ANSWER + (answer.feedback ? `You said: ${answer.feedback}` : 'Everything looks fine.'));
      modelCall(context, live, { input: 150, output: 80, cacheRead: 1970, cacheWrite: 0 });
      finish(context, live, 'idle');
    } catch (error) {
      if (!(error instanceof Cancelled)) throw error;
      if (live.state.deleted) return;
      // The tool calls stopped in the middle are interrupted, then the run says why it ended.
      for (const running of [read, call]) {
        if (running && live.state.activeIds.includes(running.id))
          emit(context, live, { type: 'item_completed', item: { ...running, status: 'interrupted' } });
      }
      if (approval && live.state.activeIds.includes(approval.id))
        emit(context, live, { type: 'item_completed', item: { ...approval, decision: 'deny' } });
      emit(context, live, {
        type: 'item_completed',
        item: { id: id(live, 'stop'), kind: 'run_stopped', reason: 'interrupted', message: null },
      });
      finish(context, live, 'idle');
    }
  }

  function finish(context: ScriptContext, live: Live, status: SessionInfo['status']) {
    live.run = null;
    live.waiting = null;
    setInfo(context, live, { status, activity: null, runStartedAt: null, runUsage: null });
  }

  return {
    results: {
      'session/new': ({ cwd, model, mode }, context) => {
        const info = sessionInfo({
          id: `s-${nextSession++}`,
          cwd,
          ...(model ? { model } : {}),
          ...(mode ? { mode } : {}),
        });
        const live: Live = {
          state: { info, seq: 0, items: [], activeIds: [], deleted: false },
          run: null,
          waiting: null,
          counter: 0,
        };
        sessions.set(info.id, live);
        emit(context, live, { type: 'info_changed', info });
        return { info };
      },
      'session/list': () => ({
        sessions: [...sessions.values()]
          .map((live) => live.state.info)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }),
      'session/open': ({ sessionId }) => toSnapshot(find(sessionId).state),
      'session/send': ({ sessionId, text }, context) => {
        const live = find(sessionId);
        if (live.run) throw new ServerError(SESSION_RUNNING, 'The session is running');
        live.run = { cancelled: false, wake: null };
        // Starts after the answer, so the first events come after `{}` like on the real server.
        void Promise.resolve().then(() => run(context, live, text));
        return {};
      },
      'session/cancel': ({ sessionId }) => {
        const live = find(sessionId);
        if (live.run) {
          live.run.cancelled = true;
          live.run.wake?.();
        }
        return {};
      },
      'session/answer': ({ sessionId, requestId, decision, feedback }) => {
        const live = find(sessionId);
        if (live.waiting?.id !== requestId) return { accepted: false };
        live.waiting.answer(decision, feedback ?? null);
        return { accepted: true };
      },
      'session/setMode': ({ sessionId, mode }, context) => {
        const live = find(sessionId);
        setInfo(context, live, { mode });
        return { info: live.state.info };
      },
      'session/delete': ({ sessionId }, context) => {
        const live = find(sessionId);
        if (live.run) {
          live.run.cancelled = true;
          live.run.wake?.();
        }
        emit(context, live, { type: 'deleted' });
        sessions.delete(sessionId);
        return {};
      },
    },
  };
}

/**
 * `text` cut into pieces of a few characters (about a token each), sent in bursts: a burst of 4 to 30 pieces arrives
 * at once after a pause as long as its pieces would take one by one. The same text always gives the same bursts.
 */
function bursts(text: string, pieceMs: number): { text: string; ms: number }[] {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pieces: { text: string; ms: number }[] = [];
  let at = 0;
  while (at < text.length) {
    const count = 4 + Math.floor(random() * 27);
    for (let i = 0; i < count && at < text.length; i++) {
      const size = 2 + Math.floor(random() * 3);
      pieces.push({ text: text.slice(at, at + size), ms: i === 0 ? pieceMs * count : 0 });
      at += size;
    }
  }
  return pieces;
}

function shorten(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
