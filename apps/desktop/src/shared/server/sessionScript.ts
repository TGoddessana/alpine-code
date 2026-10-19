import type {
  Activity,
  AgentInfo,
  ApprovalItem,
  ExternalSessionInfo,
  ProjectInfo,
  SessionInfo,
  ToolCallItem,
  Usage,
} from '@alpine/protocol';

import { ServerError } from './connection';
import type { Judgement, TemplateId } from './newProjects';
import { agentStore, type AgentStore } from './toolsScript';
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
  /** The agents and the projects' last agents, shared with `toolsScript` so a session sees the agents as edited. */
  agents?: AgentStore;
  /** Conversations Claude Code and Codex had, offered in every folder; importing one makes a short session of it. */
  importable?: ExternalSessionInfo[];
  /** How `projects/judge` and `projects/create` answer (stand-ins for the model and for making the folder). */
  newProject?: NewProjectScript;
}

/**
 * The new-session screen's two questions to the server. `projects/judge` is a stand-in for the model, not product
 * code: a few rules decide work on the project or a new app, after a pause so "judging" can be seen. `projects/create`
 * announces its steps with short pauses, then starts a session on the idea like `session/new` and `session/send`.
 */
export interface NewProjectScript {
  /** The templates the server has: only these are recommended and can be made. Defaults to blank and web-lite. */
  templates?: TemplateId[];
  /** Milliseconds the stand-in takes to judge; defaults to 1500. */
  judgeMs?: number;
  /** Milliseconds between the steps of creating; defaults to 700. */
  createMs?: number;
  /** Judging fails (the model cannot be reached). */
  judgeFails?: boolean;
  /** Creating announces the web address too, as a server does when signed in to Alpine. */
  address?: boolean;
  /** Creating fails: `folder` before the project exists, `session` after it, when the session cannot start. */
  createFails?: 'folder' | 'session';
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
    agent: 'default',
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
 * A denial skips the call and goes on to the final reply (which repeats the feedback, if any), as the core does.
 * `session/cancel` ends the run with `run_stopped: interrupted` wherever it is.
 */
export function sessionScript(options: SessionScriptOptions = {}): Script {
  const stepMs = options.stepMs ?? 0;
  const wordMs = options.wordMs ?? stepMs;
  const store = options.agents ?? agentStore();
  const sessions = new Map<string, Live>();
  let nextSession = 1;
  let importable = options.importable ?? [];

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
      info: { ...live.state.info, updatedAt: new Date().toISOString(), ...changes },
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

  /**
   * Moves the session to `picked` (and to its model, if it has one). Once the conversation has begun, a divider in it
   * says so; before that there is nothing to divide.
   */
  function switchAgent(context: ScriptContext, live: Live, picked: AgentInfo) {
    if (live.state.items.length > 0) {
      const { name, look, color } = picked;
      const item: Item = { id: id(live, 'agent'), kind: 'agent_switched', agent: picked.id, name, look, color };
      emit(context, live, { type: 'item_started', item });
      emit(context, live, { type: 'item_completed', item });
    }
    setInfo(context, live, { agent: picked.id, ...(picked.model ? { model: picked.model } : {}) });
    store.lastAgent.set(live.state.info.cwd, picked.id);
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
      const message: Item = { id: id(live, 'msg'), kind: 'agent_message', text: '', agent: live.state.info.agent };
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
        commandResult: null,
        fileChanges: null,
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
      const pending: ToolCallItem = {
        id: id(live, 'call'),
        kind: 'tool_call',
        name: editing ? 'edit_file' : 'bash',
        args: editing ? { path: 'README.md' } : { command: 'pnpm test' },
        status: 'running',
        result: null,
        images: 0,
        commandResult: null,
        fileChanges: null,
      };
      // As in the core: the call is asked about before it starts, and becomes an item once it runs (or is skipped).
      approval = {
        id: id(live, 'req'),
        kind: 'approval',
        callId: pending.id,
        title: editing ? 'Edit README.md' : 'Run command',
        preview: editing ? '-A coding agent with a core and a UI.\n+A coding agent for your desktop.' : 'pnpm test',
        previewKind: editing ? 'diff' : 'command',
        reason: editing ? null : 'Runs a command in your project',
        remember: editing ? 'Edits to README.md' : 'pnpm test',
        decision: null,
        feedback: null,
        review: null,
        reviewError: null,
        tool: pending.name,
        args: pending.args,
      };
      emit(context, live, { type: 'item_started', item: approval });
      setInfo(context, live, {
        status: 'waiting',
        activity: { kind: 'waiting_approval', toolName: pending.name, since: new Date().toISOString() },
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
        emit(context, live, { type: 'item_completed', item: { ...pending, status: 'denied' } });
        throw new Cancelled();
      }

      if (answer.decision === 'deny') {
        // Skipped (with or without saying what to do instead): the call is not run and the run goes on.
        emit(context, live, { type: 'item_completed', item: { ...pending, status: 'denied' } });
      } else {
        call = pending;
        emit(context, live, { type: 'item_started', item: call });
        setInfo(context, live, {
          status: 'running',
          activity: { kind: 'running_tool', toolName: call.name, since: new Date().toISOString() },
        });
        await step();
        call = { ...call, status: 'done', result: editing ? 'Edited README.md' : 'Tests passed (12)' };
        emit(context, live, { type: 'item_completed', item: call });
        call = null;
      }
      setInfo(context, live, { status: 'running' });
      setActivity(context, live, 'thinking');
      await step();
      modelCall(context, live, { input: 200, output: 60, cacheRead: 1850, cacheWrite: 120 });
      setActivity(context, live, 'writing');
      await say(
        ANSWER +
          (answer.feedback
            ? `You said: ${answer.feedback}`
            : answer.decision === 'deny'
              ? 'I carried on without it.'
              : 'Everything looks fine.'),
      );
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
    const lastAnswer = [...live.state.items].reverse().find((item) => item.kind === 'agent_message');
    setInfo(context, live, {
      status,
      activity: null,
      runStartedAt: null,
      runUsage: null,
      ...(lastAnswer?.kind === 'agent_message' ? { summary: lastAnswer.text.replace(/\s+/g, ' ').slice(0, 240) } : {}),
    });
  }

  /** `session/new`: the session exists, idle, and the list of sessions hears of it. */
  function startSession(
    context: ScriptContext,
    {
      cwd,
      model,
      mode,
      agent,
    }: { cwd: string; model?: string | null; mode?: SessionInfo['mode'] | null; agent?: string | null },
  ): SessionInfo {
    const info = sessionInfo({
      id: `s-${nextSession++}`,
      cwd,
      ...(model ? { model } : {}),
      ...(mode ? { mode } : {}),
      agent: agent ?? 'default',
    });
    const live: Live = {
      state: { info, seq: 0, items: [], activeIds: [], deleted: false },
      run: null,
      waiting: null,
      counter: 0,
    };
    sessions.set(info.id, live);
    emit(context, live, { type: 'info_changed', info });
    return info;
  }

  /** `session/send`: the scripted turn starts, a moment after this returns. */
  function sendMessage(context: ScriptContext, sessionId: string, text: string) {
    const live = find(sessionId);
    if (live.run) throw new ServerError(SESSION_RUNNING, 'The session is running');
    live.run = { cancelled: false, wake: null };
    // Between turns the session takes the agent as it is now; a deleted one is replaced by the default.
    const current =
      store.agents.find((a) => a.id === live.state.info.agent) ?? store.agents.find((a) => a.id === 'default');
    if (current && current.id !== live.state.info.agent) switchAgent(context, live, current);
    store.lastAgent.set(live.state.info.cwd, live.state.info.agent ?? 'default');
    // Starts after the answer, so the first events come after `{}` like on the real server.
    void Promise.resolve().then(() => run(context, live, text));
  }

  const pickable = new Set<TemplateId>(options.newProject?.templates ?? ['blank', 'web-lite']);
  /** Folders made by `projects/create` so far, so the same name gets `-2` as on the real server. */
  const made = new Set<string>();

  return {
    results: {
      'session/new': (params, context) => ({ info: startSession(context, params) }),
      'session/importable': () => ({ sessions: importable }),
      'session/import': ({ cwd, source, id: externalId }, context) => {
        const external = importable.find((e) => e.source === source && e.id === externalId);
        if (!external) throw new ServerError(-32000, 'No such conversation');
        const info = sessionInfo({ id: `s-${nextSession++}`, cwd, title: external.title });
        const items: Item[] = [
          { id: 'i-1', kind: 'user_message', text: external.title },
          { id: 'i-2', kind: 'agent_message', text: 'I looked at the project first.', agent: null },
          {
            id: 'call-1',
            kind: 'tool_call',
            name: source === 'codex' ? 'exec_command' : 'Bash',
            args: source === 'codex' ? { cmd: 'ls' } : { command: 'ls' },
            status: 'done',
            result: 'README.md\nsrc',
            images: 0,
            commandResult: null,
            fileChanges: null,
          },
          { id: 'i-3', kind: 'agent_message', text: 'Done. The page loads now.', agent: null },
          { id: 'i-4', kind: 'imported', source },
        ];
        const live: Live = {
          state: { info, seq: 0, items: [], activeIds: [], deleted: false },
          run: null,
          waiting: null,
          counter: 0,
        };
        sessions.set(info.id, live);
        emit(context, live, { type: 'info_changed', info });
        for (const item of items) emit(context, live, { type: 'item_completed', item });
        importable = importable.map((e) => (e === external ? { ...e, imported: info.id } : e));
        return { info };
      },
      'session/list': () => ({
        sessions: [...sessions.values()]
          .map((live) => live.state.info)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      }),
      'session/open': ({ sessionId }) => toSnapshot(find(sessionId).state),
      'session/send': ({ sessionId, text }, context) => {
        sendMessage(context, sessionId, text);
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
      'session/search': ({ query, limit = 50 }) => ({
        hits: [...sessions.values()]
          .flatMap(({ state }) => {
            const needle = query.trim().toLocaleLowerCase();
            const metadata = [state.info.title, state.info.cwd, state.info.summary ?? ''].join(' ').toLocaleLowerCase();
            if (metadata.includes(needle)) return [{ info: state.info, excerpt: state.info.summary ?? '' }];
            const text = [...state.items]
              .reverse()
              .flatMap((item) => (item.kind === 'user_message' || item.kind === 'agent_message' ? [item.text] : []))
              .find((text) => text.toLocaleLowerCase().includes(needle));
            if (text === undefined) return [];
            const index = text.toLocaleLowerCase().indexOf(needle);
            return [{ info: state.info, excerpt: text.slice(Math.max(0, index - 60), index + 180) }];
          })
          .slice(0, limit),
      }),
      'session/setDetails': ({ sessionId, title, pinned, archived }, context) => {
        const live = find(sessionId);
        if (archived && (live.run || live.state.info.status === 'running' || live.state.info.status === 'waiting'))
          throw new ServerError(SESSION_RUNNING, 'The session is running');
        if (title !== undefined && title !== null && (!title.trim() || title.trim().length > 120))
          throw new ServerError(-32000, 'Invalid title');
        const changes = {
          ...(title != null ? { title: title.trim() } : {}),
          ...(pinned != null ? { pinned } : {}),
          ...(archived != null ? { archived } : {}),
        };
        setInfo(context, live, { ...changes, updatedAt: live.state.info.updatedAt });
        return { info: live.state.info };
      },
      'session/setMode': ({ sessionId, mode }, context) => {
        const live = find(sessionId);
        setInfo(context, live, { mode });
        return { info: live.state.info };
      },
      'session/setModel': ({ sessionId, model }, context) => {
        const live = find(sessionId);
        if (live.run) throw new ServerError(SESSION_RUNNING, 'The session is running');
        setInfo(context, live, { model });
        return { info: live.state.info };
      },
      'session/setAgent': ({ sessionId, agent }, context) => {
        const live = find(sessionId);
        if (live.run) throw new ServerError(SESSION_RUNNING, 'The session is running');
        const picked = store.agents.find((a) => a.id === agent);
        if (!picked) throw new ServerError(-32000, 'No such agent', { reason: 'agent_not_found' });
        switchAgent(context, live, picked);
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
      'projects/judge': async ({ text, locale }) => {
        const script = options.newProject ?? {};
        await sleep(script.judgeMs ?? 1500);
        if (script.judgeFails)
          throw new ServerError(-32000, 'The model could not be reached', { reason: 'model_failed' });
        return { judgement: standInJudgement(text, locale, pickable) };
      },
      'projects/create': async ({ id, idea, template, name, agent, mode }, context) => {
        const script = options.newProject ?? {};
        const pause = () => sleep(script.createMs ?? 700);
        await pause();
        if (!pickable.has(template))
          throw new ServerError(-32000, `No template named ${template}`, { reason: 'not_found' });
        if (script.createFails === 'folder')
          throw new ServerError(-32000, 'The project could not be made: Permission denied', { reason: 'other' });
        const base =
          name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'new-app';
        let folder = base;
        for (let n = 2; made.has(folder); n++) folder = `${base}-${n}`;
        made.add(folder);
        const project: ProjectInfo = {
          path: `/Users/me/AlpineCode/${folder}`,
          name: folder,
          branch: 'main',
          lastUsedAt: new Date().toISOString(),
          archived: false,
          lastAgent: null,
        };
        context.emit({ method: 'projects/createChanged', params: { id, step: 'folder', project } });
        if (script.address) {
          await pause();
          await pause();
          context.emit({ method: 'projects/createChanged', params: { id, step: 'address', project } });
        }
        await pause();
        if (script.createFails === 'session')
          throw new ServerError(-32000, 'The session could not be started', { reason: 'other' });
        const info = startSession(context, { cwd: project.path, agent, mode });
        sendMessage(context, info.id, idea);
        context.emit({ method: 'projects/createChanged', params: { id, step: 'agent', project } });
        return { project, sessionId: info.id };
      },
    },
  };
}

// The stand-in for the model: a few rules on the words, nothing the real judge does.
const NEW = /만들|페이지|사이트|앱|서비스|프로그램|자동화|build|make|app|site|page/i;
const CHANGE = /고쳐|바꿔|수정|크게|작게|설명해|확인해|fix|change|explain|check/i;
const PRO = /채팅|실시간|함께|같이 편집|사진|영상|기록|로그|chat|realtime|live|photo|video|log/i;
const BLANK = /자동화|스크립트|엑셀|크롤|파이썬|automat|script|excel|python/i;

function standInJudgement(text: string, locale: string, templates: Set<TemplateId>): Judgement {
  // When unsure, it is work on the project I am in, so a new project is never made by mistake.
  if (CHANGE.test(text) || !NEW.test(text)) return { kind: 'change' };
  const ko = locale.startsWith('ko');
  const name = /공방|craft/i.test(text) ? 'craft-booking' : 'new-app';
  if (BLANK.test(text) && templates.has('blank'))
    return {
      kind: 'new',
      template: 'blank',
      name,
      reason: ko
        ? '웹 화면 없이 도는 자동화라서 빈 프로젝트가 맞아요.'
        : 'It runs without a web page, so an empty project fits.',
    };
  if (PRO.test(text) && templates.has('web-pro'))
    return {
      kind: 'new',
      template: 'web-pro',
      name,
      reason: ko
        ? '여럿이 바로바로 주고받는 기능이 있어서 Pro를 추천해요.'
        : 'People exchange things live in this idea, so Pro fits.',
    };
  if (!templates.has('web-lite')) return { kind: 'change' };
  return {
    kind: 'new',
    template: 'web-lite',
    name,
    reason: ko ? '로그인과 예약 저장이면 Lite로 충분해요.' : 'Sign-in and saved bookings are well within Lite.',
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
