import { describe, expect, it } from 'vitest';

import { activityWord } from './activity';

const tool = (toolName: string | null) => activityWord({ kind: 'running_tool', toolName });

describe('activityWord', () => {
  it('names the kinds of activity', () => {
    expect(activityWord({ kind: 'thinking', toolName: null })).toBe('thinking');
    expect(activityWord({ kind: 'writing', toolName: null })).toBe('writing');
    expect(activityWord({ kind: 'waiting_approval', toolName: 'bash' })).toBe('approval');
    expect(activityWord({ kind: 'compacting', toolName: null })).toBe('compacting');
    expect(activityWord(null)).toBe('thinking');
  });
  it('names a tool by what it does', () => {
    expect(tool('read')).toBe('reading');
    expect(tool('read_file')).toBe('reading');
    expect(tool('grep')).toBe('searching');
    expect(tool('glob')).toBe('searching');
    expect(tool('edit')).toBe('editing');
    expect(tool('write')).toBe('editing');
    expect(tool('bash')).toBe('running');
    expect(tool('web_fetch')).toBe('tool');
    expect(tool(null)).toBe('tool');
  });
});
