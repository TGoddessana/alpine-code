import type { ApprovalItem, ToolCallItem } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import type { Item } from '@/shared/server';

import { toBlocks, toolSummary } from './blocks';

const call = (id: string, over: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id,
  kind: 'tool_call',
  name: 'bash',
  args: {},
  status: 'done',
  result: null,
  images: 0,
  ...over,
});
const message = (id: string): Item => ({ id, kind: 'agent_message', agent: null, text: 'hi' });
const approval = (id: string, callId: string, over: Partial<ApprovalItem> = {}): ApprovalItem => ({
  id,
  kind: 'approval',
  callId,
  title: 'Run',
  preview: null,
  previewKind: null,
  reason: null,
  remember: null,
  decision: null,
  feedback: null,
  review: null,
  reviewError: null,
  tool: 'bash',
  args: {},
  ...over,
});

describe('toBlocks', () => {
  it('puts a suggested memory right after its call, once the call is done', () => {
    const memory = (id: string, status: ToolCallItem['status']) =>
      call(id, { name: 'propose_memory', args: { headline: '해요체로 쓴다' }, status });
    const blocks = toBlocks([call('c1'), memory('c2', 'done'), call('c3'), memory('c4', 'running')], []);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'memory', 'tools']);
    expect(blocks[1]).toMatchObject({ call: { id: 'c2' } });
    expect(blocks[2]).toMatchObject({ rows: [{ call: { id: 'c3' } }, { call: { id: 'c4' } }] });
  });

  it('joins tool calls in a row and splits them at messages', () => {
    const blocks = toBlocks([call('c1'), call('c2'), message('m1'), call('c3')], []);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'item', 'tools']);
    expect(blocks[0]).toMatchObject({ rows: [{ call: { id: 'c1' } }, { call: { id: 'c2' } }] });
  });

  it('splits tool calls at the agent dividers, which are plain items', () => {
    const switched: Item = {
      id: 'a1',
      kind: 'agent_switched',
      agent: 'a-review',
      name: '검토자',
      look: 'glasses',
      color: 3,
    };
    const changed: Item = {
      id: 'a2',
      kind: 'agent_changed',
      agent: 'a-site',
      name: '홈페이지 담당',
      look: 'hardhat',
      color: 1,
      added: ['fetch'],
      removed: [],
      instructions: false,
      model: null,
    };
    const blocks = toBlocks([call('c1'), switched, call('c2'), changed, call('c3')], []);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'item', 'tools', 'item', 'tools']);
    expect(blocks[1]).toEqual({ type: 'item', item: switched });
    expect(blocks[3]).toEqual({ type: 'item', item: changed });
  });

  it('draws a waiting approval where its call will be', () => {
    const waiting = approval('r1', 'c2');
    expect(toBlocks([call('c1'), waiting], ['r1'])).toEqual([
      { type: 'tools', id: 'c1', rows: [{ call: call('c1'), approval: null }] },
      { type: 'approval', item: waiting },
    ]);
  });

  it('draws a call auto mode blocked as its own line, in place of the denied call', () => {
    const blocked: Item = {
      id: 'b1',
      kind: 'review_blocked',
      callId: 'c2',
      tool: 'bash',
      args: { command: 'git push -f' },
      reason: 'not asked',
    };
    const blocks = toBlocks([call('c1'), blocked, call('c2', { status: 'denied' }), call('c3')], []);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'blocked', 'tools']);
    expect(blocks[1]).toEqual({ type: 'blocked', item: blocked });
    expect(blocks[2]).toMatchObject({ rows: [{ call: { id: 'c3' } }] });
  });

  it('puts a finished approval with its call instead of drawing it', () => {
    // The core asks about every call of a turn before any runs, so approvals come before their calls.
    const denied = approval('r2', 'c2', { decision: 'deny', feedback: 'not now' });
    const allowed = approval('r1', 'c9', { decision: 'allow' });
    const blocks = toBlocks([call('c1'), allowed, denied, call('c2', { status: 'denied' })], []);
    expect(blocks).toEqual([
      {
        type: 'tools',
        id: 'c1',
        rows: [
          { call: call('c1'), approval: null },
          { call: call('c2', { status: 'denied' }), approval: denied },
        ],
      },
    ]);
  });
});

describe('toolSummary', () => {
  const row = (over: Partial<ToolCallItem>, asked: ApprovalItem | null = null) => ({
    call: call('c', over),
    approval: asked,
  });

  it('counts the lines of a file read, and the entries of a folder', () => {
    expect(toolSummary(row({ name: 'read', result: '1\ta\n2\tb\n[3 more lines. Read on]' }))).toMatchObject({
      type: 'count',
      unit: 'lines',
      count: 2,
    });
    expect(toolSummary(row({ name: 'read', result: 'src/\nREADME.md\n[5 more entries]' }))).toMatchObject({
      unit: 'entries',
      count: 7,
    });
  });

  it('counts what a search found, with what its note left out, and nothing as 0', () => {
    expect(toolSummary(row({ name: 'glob', result: 'a.py\nb.py\n[10 more files. Use a narrower]' }))).toMatchObject({
      unit: 'files',
      count: 12,
    });
    expect(toolSummary(row({ name: 'grep', result: 'No matches for TODO' }))).toMatchObject({
      unit: 'matches',
      count: 0,
    });
  });

  it("shows an edit's diff from its approval, without the file names, with what it added and removed", () => {
    const asked = approval('r', 'c', { previewKind: 'diff', preview: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n+c\n' });
    expect(toolSummary(row({ name: 'edit', result: 'Edited x' }, asked))).toEqual({
      type: 'output',
      text: '@@ -1 +1 @@\n-a\n+b\n+c',
      kind: 'diff',
      failed: false,
      added: 2,
      removed: 1,
    });
    expect(toolSummary(row({ name: 'edit', result: 'Edited x' }))).toMatchObject({ type: 'output', text: 'Edited x' });
  });

  it("shows a command's output, and a failure's message as failed", () => {
    expect(toolSummary(row({ result: 'ok\n\n' }))).toMatchObject({ type: 'output', text: 'ok', failed: false });
    expect(toolSummary(row({ name: 'read', status: 'error', result: 'no such file' }))).toMatchObject({
      type: 'output',
      failed: true,
    });
    expect(toolSummary(row({ result: '' }))).toEqual({ type: 'done' });
    expect(toolSummary(row({ status: 'error', result: '' }))).toEqual({ type: 'state' });
  });

  it('says only the state for a call that did not finish: the model-facing text would only repeat it', () => {
    for (const status of ['running', 'denied', 'cancelled', 'interrupted'] as const)
      expect(toolSummary(row({ status, result: 'The user declined this tool call.' }))).toEqual({ type: 'state' });
  });
});
