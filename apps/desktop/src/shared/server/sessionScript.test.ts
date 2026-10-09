import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { ServerError } from './connection';
import { scriptedConnection } from './scripted';
import { sessionScript } from './sessionScript';
import { activeApproval, type SessionState } from './sessionState';
import { SessionStore, sessionKey } from './sessionStore';
import { vi } from 'vitest';

async function setup() {
  const connection = scriptedConnection(sessionScript());
  const client = new QueryClient();
  new SessionStore(connection, client).start();
  const store = new SessionStore(connection, client);
  store.start();
  const { info } = await connection.request('session/new', { cwd: '/work' });
  const state = () => client.getQueryData<SessionState>(sessionKey(info.id));
  const opened = await store.open(info.id);
  expect(opened.items).toEqual([]);
  return { connection, id: info.id, state: () => state()! };
}

const kinds = (state: SessionState) =>
  state.items.map((i) => (i.kind === 'tool_call' ? `${i.name}:${i.status}` : i.kind));

describe('sessionScript', () => {
  it('runs a turn with an approval and a final reply', async () => {
    const { connection, id, state } = await setup();
    await connection.request('session/send', { sessionId: id, text: 'run the tests' });
    await vi.waitFor(() => expect(activeApproval(state())).not.toBeNull());
    expect(state().info.status).toBe('waiting');
    expect(state().info.title).toBe('run the tests');
    const approval = activeApproval(state())!;
    await expect(connection.request('session/send', { sessionId: id, text: 'again' })).rejects.toEqual(
      new ServerError(-32002, 'The session is running'),
    );
    await expect(connection.request('session/setModel', { sessionId: id, model: 'x/other' })).rejects.toEqual(
      new ServerError(-32002, 'The session is running'),
    );
    await expect(
      connection.request('session/answer', { sessionId: id, requestId: approval.id, decision: 'allow' }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      connection.request('session/answer', { sessionId: id, requestId: approval.id, decision: 'deny' }),
    ).resolves.toEqual({ accepted: false });
    await vi.waitFor(() => expect(state().info.status).toBe('idle'));
    expect(kinds(state())).toEqual([
      'user_message',
      'agent_message',
      'read_file:done',
      'approval',
      'bash:done',
      'agent_message',
    ]);
    expect(state().activeIds).toEqual([]);
  });

  it('reports the activity, the run and the usage as the turn goes', async () => {
    const { connection, id, state } = await setup();
    expect(state().info.activity).toBeNull();
    await connection.request('session/send', { sessionId: id, text: 'run the tests' });
    await vi.waitFor(() => expect(activeApproval(state())).not.toBeNull());
    const waiting = state().info;
    expect(waiting.activity).toMatchObject({ kind: 'waiting_approval', toolName: 'bash' });
    expect(waiting.runStartedAt).not.toBeNull();
    expect(waiting.runUsage?.requests).toBe(2);
    expect(waiting.usage.requests).toBe(2);
    expect(waiting.contextUsed).toBeGreaterThan(0);
    await connection.request('session/answer', {
      sessionId: id,
      requestId: activeApproval(state())!.id,
      decision: 'allow',
    });
    await vi.waitFor(() => expect(state().info.status).toBe('idle'));
    const done = state().info;
    expect(done).toMatchObject({ activity: null, runStartedAt: null, runUsage: null });
    expect(done.usage.requests).toBe(4);
    expect(done.usage.cacheReadTokens).toBeGreaterThan(0);
  });

  it('skips the call and goes on when a denial has no feedback', async () => {
    const { connection, id, state } = await setup();
    await connection.request('session/send', { sessionId: id, text: 'edit the readme' });
    await vi.waitFor(() => expect(activeApproval(state())).not.toBeNull());
    const approval = activeApproval(state())!;
    expect(approval.previewKind).toBe('diff');
    await connection.request('session/answer', { sessionId: id, requestId: approval.id, decision: 'deny' });
    await vi.waitFor(() => expect(state().info.status).toBe('idle'));
    expect(kinds(state()).slice(-3)).toEqual(['approval', 'edit_file:denied', 'agent_message']);
  });

  it('cancels at the approval', async () => {
    const { connection, id, state } = await setup();
    await connection.request('session/send', { sessionId: id, text: 'go' });
    await vi.waitFor(() => expect(activeApproval(state())).not.toBeNull());
    await connection.request('session/cancel', { sessionId: id });
    await vi.waitFor(() => expect(state().info.status).toBe('idle'));
    expect(kinds(state()).slice(-3)).toEqual(['approval', 'bash:denied', 'run_stopped']);
    expect(state().items.at(-1)).toMatchObject({ reason: 'interrupted' });
  });

  it('cancels a streaming reply and keeps what it said', async () => {
    const connection = scriptedConnection(sessionScript({ wordMs: 40 }));
    const client = new QueryClient();
    const store = new SessionStore(connection, client);
    store.start();
    const { info } = await connection.request('session/new', { cwd: '/work' });
    await store.open(info.id);
    const state = () => client.getQueryData<SessionState>(sessionKey(info.id))!;
    await connection.request('session/send', { sessionId: info.id, text: 'go' });
    await vi.waitFor(() => expect(state().items.some((i) => i.kind === 'agent_message' && i.text)).toBe(true));
    await connection.request('session/cancel', { sessionId: info.id });
    await vi.waitFor(() => expect(state().info.status).toBe('idle'));
    expect(state().activeIds).toEqual([]);
    expect(kinds(state())).toEqual(['user_message', 'agent_message', 'run_stopped']);
  });

  it('switches the model and keeps the conversation', async () => {
    const { connection, id, state } = await setup();
    await connection.request('session/send', { sessionId: id, text: 'edit the readme' });
    await vi.waitFor(() => expect(activeApproval(state())).not.toBeNull());
    await connection.request('session/answer', {
      sessionId: id,
      requestId: activeApproval(state())!.id,
      decision: 'deny',
    });
    await vi.waitFor(() => expect(state().info.status).toBe('idle'));
    const before = state().items.length;
    const { info } = await connection.request('session/setModel', { sessionId: id, model: 'x/other' });
    expect(info.model).toBe('x/other');
    await vi.waitFor(() => expect(state().info.model).toBe('x/other'));
    expect(state().items).toHaveLength(before);
  });

  it('switches the agent between turns and says so in the conversation', async () => {
    const { connection, id, state } = await setup();
    expect(state().info.agent).toBe('default');
    const { info } = await connection.request('session/setAgent', { sessionId: id, agent: 'a-review' });
    expect(info.agent).toBe('a-review');
    await vi.waitFor(() => expect(state().info.agent).toBe('a-review'));
    expect(state().items).toEqual([
      {
        id: expect.any(String),
        kind: 'agent_switched',
        agent: 'a-review',
        name: '꼼꼼한 검토자',
        look: 'glasses',
        color: 3,
      },
    ]);
  });

  it('refuses to switch the agent while it runs, and an agent that does not exist', async () => {
    const { connection, id, state } = await setup();
    await expect(connection.request('session/setAgent', { sessionId: id, agent: 'nobody' })).rejects.toEqual(
      new ServerError(-32000, 'No such agent', { reason: 'agent_not_found' }),
    );
    await connection.request('session/send', { sessionId: id, text: 'run the tests' });
    await vi.waitFor(() => expect(activeApproval(state())).not.toBeNull());
    await expect(connection.request('session/setAgent', { sessionId: id, agent: 'a-site' })).rejects.toEqual(
      new ServerError(-32002, 'The session is running'),
    );
  });

  it('starts a session with the asked agent', async () => {
    const connection = scriptedConnection(sessionScript());
    const { info } = await connection.request('session/new', { cwd: '/work', agent: 'a-writer' });
    expect(info.agent).toBe('a-writer');
  });

  it('deletes a session', async () => {
    const { connection, id, state } = await setup();
    await connection.request('session/delete', { sessionId: id });
    await vi.waitFor(() => expect(state().deleted).toBe(true));
    await expect(connection.request('session/open', { sessionId: id })).rejects.toMatchObject({ code: -32001 });
  });
});
