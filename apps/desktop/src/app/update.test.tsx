import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { scriptedConnection, ServerProvider, setUpScript } from '@/shared/server';

import { routeTree } from './routeTree.gen';

const update = vi.hoisted(() => ({ ready: null as string | null, restart: vi.fn() }));
vi.mock('@/shared/platform', async (original) => ({
  ...(await original<typeof import('@/shared/platform')>()),
  useUpdateReady: () => update.ready,
  restartToUpdate: update.restart,
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(
    <QueryClientProvider client={client}>
      <ServerProvider connection={scriptedConnection(setUpScript())}>
        <LocaleProvider locale="ko">
          <RouterProvider router={router} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  update.ready = null;
});

describe('the update button', () => {
  it('stays away until a newer version has downloaded', async () => {
    mount();
    await screen.findByRole('button', { name: '뒤로' });
    expect(screen.queryByRole('button', { name: '다시 시작해서 업데이트' })).toBeNull();
  });

  it('restarts into the downloaded version', async () => {
    update.ready = '0.1.2';
    mount();
    const button = await screen.findByRole('button', { name: '다시 시작해서 업데이트' });
    expect(button.title).toBe('0.1.2 버전이 준비됐어요');
    fireEvent.click(button);
    expect(update.restart).toHaveBeenCalledOnce();
  });
});
