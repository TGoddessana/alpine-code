import type { AgentInfo, OfferedTool, ToolsListResult } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { ServerProvider, type ServerConnection } from '@/shared/server';

import { AgentRows } from './AgentRows';

const offered = (name: string, origin: OfferedTool['origin'], optional = true): OfferedTool => ({
  tool: { name, description: '', params: [], readOnly: true, openWorld: false, ask: 'never' },
  origin,
  optional,
});

const tools: ToolsListResult = {
  tools: [
    ...['read', 'glob', 'grep', 'write', 'edit', 'bash'].map((name) => offered(name, 'builtin')),
    offered('propose_memory', 'memory', false),
  ],
  files: [],
  folder: '/tools',
};

const connection = {
  request: async (method: string) =>
    method === 'tools/list' ? tools : { connections: [], providers: [], defaultModel: null },
  subscribe: () => () => {},
} as unknown as ServerConnection;

function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">{children}</LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>
  );
}

const agent: AgentInfo = {
  id: 'a-review',
  name: '검토자',
  description: '',
  model: null,
  instructions: '',
  tools: ['read', 'grep'],
  look: 'glasses',
  color: 3,
};

const noop = () => {};

describe('AgentRows', () => {
  afterEach(cleanup);

  it('shows the memory tool as always on, with nothing to remove, and the built-ins as removable', async () => {
    const { findByText, getByRole, queryByRole } = render(
      <AgentRows
        agent={agent}
        flash={null}
        onChange={noop}
        onAdd={noop}
        onRemove={noop}
        onOpenTool={noop}
        onBrowse={noop}
        onNewTool={noop}
      />,
      { wrapper: Providers },
    );
    const memory = (await findByText('기억 제안')).parentElement!;
    expect(within(memory).getByText('· 항상 켜짐')).toBeTruthy();
    expect(queryByRole('button', { name: '기억 제안 빼기' })).toBeNull();
    expect(getByRole('button', { name: '파일 읽기 빼기' })).toBeTruthy();
    expect(await findByText('Alpine에 들어 있어요 · 3/7')).toBeTruthy();
  });
});
