import type { ApprovalItem, ToolCallItem } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import type { Item } from '@/shared/server';

import { isFailed, toBlocks, toolKind, toolSummary, toolTarget } from './blocks';

const call = (id: string, over: Partial<ToolCallItem> = {}): ToolCallItem => ({
  id,
  kind: 'tool_call',
  name: 'bash',
  args: {},
  status: 'done',
  result: null,
  images: 0,
  detail: null,
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
  tool: 'bash',
  args: {},
  ...over,
});

describe('toBlocks', () => {
  it('joins tool calls in a row and splits them at messages', () => {
    const blocks = toBlocks([call('c1'), call('c2'), message('m1'), call('c3')], []);
    expect(blocks.map((b) => b.type)).toEqual(['tools', 'item', 'tools']);
    expect(blocks[0]).toMatchObject({ rows: [{ call: { id: 'c1' } }, { call: { id: 'c2' } }] });
  });

  it('draws a waiting approval where its call will be', () => {
    const waiting = approval('r1', 'c2');
    expect(toBlocks([call('c1'), waiting], ['r1'])).toEqual([
      { type: 'tools', id: 'c1', rows: [{ call: call('c1'), approval: null }] },
      { type: 'approval', item: waiting },
    ]);
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
    expect(['check', 'update_plan'].map(toolKind)).toEqual(['check', 'plan']);
  });
});

describe('toolTarget', () => {
  it('shows a pattern with where it looks, or the path or command', () => {
    expect(toolTarget(call('c', { name: 'grep', args: { pattern: 'TODO', path: 'src' } }))).toBe('TODO  src');
    expect(toolTarget(call('c', { name: 'glob', args: { pattern: '*.py', path: null } }))).toBe('*.py');
    expect(toolTarget(call('c', { args: { command: 'git status' } }))).toBe('git status');
  });

  it("shows a check's label, and nothing for the plan", () => {
    expect(toolTarget(call('c', { name: 'check', args: { label: 'type check' } }))).toBe('type check');
    expect(toolTarget(call('c', { name: 'update_plan', args: { steps: [] } }))).toBe('');
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

  it('says what a plan call changed, from what the harness saw', () => {
    const detail = {
      kind: 'plan' as const,
      created: true,
      steps: 5,
      checks: 3,
      finished: [],
      started: [],
      reopened: [],
      added: [],
      renamed: [],
      dropped: [],
      checksChanged: false,
    };
    expect(toolSummary(row({ name: 'update_plan', result: 'Plan updated', detail }))).toEqual({ type: 'plan', detail });
    // An update the model got wrong has no detail: its error shows like any other.
    expect(toolSummary(row({ name: 'update_plan', status: 'input_error', result: '(input error: two now)' }))).toEqual(
      expect.objectContaining({ type: 'output', failed: true }),
    );
  });

  it('says a harness check passed in a word, shows a failed one as its output, and an agent check as a claim', () => {
    const harness = (passed: boolean) => ({
      kind: 'check' as const,
      label: 'tests',
      judge: 'harness' as const,
      passed,
      evidence: ['c'],
    });
    expect(toolSummary(row({ name: 'check', result: 'ok\n[check passed]', detail: harness(true) }))).toEqual({
      type: 'passed',
    });
    const failing = row({ name: 'check', result: 'E boom\n[exit code 1: check failed]', detail: harness(false) });
    expect(toolSummary(failing)).toMatchObject({ type: 'output', text: 'E boom', failed: true });
    expect(isFailed(failing.call)).toBe(true);
    const claim = { ...harness(true), judge: 'agent' as const, evidence: ['a', 'b', 'c'] };
    expect(toolSummary(row({ name: 'check', result: 'Recorded', detail: claim }))).toEqual({
      type: 'judged',
      detail: claim,
    });
  });
});

describe('isFailed', () => {
  it('counts errors and checks that did not pass, not calls that did not run', () => {
    expect(
      ['error', 'input_error', 'aborted'].every((status) => isFailed(call('c', { status: status as 'error' }))),
    ).toBe(true);
    expect(
      ['done', 'denied', 'cancelled', 'interrupted'].some((status) =>
        isFailed(call('c', { status: status as 'done' })),
      ),
    ).toBe(false);
  });
});
