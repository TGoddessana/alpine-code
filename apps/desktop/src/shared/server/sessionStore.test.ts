import type { SessionEventParams, SessionOpenResult } from '@alpine/protocol';
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import type { Notification, ServerConnection } from './connection';
import { sessionInfo } from './sessionScript';
import type { SessionState } from './sessionState';
import { SessionStore, sessionKey, sessionsKey } from './sessionStore';

/** A server whose `session/open` answers are decided by the test, one per call. */
function harness(snapshots: SessionOpenResult[]) {
  const listeners = new Set<(n: Notification) => void>();
  const opens: ((snapshot: SessionOpenResult) => void)[] = [];
  const connection = {
    request: vi.fn(
      () =>
        new Promise<SessionOpenResult>((resolve) => {
          const snapshot = snapshots[opens.length]!;
          opens.push(() => resolve(snapshot));
        }),
    ),
    subscribe(listener: (n: Notification) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as ServerConnection;
  const client = new QueryClient();
  const store = new SessionStore(connection, client);
  store.start();
  const send = (params: SessionEventParams) =>
    listeners.forEach((listener) => listener({ method: 'session/event', params }));
  const state = () => client.getQueryData<SessionState>(sessionKey('s'));
  return {
    store,
    client,
    send,
    state,
    connection,
    answer: (index: number) => vi.waitFor(() => opens[index]!(snapshots[index]!)),
  };
}

const info = sessionInfo({ id: 's' });
const snapshot = (seq: number, text = ''): SessionOpenResult => ({
  info,
  seq,
  items: [],
  active: text ? [{ id: 'm1', kind: 'agent_message', text }] : [],
});
const delta = (seq: number, text: string): SessionEventParams => ({
  sessionId: 's',
  seq,
  event: { type: 'item_delta', itemId: 'm1', text },
});

describe('SessionStore', () => {
  it('applies only the events newer than the snapshot that arrived while it was in flight', async () => {
    const h = harness([snapshot(6, 'abc')]);
    const opening = h.store.open('s');
    h.send(delta(5, 'b')); // Already in the snapshot.
    h.send(delta(6, 'c'));
    h.send(delta(7, 'd'));
    h.send(delta(8, 'e'));
    await h.answer(0);
    const state = await opening;
    expect(state.seq).toBe(8);
    expect(state.items[0]).toMatchObject({ text: 'abcde' });
    expect(h.state()).toEqual(state);
  });

  it('applies later events in order once open', async () => {
    const h = harness([snapshot(6, 'abc')]);
    const opening = h.store.open('s');
    await h.answer(0);
    await opening;
    h.send(delta(7, 'd'));
    h.send(delta(7, 'd')); // A repeat changes nothing.
    h.send(delta(8, 'e'));
    expect(h.state()?.items[0]).toMatchObject({ text: 'abcde' });
  });

  it('opens the session again on a gap in seq', async () => {
    const h = harness([snapshot(6, 'abc'), snapshot(9, 'abcdefg')]);
    const opening = h.store.open('s');
    await h.answer(0);
    await opening;
    h.send(delta(8, 'x')); // 7 was missed.
    expect(h.connection.request).toHaveBeenCalledTimes(2);
    h.send(delta(9, 'g')); // Arrives while the new snapshot is in flight.
    h.send(delta(10, 'h'));
    await h.answer(1);
    await vi.waitFor(() => expect(h.state()?.seq).toBe(10));
    expect(h.state()?.items[0]).toMatchObject({ text: 'abcdefgh' });
  });

  it('opens again when the buffered events leave a gap after the snapshot', async () => {
    const h = harness([snapshot(6), snapshot(9)]);
    const opening = h.store.open('s');
    h.send(delta(8, 'x'));
    await h.answer(0);
    await h.answer(1);
    await expect(opening).resolves.toMatchObject({ seq: 9 });
    expect(h.connection.request).toHaveBeenCalledTimes(2);
  });

  it('ignores events for sessions that were not opened', () => {
    const h = harness([]);
    h.send(delta(1, 'x'));
    expect(h.state()).toBeUndefined();
  });

  it('keeps the list of sessions fresh', () => {
    const h = harness([]);
    const old = sessionInfo({ id: 'old', updatedAt: '2026-01-01T00:00:00.000Z' });
    h.client.setQueryData(sessionsKey, [old]);
    const fresh = sessionInfo({ id: 'new', updatedAt: '2026-02-01T00:00:00.000Z' });
    h.send({ sessionId: 'new', seq: 1, event: { type: 'info_changed', info: fresh } });
    expect(h.client.getQueryData(sessionsKey)).toEqual([fresh, old]);
    h.send({ sessionId: 'old', seq: 3, event: { type: 'deleted' } });
    expect(h.client.getQueryData(sessionsKey)).toEqual([fresh]);
  });
});
