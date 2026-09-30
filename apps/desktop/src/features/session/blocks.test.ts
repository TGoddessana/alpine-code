import { describe, expect, it } from 'vitest';

import type { Item } from '@/shared/server';

import { toBlocks, toolKind } from './blocks';

const call = (id: string, name = 'bash'): Item => ({
  id,
  kind: 'tool_call',
  name,
  args: {},
  status: 'done',
  result: null,
  images: 0,
});
const message = (id: string): Item => ({ id, kind: 'agent_message', text: 'hi' });
const approval = (id: string): Item => ({
  id,
  kind: 'approval',
  callId: 'c2',
  title: 'Run',
  preview: null,
  previewKind: null,
  reason: null,
  remember: null,
  decision: null,
  feedback: null,
});

describe('toBlocks', () => {
  it('joins tool calls in a row and splits them at messages', () => {
    const blocks = toBlocks([call('c1'), call('c2'), message('m1'), call('c3')], []);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'item', 'tools']);
    expect(blocks[0]).toMatchObject({ calls: [{ id: 'c1' }, { id: 'c2' }] });
  });

  it('leaves out a waiting approval without breaking the row, and keeps a finished one', () => {
    const items = [call('c1'), approval('r1'), call('c2')];
    expect(toBlocks(items, ['r1']).map((b) => b.type)).toEqual(['tools']);
    expect(toBlocks(items, []).map((b) => b.type)).toEqual(['tools', 'item', 'tools']);
  });
});

describe('toolKind', () => {
  it('knows the core tools and the scripted ones', () => {
    expect(['edit', 'edit_file', 'write', 'bash', 'read', 'read_file', 'grep', 'glob', 'x'].map(toolKind)).toEqual([
      'edit',
      'edit',
      'edit',
      'run',
      'read',
      'read',
      'read',
      'read',
      'other',
    ]);
  });
});
