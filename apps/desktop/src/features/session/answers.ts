import type { Item } from '@/shared/server';

/** An agent's dividers carry its name and look as they were then. */
export type Divider = Extract<Item, { kind: 'agent_switched' | 'agent_changed' }>;

export interface Answer {
  /** Whether this text opens the agent's answer: later text of the same answer (after tool calls) has no header. */
  header: boolean;
  /** The last divider of this agent before the text, for an agent that is gone from the list. */
  remembered: Divider | null;
}

/**
 * For each agent message, whether it gets the agent's face and name, and what the conversation remembers of the
 * agent. A run says more than one piece of text (text, tool calls, text), but it is one answer: the header comes
 * with the first piece after my message or after a divider, or when another agent writes.
 */
export function answers(items: readonly Item[]): Map<string, Answer> {
  const result = new Map<string, Answer>();
  const known = new Map<string, Divider>();
  let last: string | null = null;
  for (const item of items) {
    if (item.kind === 'user_message') last = null;
    else if (item.kind === 'agent_switched' || item.kind === 'agent_changed') {
      known.set(item.agent, item);
      last = null;
    } else if (item.kind === 'agent_message' && item.text) {
      result.set(item.id, { header: item.agent !== last, remembered: (item.agent && known.get(item.agent)) || null });
      last = item.agent;
    }
  }
  return result;
}
