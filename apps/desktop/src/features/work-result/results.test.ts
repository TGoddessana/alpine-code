import type { ApprovalItem, ToolCallItem } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { workResult } from './results';

const call = (id: string, over: Partial<ToolCallItem>): ToolCallItem => ({
  id,
  kind: 'tool_call',
  name: 'edit',
  args: {},
  status: 'done',
  result: null,
  images: 0,
  commandResult: null,
  fileChanges: null,
  ...over,
});

const diffApproval = (callId: string, path: string, preview: string): ApprovalItem => ({
  id: `${callId}a`,
  kind: 'approval',
  callId,
  title: `Edit ${path}`,
  preview,
  previewKind: 'diff',
  reason: null,
  remember: null,
  decision: 'allow',
  feedback: null,
  review: null,
  reviewError: null,
  askedBy: [],
  tool: 'edit',
  args: { path },
});

describe('workResult', () => {
  it('keeps legacy file names but never presents approval previews as actual diffs', () => {
    const items = [
      diffApproval('e1', 'a.ts', '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'),
      call('e1', { args: { path: 'a.ts' } }),
      call('e2', { name: 'write', args: { path: 'b.ts' } }),
      diffApproval('e3', 'a.ts', '@@ -5 +5,2 @@\n+z\n+w\n'),
      call('e3', { args: { path: 'a.ts' } }),
    ];
    expect(workResult(items).files).toEqual([]);
    expect(workResult(items).legacyFiles).toEqual([
      { path: 'a.ts', added: 0, removed: 0, diff: null },
      { path: 'b.ts', added: 0, removed: 0, diff: null },
    ]);
  });

  it('uses the latest actual final diff, including changes by a failed shell or tool', () => {
    const final = { path: 'a.ts', added: 1, removed: 1, diff: ['@@ -1 +1 @@', '-original', '+final'] };
    const items = [
      diffApproval('e1', 'a.ts', '@@ -1 +1 @@\n-wrong\n+preview\n'),
      call('e1', { fileChanges: [{ ...final, diff: ['-original', '+intermediate'] }] }),
      call('e2', { name: 'custom_tool', status: 'error', fileChanges: [final] }),
    ];
    expect(workResult(items).files).toEqual([final]);
    expect(workResult([...items, call('undo', { name: 'bash', fileChanges: [] })]).files).toEqual([]);
  });

  it('counts only edits that finished', () => {
    const items = [
      call('e1', { args: { path: 'a.ts' }, status: 'running' }),
      call('e2', { args: { path: 'b.ts' }, status: 'denied' }),
      call('e3', { args: { path: 'c.ts' }, status: 'error' }),
    ];
    expect(workResult(items).files).toEqual([]);
  });

  it('lists the commands that ran or are running, not the ones that never ran', () => {
    const items = [
      call('r1', { name: 'bash', args: { command: 'pnpm test' }, status: 'error' }),
      call('r2', { name: 'bash', args: { command: 'rm -rf dist' }, status: 'denied' }),
      call('r3', { name: 'bash', args: { command: 'pnpm build' }, status: 'running' }),
      call('x', { name: 'read', args: { path: 'a.ts' } }),
    ];
    expect(workResult(items).commands).toEqual([
      { id: 'r1', command: 'pnpm test', status: 'error' },
      { id: 'r3', command: 'pnpm build', status: 'running' },
    ]);
  });
});
