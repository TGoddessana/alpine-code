import type { ApprovalItem, SessionEventParams, SessionInfo, SessionOpenResult } from '@alpine/protocol';

/** One thing in the conversation, of any kind. The protocol inlines this union, so it is taken from a field. */
export type Item = SessionOpenResult['items'][number];

/** What a `session/event` carries. */
export type SessionEvent = SessionEventParams['event'];

/** A session as a window knows it: the snapshot from `session/open` with the later events applied. */
export interface SessionState {
  info: SessionInfo;
  /** The `seq` of the last event applied. The next one must be `seq + 1`. */
  seq: number;
  /** Every item in the order it started, finished or not. */
  items: Item[];
  /** The ids of the items that are not finished: a streaming reply, running tool calls, an active approval. */
  activeIds: string[];
  /** The server said the session was deleted. */
  deleted: boolean;
}

/** The state a `session/open` result describes. */
export function fromSnapshot(snapshot: SessionOpenResult): SessionState {
  return {
    info: snapshot.info,
    seq: snapshot.seq,
    items: [...snapshot.items, ...snapshot.active],
    activeIds: snapshot.active.map((item) => item.id),
    deleted: false,
  };
}

/** The `session/open` result for a state: finished items, then the active ones. */
export function toSnapshot(state: SessionState): SessionOpenResult {
  const active = new Set(state.activeIds);
  return {
    info: state.info,
    seq: state.seq,
    items: state.items.filter((item) => !active.has(item.id)),
    active: state.items.filter((item) => active.has(item.id)),
  };
}

/** The approval the dock should show, if one is active. */
export function activeApproval(state: SessionState): ApprovalItem | null {
  const active = new Set(state.activeIds);
  const found = state.items.find((item) => item.kind === 'approval' && active.has(item.id));
  return found?.kind === 'approval' ? found : null;
}

/** Text streamed into an item: a reply grows its `text`, a tool call its `result`. */
function grow(item: Item, text: string): Item {
  if (item.kind === 'tool_call') return { ...item, result: (item.result ?? '') + text };
  if ('text' in item) return { ...item, text: item.text + text };
  return item;
}

function put(items: Item[], item: Item): Item[] {
  return items.some((existing) => existing.id === item.id)
    ? items.map((existing) => (existing.id === item.id ? item : existing))
    : [...items, item];
}

/** The state after one event, ignoring its `seq`. */
function applyBody(state: SessionState, event: SessionEvent): SessionState {
  switch (event.type) {
    case 'info_changed':
      return { ...state, info: event.info };
    case 'deleted':
      return { ...state, deleted: true };
    case 'item_started':
      return {
        ...state,
        items: put(state.items, event.item),
        activeIds: state.activeIds.includes(event.item.id) ? state.activeIds : [...state.activeIds, event.item.id],
      };
    case 'item_delta':
      return { ...state, items: state.items.map((item) => (item.id === event.itemId ? grow(item, event.text) : item)) };
    case 'item_completed':
      return {
        ...state,
        items: put(state.items, event.item),
        activeIds: state.activeIds.filter((id) => id !== event.item.id),
      };
    case 'item_discarded':
      return {
        ...state,
        items: state.items.filter((item) => item.id !== event.itemId),
        activeIds: state.activeIds.filter((id) => id !== event.itemId),
      };
    default:
      return state;
  }
}

/**
 * The state after an event, in order.
 *
 * - `stale`: the event is not newer than the state (`seq` at or below it), so it changes nothing.
 * - `gap`: events were missed, so the state cannot be trusted; ask for a new snapshot.
 * - otherwise the next state.
 */
export function applyEvent(state: SessionState, params: SessionEventParams): SessionState | 'stale' | 'gap' {
  if (params.seq <= state.seq) return 'stale';
  if (params.seq !== state.seq + 1) return 'gap';
  return { ...applyBody(state, params.event), seq: params.seq };
}
