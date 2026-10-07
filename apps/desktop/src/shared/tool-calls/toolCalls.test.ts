import type { ApprovalItem } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { editDiff, toolKind, toolTarget } from './toolCalls';

describe('toolKind', () => {
  it('knows the core tools and the scripted ones', () => {
    expect(
      ['edit', 'edit_file', 'write', 'bash', 'read', 'read_file', 'grep', 'glob', 'propose_memory', 'x'].map(toolKind),
    ).toEqual(['edit', 'edit', 'edit', 'run', 'read', 'read', 'search', 'search', 'memory', 'other']);
  });
});

describe('toolTarget', () => {
  it('shows a pattern with where it looks, or the path or command', () => {
    expect(toolTarget({ args: { pattern: 'TODO', path: 'src' } })).toBe('TODO  src');
    expect(toolTarget({ args: { pattern: '*.py', path: null } })).toBe('*.py');
    expect(toolTarget({ args: { command: 'git status' } })).toBe('git status');
    expect(toolTarget({ args: { headline: '해요체로 쓴다', body: '…' } })).toBe('해요체로 쓴다');
  });
});

describe('editDiff', () => {
  const asked = (over: Partial<ApprovalItem>): ApprovalItem => ({
    id: 'a',
    kind: 'approval',
    callId: 'c',
    title: 'Edit a.ts',
    preview: '--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more\n',
    previewKind: 'diff',
    reason: null,
    remember: null,
    decision: 'allow',
    feedback: null,
    review: null,
    reviewError: null,
    tool: 'edit',
    args: { path: 'a.ts' },
    ...over,
  });

  it('drops the file names and counts the lines', () => {
    expect(editDiff(asked({}))).toEqual({ lines: ['@@ -1 +1,2 @@', '-old', '+new', '+more'], added: 2, removed: 1 });
  });

  it('is null without an approval or a diff', () => {
    expect(editDiff(null)).toBeNull();
    expect(editDiff(asked({ previewKind: 'command', preview: 'ls' }))).toBeNull();
  });
});
