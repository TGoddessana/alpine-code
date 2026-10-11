import type { ToolFileInfo, ToolSummary, ToolsListResult } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { AGENTS } from '@/shared/server/toolsScript';

import { cards } from './cards';

const summary = (name: string, description: string): ToolSummary => ({
  name,
  description,
  params: [],
  readOnly: true,
  openWorld: false,
  ask: 'never',
});

const file = (name: string, patch: Partial<ToolFileInfo> = {}): ToolFileInfo => ({
  name,
  status: 'ready',
  error: null,
  missingPackage: null,
  changedAt: null,
  tools: [],
  packages: [],
  ...patch,
});

const tools: ToolsListResult = {
  tools: [],
  folder: '/tools',
  files: [
    file('fetch', { tools: [summary('fetch', 'Get a page.\nMore detail.')] }),
    file('reports', { tools: [summary('daily', 'Daily report'), summary('weekly', 'Weekly report')] }),
    file('order_stats', { status: 'unconfirmed', changedAt: '2026-10-09T01:00:00Z' }),
    file('csv_summary', { status: 'error', error: 'Line 1: invalid syntax' }),
    file('empty'),
  ],
};

const [, site, review] = AGENTS as [(typeof AGENTS)[number], (typeof AGENTS)[number], (typeof AGENTS)[number]];

describe('cards', () => {
  it('makes one card per tool and one per file that cannot load', () => {
    expect(cards(tools, site, AGENTS).map((c) => [c.tool, c.file, c.status])).toEqual([
      ['fetch', 'fetch', 'ready'],
      ['daily', 'reports', 'ready'],
      ['weekly', 'reports', 'ready'],
      ['order_stats', 'order_stats', 'unconfirmed'],
      ['csv_summary', 'csv_summary', 'error'],
    ]);
  });

  it('says what a tool does in its first line', () => {
    expect(cards(tools, site, AGENTS)[0]).toMatchObject({ label: 'fetch', does: 'Get a page.' });
  });

  it('marks what the agent has and names the other agents that have it', () => {
    const [fetch, daily] = cards(tools, site, AGENTS);
    expect(fetch).toMatchObject({ added: true, usedBy: [''] });
    expect(daily).toMatchObject({ added: false, usedBy: [] });
    expect(cards(tools, review, AGENTS)[0]).toMatchObject({ added: false, usedBy: ['', '홈페이지 담당'] });
  });

  it('words agent names the way the caller asks', () => {
    const named = cards(tools, review, AGENTS, (a) => a.name || '기본 에이전트');
    expect(named[0]!.usedBy).toEqual(['기본 에이전트', '홈페이지 담당']);
  });

  it('keeps why a file did not load', () => {
    const [, , , unconfirmed, broken] = cards(tools, site, AGENTS);
    expect(unconfirmed).toMatchObject({ changedAt: '2026-10-09T01:00:00Z', added: false });
    expect(broken).toMatchObject({ error: 'Line 1: invalid syntax' });
  });
});
