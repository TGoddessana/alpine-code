import { describe, expect, it } from 'vitest';

import type { Item } from '@/shared/server';

import { answers } from './answers';

const say = (id: string, agent: string | null, text = 'hi'): Item => ({ id, kind: 'agent_message', text, agent });
const user = (id: string): Item => ({ id, kind: 'user_message', text: 'q' });
const call = (id: string): Item => ({
  id,
  kind: 'tool_call',
  name: 'read',
  args: {},
  status: 'done',
  result: '',
  images: 0,
});
const switched = (id: string, agent: string): Item => ({
  id,
  kind: 'agent_switched',
  agent,
  name: agent,
  look: 'glasses',
  color: 3,
});

describe('answers', () => {
  it('puts the header on the first text of an answer only', () => {
    const result = answers([user('u'), say('a1', 'x'), call('c'), say('a2', 'x')]);
    expect(result.get('a1')?.header).toBe(true);
    expect(result.get('a2')?.header).toBe(false);
  });

  it('starts again after my message, a divider or another agent', () => {
    const result = answers([
      say('a1', 'x'),
      user('u'),
      say('a2', 'x'),
      switched('d', 'y'),
      say('a3', 'y'),
      say('a4', 'z'),
    ]);
    expect(['a1', 'a2', 'a3', 'a4'].map((id) => result.get(id)?.header)).toEqual([true, true, true, true]);
  });

  it('remembers the agent from its divider, for one that was deleted', () => {
    const divider = switched('d', 'y');
    expect(answers([divider, say('a', 'y')]).get('a')?.remembered).toBe(divider);
    expect(answers([say('a', 'y')]).get('a')?.remembered).toBeNull();
  });

  it('ignores a message with no text yet', () => {
    const result = answers([say('a1', 'x', ''), say('a2', 'x')]);
    expect(result.has('a1')).toBe(false);
    expect(result.get('a2')?.header).toBe(true);
  });
});
