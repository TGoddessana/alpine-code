import type { ApprovalItem, SessionInfo, ToolCallItem } from '@alpine/protocol';

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
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0, cost: 0 },
    contextUsed: 0,
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

  const id = (live: Live, prefix: string) => `${live.state.info.id}/${prefix}_${++live.counter}`;

  async function run(context: ScriptContext, live: Live, text: string) {
    const control = { cancelled: false, wake: null as (() => void) | null };
    live.run = control;
    const step = async (ms = stepMs) => {
      await sleep(ms);
      if (control.cancelled) throw new Cancelled();
    };
    const say = async (reply: string) => {
      const message: Item = { id: id(live, 'msg'), kind: 'agent_message', text: '' };
      emit(context, live, { type: 'item_started', item: message });
      const words = reply.match(/\S+\s*/g) ?? [];
      let streamed = '';
      try {
        for (const word of words) {
          await step(wordMs);
          streamed += word;
          emit(context, live, { type: 'item_delta', itemId: message.id, text: word });
        }
      } finally {
        // A reply cut short is kept as far as it got.
        emit(context, live, { type: 'item_completed', item: { ...message, text: streamed } });
      }
    };

    const first = live.state.info.title === '';
    setInfo(context, live, { status: 'running', title: first ? shorten(text) : live.state.info.title });
    const user: Item = { id: id(live, 'user'), kind: 'user_message', text };
    emit(context, live, { type: 'item_started', item: user });
    emit(context, live, { type: 'item_completed', item: user });

    let read: ToolCallItem | null = null;
    let call: ToolCallItem | null = null;
    let approval: ApprovalItem | null = null;
    try {
      await say('Let me look at the project first.');
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
      setInfo(context, live, { status: 'waiting' });

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
      setInfo(context, live, { status: 'running' });

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
      await say(ANSWER + (answer.feedback ? `You said: ${answer.feedback}` : 'Everything looks fine.'));
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
    const { usage } = live.state.info;
    live.run = null;
    live.waiting = null;
    setInfo(context, live, {
      status,
      contextUsed: live.state.info.contextUsed + 1200,
      usage: {
        ...usage,
        inputTokens: usage.inputTokens + 1200,
        outputTokens: usage.outputTokens + 180,
        requests: usage.requests + 2,
        cost: usage.cost + 0.0082,
      },
    });
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

function shorten(text: string): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}
