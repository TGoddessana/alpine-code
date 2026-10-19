import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import {
  publishServer,
  scriptedConnection,
  ServerProvider,
  type CloudScriptOptions,
  type ServerConnection,
} from '@/shared/server';

import { PublishButton } from './PublishButton';

function mount(options: CloudScriptOptions = {}, locale: Locale = 'ko') {
  const base = scriptedConnection(publishServer({ publishMs: 0, ...options }));
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const connection: ServerConnection = {
    request: (method, params) => {
      requests.push({ method, params: params as Record<string, unknown> });
      return base.request(method, params);
    },
    subscribe: base.subscribe,
  };
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale={locale}>
          <PublishButton cwd="/project" name="craft-booking" sessionId="session-1" defaultOpen />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { sent: (method: string) => requests.filter((r) => r.method === method).map((r) => r.params) };
}

const openDomains = async () => {
  fireEvent.click(await screen.findByRole('button', { name: '도메인·배지' }, { timeout: 4000 }));
  await screen.findByText('내 도메인과 배지');
};

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('도메인과 배지', () => {
  it('on the free plan shows the way to Pro for a domain, and the badge cannot be turned off', async () => {
    const { sent } = mount();
    await openDomains();
    expect(screen.getByText('내 도메인은 Pro에서 쓸 수 있어요.')).toBeTruthy();
    expect(screen.getByText('무료 플랜에서는 배지가 항상 보여요. Pro에서 끌 수 있어요.')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect(sent('publish/domains')).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Pro 알아보기' })[0]!);
    expect(await screen.findByText('Pro로 더 쓰기')).toBeTruthy();
  });

  it('adds a domain, lists its records with what each is for, and gives the AI the records to explain', async () => {
    const { sent } = mount({ plan: 'pro' });
    await openDomains();
    fireEvent.change(await screen.findByLabelText('도메인'), { target: { value: 'Booking.Example.com' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /메일도 보내기/ }));
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(await screen.findByText('사람들이 이 주소로 앱을 열 수 있게 해요')).toBeTruthy();
    expect(screen.getByText('내 도메인으로 보낸 메일이 스팸으로 가지 않게 해요 (SPF)')).toBeTruthy();
    expect(screen.getByText('메일이 정말 이 앱에서 왔다는 서명이에요 (DKIM)')).toBeTruthy();
    expect(sent('publish/addDomain')).toEqual([{ cwd: '/project', domain: 'Booking.Example.com', mail: true }]);

    fireEvent.click(screen.getByRole('button', { name: 'AI에게 연결 도와 달라고 하기' }));
    await waitFor(() => expect(sent('session/send')).toHaveLength(1));
    const text = String(sent('session/send')[0]!.text);
    expect(text).toContain('booking.example.com');
    expect(text).toContain('cname.alpinesite.app');
    expect(text).toContain('v=spf1');
  });

  it('offers a one-click connect instead when the registrar supports Domain Connect', async () => {
    mount({ plan: 'trial', domain: 'pending', domainConnect: true });
    await openDomains();
    const connect = await screen.findByRole('button', { name: 'Cloudflare에서 한 번에 연결' });
    expect(screen.queryByRole('button', { name: 'AI에게 연결 도와 달라고 하기' })).toBeNull();
    fireEvent.click(connect);
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('domain-connect'), '_blank', 'noopener');
  });

  it('turns the domain to connected when a check finds the records, and says it is still waiting before', async () => {
    const { sent } = mount({ plan: 'pro', domain: 'pending' });
    await openDomains();
    expect(await screen.findByText('확인 중이에요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '지금 확인하기' }));
    expect(await screen.findByText('아직 반영되지 않았어요. 조금 있다가 다시 확인해 주세요.')).toBeTruthy();
    expect(sent('publish/checkDomain')).toHaveLength(1);
  });

  it('shows a connected domain without records, and disconnects it after asking', async () => {
    const { sent } = mount({ plan: 'pro', domain: 'active' });
    await openDomains();
    expect(await screen.findByText('연결됐어요')).toBeTruthy();
    expect(screen.queryByText('사람들이 이 주소로 앱을 열 수 있게 해요')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '연결 끊기' }));
    expect(sent('publish/removeDomain')).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: '끊기' }));
    expect(await screen.findByText('아직 이은 도메인이 없어요.')).toBeTruthy();
    expect(sent('publish/removeDomain')).toEqual([{ cwd: '/project', id: 'dom_1' }]);
  });

  it('says a bad name in plain words', async () => {
    mount({ plan: 'pro' });
    await openDomains();
    fireEvent.change(await screen.findByLabelText('도메인'), { target: { value: 'not a domain' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(await screen.findByText(/도메인 주소가 올바르지 않아요/)).toBeTruthy();
  });

  it('lets Pro turn the badge off and on, through the server', async () => {
    const { sent } = mount({ plan: 'pro' });
    await openDomains();
    const badge = await screen.findByRole('checkbox', { name: /Alpine 배지 보이기/ });
    expect((badge as HTMLInputElement).checked).toBe(true);
    fireEvent.click(badge);
    await waitFor(() => expect(sent('publish/setBadge')).toEqual([{ cwd: '/project', badge: false }]));
    await waitFor(() =>
      expect((screen.getByRole('checkbox', { name: /Alpine 배지 보이기/ }) as HTMLInputElement).checked).toBe(false),
    );
  });

  it('shows how far back Pro goes in the restore list, with the way to it, on the free plan', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }, { timeout: 4000 }));
    expect(await screen.findByText('최근 7일 안의 지점만 보여요')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Pro에서는 최근 30일까지 되돌릴 수 있어요' }));
    expect(await screen.findByText('Pro로 더 쓰기')).toBeTruthy();
  });

  it('shows the Pro window with no hint', async () => {
    mount({ plan: 'pro' });
    fireEvent.click(await screen.findByRole('button', { name: '되돌리기' }, { timeout: 4000 }));
    expect(await screen.findByText('최근 30일 안의 지점만 보여요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Pro에서는/ })).toBeNull();
  });
});
