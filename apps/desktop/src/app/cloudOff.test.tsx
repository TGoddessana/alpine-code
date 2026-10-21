import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDockOpen, useDockTab } from '@/features/dock/state';
import { LocaleProvider } from '@/shared/i18n';
import {
  cloudScript,
  EXAMPLE_MAP,
  flowScript,
  mergeScripts,
  scriptedConnection,
  ServerProvider,
  sessionInfo,
  sessionScript,
  setUpScript,
} from '@/shared/server';

import { routeTree } from './routeTree.gen';

/**
 * Shipping hidden (docs/alpine-cloud.md): with Alpine Cloud off the app shows none of it, and with it on the same
 * screens show everything. Both run the whole app on the same scripted server; only `cloud/enabled` differs.
 */
const cwd = '/Users/me/alpine-code';

function mount(path: string, cloud: boolean) {
  const connection = scriptedConnection(
    mergeScripts(
      setUpScript(),
      cloudScript({ enabled: cloud, signedIn: true, data: 'live' }),
      { results: { 'devServers/list': { servers: [] } } },
      sessionScript({ sessions: [{ info: sessionInfo({ id: 'work', cwd, title: '장바구니 고치기' }), items: [] }] }),
      flowScript(() => EXAMPLE_MAP),
    ),
  );
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">
          <RouterProvider router={router} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}

/** Lets `cloud/enabled` and the queries behind it answer, so "not there" means "not there after asking". */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 150)));

beforeEach(() => {
  localStorage.clear();
  const open = renderHook(() => useDockOpen());
  act(() => open.result.current[1](true));
  open.unmount();
  const tab = renderHook(() => useDockTab());
  act(() => tab.result.current[1](''));
  tab.unmount();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('a session with Alpine Cloud', () => {
  it("has 올리기 in the top bar and 데이터 under the dock's ⋮", async () => {
    mount('/session/work', true);
    expect(await screen.findByRole('button', { name: /^올리기/ })).toBeTruthy();
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    await settle();
    fireEvent.click(within(dock).getByRole('button', { name: '더보기' }));
    expect(await screen.findByRole('menuitem', { name: '데이터' })).toBeTruthy();
  });
});

describe('a session without Alpine Cloud', () => {
  it('has no 올리기 in the top bar and no 데이터 tab in the dock', async () => {
    mount('/session/work', false);
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    expect(await within(dock).findByRole('tab', { name: '터미널' })).toBeTruthy();
    await settle();
    expect(screen.queryByRole('button', { name: /올리기/ })).toBeNull();
    fireEvent.click(within(dock).getByRole('button', { name: '더보기' }));
    expect(await screen.findByRole('menuitem', { name: '크게 보기' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '데이터' })).toBeNull();
  });
});

describe('프로젝트 추가', () => {
  const open = async () => {
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트 추가' }));
    return within(await screen.findByRole('dialog')).getAllByRole('button');
  };

  it('lists 새로 만들기 with Alpine Cloud', async () => {
    mount('/session/work', true);
    await settle();
    expect((await open()).map((row) => row.textContent?.slice(0, 5))).toContain('새로 만들');
  });

  it('lists only 받기 and 열기 without it, as before', async () => {
    mount('/session/work', false);
    await settle();
    expect((await open()).map((row) => row.textContent)).toEqual([
      '회사·팀 프로젝트 받기GitHub, GitLab 같은 저장소 주소로',
      '내 컴퓨터의 프로젝트 열기이미 이 컴퓨터에 있는 폴더⌘O',
    ]);
  });
});

describe('Settings', () => {
  it('shows the Alpine account and the Alpine start row with Alpine Cloud', async () => {
    mount('/settings', true);
    expect(await screen.findByText('Alpine 계정')).toBeTruthy();
  });

  it('shows no Alpine account without it, and no Alpine row where a connection is added', async () => {
    mount('/settings', false);
    await screen.findByText('서버');
    await settle();
    expect(screen.queryByText('Alpine 계정')).toBeNull();
    fireEvent.click(await screen.findByRole('tab', { name: /모델 연결/ }));
    fireEvent.click(await screen.findByRole('button', { name: /공급자 추가/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /ChatGPT/ })).toBeTruthy();
    expect(within(sheet).queryByText(/Alpine으로 시작/)).toBeNull();
  });
});

describe('the new session', () => {
  it('says what to change and judges nothing without Alpine Cloud', async () => {
    mount('/', false);
    await waitFor(() => expect(screen.getByRole('heading', { name: '무엇을 바꿔 볼까요?' })).toBeTruthy());
    expect(screen.queryByRole('heading', { name: '무엇을 만들어 볼까요?' })).toBeNull();
  });
});
