import type { SessionEventParams, ToolCallItem } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { sessionInfo } from './sessionScript';
import {
  activeApproval,
  applyEvent,
  fromSnapshot,
  toSnapshot,
  type SessionEvent,
  type SessionState,
} from './sessionState';

const start = (): SessionState =>
  fromSnapshot({
    info: sessionInfo({ id: 's' }),
    seq: 4,
    items: [{ id: 'u1', kind: 'user_message', text: 'hi' }],
    active: [],
  });

const at = (seq: number, event: SessionEvent): SessionEventParams => ({ sessionId: 's', seq, event });
const message = { id: 'm1', kind: 'agent_message', text: '' } as const;

function apply(state: SessionState, ...events: SessionEventParams[]): SessionState {
  return events.reduce((current, params) => {
    const next = applyEvent(current, params);
    if (typeof next === 'string') throw new Error(next);
    return next;
  }, state);
}

describe('applyEvent', () => {
  it('accumulates deltas in the started item', () => {
    const state = apply(
      start(),
      at(5, { type: 'item_started', item: message }),
      at(6, { type: 'item_delta', itemId: 'm1', text: 'Hel' }),
      at(7, { type: 'item_delta', itemId: 'm1', text: 'lo' }),
    );
    expect(state.items.at(-1)).toEqual({ ...message, text: 'Hello' });
    expect(state.activeIds).toEqual(['m1']);
    expect(state.seq).toBe(7);
  });

  it('replaces the item when it completes, whatever the deltas built', () => {
    const state = apply(
      start(),
      at(5, { type: 'item_started', item: message }),
      at(6, { type: 'item_delta', itemId: 'm1', text: 'partial' }),
      at(7, { type: 'item_completed', item: { ...message, text: 'The whole reply' } }),
    );
    expect(state.items.at(-1)).toEqual({ ...message, text: 'The whole reply' });
    expect(state.activeIds).toEqual([]);
  });

  it('drops a discarded item', () => {
    const state = apply(
      start(),
      at(5, { type: 'item_started', item: message }),
      at(6, { type: 'item_discarded', itemId: 'm1' }),
    );
    expect(state.items.map((i) => i.id)).toEqual(['u1']);
    expect(state.activeIds).toEqual([]);
  });

  it('streams a tool call result', () => {
    const call: ToolCallItem = {
      id: 'c1',
      kind: 'tool_call',
      name: 'bash',
      args: {},
      status: 'running',
      result: null,
      images: 0,
    };
    const state = apply(
      start(),
      at(5, { type: 'item_started', item: call }),
      at(6, { type: 'item_delta', itemId: 'c1', text: 'a' }),
      at(7, { type: 'item_delta', itemId: 'c1', text: 'b' }),
    );
    expect(state.items.at(-1)).toMatchObject({ result: 'ab' });
  });

  it('applies info_changed and deleted', () => {
    const info = sessionInfo({ id: 's', status: 'running' });
    const state = apply(start(), at(5, { type: 'info_changed', info }), at(6, { type: 'deleted' }));
    expect(state.info.status).toBe('running');
    expect(state.deleted).toBe(true);
  });

  it('ignores events that are not newer than the state', () => {
    expect(applyEvent(start(), at(4, { type: 'item_delta', itemId: 'u1', text: 'x' }))).toBe('stale');
    expect(applyEvent(start(), at(2, { type: 'deleted' }))).toBe('stale');
  });

  it('reports a gap in seq', () => {
    expect(applyEvent(start(), at(6, { type: 'deleted' }))).toBe('gap');
  });

  it('finds the active approval', () => {
    const approval = {
      id: 'r1',
      kind: 'approval',
      callId: 'c1',
      title: 't',
      preview: null,
      previewKind: null,
      reason: null,
      remember: null,
      decision: null,
      feedback: null,
      tool: 'bash',
      args: {},
    } as const;
    const state = apply(start(), at(5, { type: 'item_started', item: approval }));
    expect(activeApproval(state)).toEqual(approval);
    const answered = apply(state, at(6, { type: 'item_completed', item: { ...approval, decision: 'allow' } }));
    expect(activeApproval(answered)).toBeNull();
  });

  it('round-trips a snapshot', () => {
    const state = apply(start(), at(5, { type: 'item_started', item: message }));
    expect(fromSnapshot(toSnapshot(state))).toEqual(state);
  });
});
