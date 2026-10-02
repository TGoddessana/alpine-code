import type { ApprovalItem, ToolCallItem } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import type { Item } from '@/shared/server';

import { toBlocks, toolKind, toolSummary, toolTarget } from './blocks';

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
const message = (id: string): Item => ({ id, kind: 'agent_message', text: 'hi' });
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
  ...over,
});

describe('toBlocks', () => {
  it('joins tool calls in a row and splits them at messages', () => {
    const blocks = toBlocks([call('c1'), call('c2'), message('m1'), call('c3')]);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'item', 'tools']);
    expect(blocks[0]).toMatchObject({ rows: [{ call: { id: 'c1' } }, { call: { id: 'c2' } }] });
  });

  it('puts an approval with its call instead of drawing it, waiting or finished', () => {
    // The core asks about every call of a turn before any runs, so approvals come before their calls.
    const denied = approval('r2', 'c2', { decision: 'deny', feedback: 'not now' });
    const blocks = toBlocks([call('c1'), approval('r1', 'c9'), denied, call('c2', { status: 'denied' })]);
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

describe('toolKind', () => {
  it('knows the core tools and the scripted ones', () => {
    expect(['edit', 'edit_file', 'write', 'bash', 'read', 'read_file', 'grep', 'glob', 'x'].map(toolKind)).toEqual([
      'edit',
      'edit',
      'edit',
      'run',
      'read',
      'read',
      'search',
      'search',
      'other',
    ]);
  });
});

describe('toolTarget', () => {
  it('shows a pattern with where it looks, or the path or command', () => {
    expect(toolTarget(call('c', { name: 'grep', args: { pattern: 'TODO', path: 'src' } }))).toBe('TODO  src');
    expect(toolTarget(call('c', { name: 'glob', args: { pattern: '*.py', path: null } }))).toBe('*.py');
    expect(toolTarget(call('c', { args: { command: 'git status' } }))).toBe('git status');
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
