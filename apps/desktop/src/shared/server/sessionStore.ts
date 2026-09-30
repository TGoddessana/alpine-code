import type { SessionEventParams, SessionInfo } from '@alpine/protocol';
import type { QueryClient } from '@tanstack/react-query';

import type { Notification, ServerConnection } from './connection';
import { applyEvent, fromSnapshot, type SessionState } from './sessionState';

export const sessionsKey = ['sessions'] as const;
export const sessionKey = (id: string) => ['session', id] as const;

/** How many times a snapshot may be followed by a gap before giving up. */
const MAX_REOPENS = 3;

const newestFirst = (a: SessionInfo, b: SessionInfo) => b.updatedAt.localeCompare(a.updatedAt);

/** Puts `info` into the list of sessions, if the list is loaded. */
export function upsertSession(client: QueryClient, info: SessionInfo) {
  client.setQueryData<SessionInfo[]>(
    sessionsKey,
    (list) => list && [info, ...list.filter((s) => s.id !== info.id)].sort(newestFirst),
  );
}

/** Takes the session out of the list of sessions, if the list is loaded. */
export function removeSession(client: QueryClient, id: string) {
  client.setQueryData<SessionInfo[]>(sessionsKey, (list) => list && list.filter((s) => s.id !== id));
}

/**
 * Keeps sessions fresh from `session/event` notifications. The state of an opened session lives in the query
 * cache under `sessionKey(id)`; the store only decides what to do with each event:
 *
 * - while `session/open` is in flight, events for that session are kept, then those newer than the snapshot are applied
 * - once open, events are applied in order
 * - a gap in `seq` means events were missed, so the session is opened again
 */
export class SessionStore {
  private readonly buffers = new Map<string, SessionEventParams[]>();
  private readonly opening = new Map<string, Promise<SessionState>>();

  constructor(
    private readonly connection: ServerConnection,
    private readonly client: QueryClient,
  ) {}

  /** Calls `handle` for every notification until the returned function is called. */
  start(): () => void {
    return this.connection.subscribe((notification) => this.handle(notification));
  }

  handle(notification: Notification) {
    if (notification.method !== 'session/event') return;
    const params = notification.params as SessionEventParams;
    const { sessionId, event } = params;

    if (event.type === 'info_changed') upsertSession(this.client, event.info);
    else if (event.type === 'deleted') removeSession(this.client, sessionId);

    const buffer = this.buffers.get(sessionId);
    if (buffer) return void buffer.push(params);

    const state = this.client.getQueryData<SessionState>(sessionKey(sessionId));
    if (!state) return; // Not opened in this window: `session/open` will bring it up to date.
    const next = applyEvent(state, params);
    if (next === 'stale') return;
    if (next === 'gap') return void this.reopen(sessionId);
    this.client.setQueryData(sessionKey(sessionId), next);
  }

  /** Asks the server for the session and catches up with the events that arrived meanwhile. */
  open(sessionId: string): Promise<SessionState> {
    const running = this.opening.get(sessionId);
    if (running) return running;
    const promise = this.load(sessionId).finally(() => this.opening.delete(sessionId));
    this.opening.set(sessionId, promise);
    return promise;
  }

  private async load(sessionId: string): Promise<SessionState> {
    this.buffers.set(sessionId, []);
    try {
      for (let attempt = 0; ; attempt++) {
        const snapshot = await this.connection.request('session/open', { sessionId });
        let state = fromSnapshot(snapshot);
        let gap = false;
        for (const params of this.buffers.get(sessionId)!.splice(0)) {
          const next = applyEvent(state, params);
          if (next === 'gap') gap = true;
          else if (next !== 'stale') state = next;
        }
        if (gap && attempt < MAX_REOPENS) continue;
        // Cached before the buffer is dropped, so no event falls between the two.
        this.client.setQueryData(sessionKey(sessionId), state);
        return state;
      }
    } finally {
      this.buffers.delete(sessionId);
    }
  }

  private reopen(sessionId: string) {
    this.client
      .fetchQuery({ queryKey: sessionKey(sessionId), queryFn: () => this.open(sessionId), staleTime: 0 })
      .catch(() => {}); // The observer of the query shows the failure.
  }
}
