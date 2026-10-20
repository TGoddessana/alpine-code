import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { firstRunScript, scriptedConnection, ServerProvider } from '@/shared/server';

import { FirstRun } from './FirstRun';

function mount(auto = true, cloud = true) {
  const connection = scriptedConnection(firstRunScript('connected', { signInMs: 0, enabled: cloud }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">
          <FirstRun auto={auto} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('FirstRun', () => {
  it('has no Alpine row without Alpine Cloud: the list starts at ChatGPT, and says only to connect a model', async () => {
    mount(true, false);
    await screen.findByText('모델 연결');
    const rows = screen.getAllByRole('radio');
    expect(rows.map((row) => row.textContent)).not.toContain('Alpine으로 시작');
    expect(screen.queryByText(/Alpine으로 시작|크레딧/)).toBeNull();
    expect(rows[0]!.textContent).toContain('ChatGPT');
    expect(rows[0]).toHaveProperty('ariaChecked', 'true');
    expect(screen.getByText('모델 연결')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ChatGPT로 계속하기' })).toBeTruthy();
  });

  it('makes "Alpine으로 시작" the first row, and choosing it signs in for real, ending with the free credits', async () => {
    mount();
    await screen.findByRole('radio', { name: /Alpine으로 시작/ });
    const rows = screen.getAllByRole('radio');
    expect(rows[0]!.textContent).toContain('Alpine으로 시작');
    expect(rows[0]).toHaveProperty('ariaChecked', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Alpine으로 시작하기' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Google로 계속하기' }));
    expect(await screen.findByText('무료 크레딧 300을 드렸어요.')).toBeTruthy();
    expect(window.open).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it("stays closed away from the new session, so it never covers another screen's sheet", async () => {
    mount(false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
