import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { cloudScript, scriptedConnection, ServerProvider, type CloudScriptOptions } from '@/shared/server';

import { AlpineAccount } from './AlpineAccount';

function mount(options: CloudScriptOptions = {}) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={scriptedConnection(cloudScript(options))}>
        <LocaleProvider locale="ko">
          <dl>
            <AlpineAccount />
          </dl>
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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
  vi.unstubAllGlobals();
});

describe('AlpineAccount', () => {
  it('shows who is signed in, the plan, the credits left and when they fill up again', async () => {
    mount({ signedIn: true, balance: 120 });
    expect(await screen.findByText('하늘 · haneul@example.com')).toBeTruthy();
    expect(screen.getByText('무료 플랜')).toBeTruthy();
    expect(screen.getByText(/^크레딧 120 남음 · .+에 다시 채워져요$/)).toBeTruthy();
  });

  it('says a trial is a trial, with its last day', async () => {
    mount({ signedIn: true, plan: 'trial' });
    expect(await screen.findByText(/^Pro 플랜 체험 중 · .+까지$/)).toBeTruthy();
  });

  it('offers Pro on the free plan, in a sheet, and starts the free week from there', async () => {
    mount({ signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Pro 알아보기' }));
    fireEvent.click(await screen.findByRole('button', { name: '7일 무료로 써 보기' }));
    expect(await screen.findByText(/^Pro 플랜 체험 중 · .+까지$/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Pro로 더 쓰기')).toBeNull());
    expect(screen.getByRole('button', { name: '구독하기' })).toBeTruthy();
  });

  it('closes the Pro sheet from Settings with 닫기: there is no step before it to go back to', async () => {
    mount({ signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Pro 알아보기' }));
    expect(screen.queryByRole('button', { name: '‹ 뒤로' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByText('Pro로 더 쓰기')).toBeNull());
  });

  it('closes the sign-in sheet from Settings with 닫기', async () => {
    mount({ signedIn: false });
    fireEvent.click(await screen.findByRole('button', { name: '로그인' }));
    expect(screen.queryByRole('button', { name: '‹ 뒤로' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: '닫기' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Google로 계속하기' })).toBeNull());
  });

  it('opens the subscription page for a paying account', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null);
    mount({ signedIn: true, plan: 'pro' });
    fireEvent.click(await screen.findByRole('button', { name: '구독 관리' }));
    await waitFor(() =>
      expect(window.open).toHaveBeenCalledWith(expect.stringContaining('/billing/fake/portal'), '_blank', 'noopener'),
    );
  });

  it('says the numbers are the last known ones when Alpine does not answer', async () => {
    mount({ signedIn: true, unreachable: true });
    expect((await screen.findByRole('status')).textContent).toContain('마지막으로 본 내용이에요');
  });

  it('signs out after asking, and then offers signing in', async () => {
    mount({ signedIn: true });
    fireEvent.click(await screen.findByRole('button', { name: '로그아웃' }));
    expect(await screen.findByText('Alpine에서 로그아웃할까요?')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '로그아웃' }).at(-1)!);
    expect(await screen.findByText('로그인 안 됨')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Alpine에서 로그아웃할까요?')).toBeNull());
    expect(screen.getByRole('button', { name: '로그인' })).toBeTruthy();
  });

  it('shows nothing until the server has answered', () => {
    const connection = scriptedConnection({});
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ServerProvider connection={connection}>
          <LocaleProvider locale="ko">
            <AlpineAccount />
          </LocaleProvider>
        </ServerProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Alpine 계정')).toBeNull();
  });
});
