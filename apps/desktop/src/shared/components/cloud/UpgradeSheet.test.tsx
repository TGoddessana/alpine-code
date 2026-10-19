import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import {
  cloudScript,
  scriptedConnection,
  ServerProvider,
  type CloudScriptOptions,
  type ServerConnection,
} from '@/shared/server';

import { UpgradeSheet, type UpgradeSheetProps } from './UpgradeSheet';

function mount(options: CloudScriptOptions = {}, props: Partial<UpgradeSheetProps> = {}, locale: Locale = 'ko') {
  const base = scriptedConnection(cloudScript({ signedIn: true, ...options }));
  const requests: { method: string; params: unknown }[] = [];
  const connection: ServerConnection = {
    request: (method, params) => {
      requests.push({ method, params });
      return base.request(method, params);
    },
    subscribe: base.subscribe,
  };
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale={locale}>
          <UpgradeSheet onDone={onDone} {...props} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { onDone, sent: (method: string) => requests.filter((r) => r.method === method).map((r) => r.params) };
}

beforeEach(() => {
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
});

describe('UpgradeSheet', () => {
  it('lists what Pro gives from the plan the server sends, and starts the free week without a card', async () => {
    const { onDone, sent } = mount({}, { reason: '실시간 웹앱은 Pro에서 만들 수 있어요.' });
    expect(await screen.findByText('실시간 웹앱은 Pro에서 만들 수 있어요.')).toBeTruthy();
    expect(await screen.findByText('매달 AI 크레딧 2,000')).toBeTruthy();
    expect(screen.getByText('최근 30일 안의 어느 때로든 되돌리기')).toBeTruthy();
    expect(screen.getByText('카드는 필요 없어요. 끝나면 무료 플랜으로 돌아가요.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '7일 무료로 써 보기' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(sent('cloud/startTrial')).toHaveLength(1);
    expect(sent('cloud/checkout')).toEqual([]);
  });

  it('opens the payment page in the browser and goes on by itself when the plan turns to Pro', async () => {
    const { onDone, sent } = mount({ checkoutMs: 20 });
    fireEvent.click(await screen.findByRole('button', { name: '바로 Pro 시작하기' }));
    expect(await screen.findByText('브라우저에서 결제를 마쳐 주세요')).toBeTruthy();
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('/v1/billing/fake/checkout'),
      '_blank',
      'noopener',
    );
    expect(sent('cloud/checkout')).toEqual([{ plan: 'pro' }]);
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it('can stop paying and come back to the plans while the browser is still open', async () => {
    const { onDone } = mount({ checkoutMs: null });
    fireEvent.click(await screen.findByRole('button', { name: '바로 Pro 시작하기' }));
    fireEvent.click(await screen.findByRole('button', { name: '결제 그만두기' }));
    expect(await screen.findByText('Pro로 더 쓰기')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('offers only subscribing when the free week was already used', async () => {
    mount({ plan: 'trial' });
    expect(await screen.findByText(/^무료 체험은 .+까지예요/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pro 시작하기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /무료로 써 보기/ })).toBeNull();
  });

  it('asks for the Alpine account first when signed out', async () => {
    mount({ signedIn: false });
    expect(await screen.findByText('Pro는 Alpine 계정에 붙어요. 먼저 로그인해 주세요.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Google로 계속하기' })).toBeTruthy();
  });

  it('speaks English', async () => {
    mount({}, {}, 'en');
    expect(await screen.findByRole('button', { name: 'Try it free for 7 days' })).toBeTruthy();
    expect(screen.getByText('Use your own domain as the app address')).toBeTruthy();
  });
});
