import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Item } from '@/shared/server';
import { LocaleProvider } from '@/shared/i18n';
import { useNavigation, visibleSessions } from '@/shared/navigation';
import {
  EXAMPLE_MAP,
  flowScript,
  mergeScripts,
  scriptedConnection,
  ServerProvider,
  sessionInfo,
  sessionScript,
  setUpScript,
} from '@/shared/server';
import type { ProjectInfo, SessionInfo } from '@alpine/protocol';

import { routeTree } from './routeTree.gen';

const app = '/Users/me/alpine-code';
const docs = '/Users/me/docs-site';
const q = (path: string) => `?project=${encodeURIComponent(path)}`;
const infos = () => [
  sessionInfo({ id: 'cart', cwd: app, title: '장바구니 고치기' }),
  sessionInfo({ id: 'readme', cwd: docs, title: 'README 다시 쓰기' }),
  sessionInfo({ id: 'deploy', cwd: docs, title: '배포 확인', status: 'waiting' }),
];

function mount(
  path: string,
  sessions: SessionInfo[] = infos(),
  projects?: ProjectInfo[],
  transcripts: Record<string, Item[]> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = scriptedConnection(
    mergeScripts(
      setUpScript(),
      sessionScript({ sessions: sessions.map((info) => ({ info, items: transcripts[info.id] })) }),
      flowScript(() => EXAMPLE_MAP),
      ...(projects ? [{ results: { 'projects/list': { projects, clones: [] } } }] : []),
    ),
  );
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">
          <RouterProvider router={router} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { router, connection };
}
const rail = () => screen.findByRole('navigation', { name: '주 메뉴' });
const toggle = (name: string, open: boolean) =>
  screen.findByRole('button', { name: `${name} ${open ? '접기' : '펼치기'}`, expanded: open });

beforeEach(() => {
  localStorage.clear();
  useNavigation.setState({
    expanded: {},
    lastSessions: {},
    lastProject: null,
    seen: {},
    since: new Date().toISOString(),
    pinnedProjects: [],
    sort: 'recent',
    searchOpen: false,
  });
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

describe('independent project browsing', () => {
  it('expands and collapses multiple projects without leaving the current conversation', async () => {
    const { router } = mount('/session/cart');
    fireEvent.click(await toggle('docs-site', false));
    expect(await within(await rail()).findByRole('link', { name: /README 다시 쓰기/ })).toBeTruthy();
    expect(within(await rail()).getByRole('link', { name: /장바구니 고치기/ })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/session/cart');
    fireEvent.click(await toggle('docs-site', true));
    expect(within(await rail()).queryByRole('link', { name: /README 다시 쓰기/ })).toBeNull();
    fireEvent.click(await toggle('alpine-code', true));
    await toggle('alpine-code', false);
    expect(router.state.location.pathname).toBe('/session/cart');
  });

  it('resumes the last conversation of a project instead of opening a new one', async () => {
    const { router } = mount('/session/readme');
    fireEvent.click(await screen.findByRole('button', { name: 'alpine-code 이어하기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/cart'));
    fireEvent.click(screen.getByRole('button', { name: 'docs-site 이어하기' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/readme'));
  });

  it('keeps project pages when changing project and starts new work in the current project', async () => {
    const { router } = mount('/board' + q(app));
    fireEvent.click(await screen.findByRole('button', { name: 'docs-site 이어하기' }));
    await waitFor(() => expect(router.state.location.href).toBe('/board' + q(docs)));
    expect(
      within(await rail())
        .getByRole('link', { name: /새 세션\s*⌘N/ })
        .getAttribute('href'),
    ).toBe('/' + q(docs));
    fireEvent.click(within(await rail()).getByRole('link', { name: '설정' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    await waitFor(() => expect(router.state.location.href).toBe('/' + q(docs)));
  });

  it('finds a waiting conversation across closed projects with one filter', async () => {
    mount('/session/cart');
    fireEvent.click(await screen.findByRole('button', { name: /내 확인 필요\s*1/ }));
    expect(await within(await rail()).findByRole('link', { name: /배포 확인/ })).toBeTruthy();
    expect(within(await rail()).queryByRole('link', { name: /장바구니 고치기/ })).toBeNull();
  });

  it('always offers All and restores the existing tree from an empty filter', async () => {
    const { router } = mount('/session/cart', [
      ...infos().filter((s) => s.status === 'idle'),
      ...Array.from({ length: 5 }, (_, i) =>
        sessionInfo({ id: `older-${i}`, cwd: app, title: `이전 대화 ${i}`, updatedAt: `2026-10-01T00:00:0${i}.000Z` }),
      ),
    ]);
    const nav = await rail();
    const filters = within(nav).getByRole('group', { name: '대화 보기' });
    expect(within(filters).getByRole('button', { name: '전체', pressed: true })).toBeTruthy();
    fireEvent.click(await toggle('docs-site', false));
    await within(nav).findByRole('link', { name: /README 다시 쓰기/ });
    fireEvent.click(within(nav).getByRole('button', { name: '1개 더 보기' }));
    expect(await within(nav).findByRole('link', { name: /이전 대화 0/ })).toBeTruthy();

    for (const name of ['내 확인 필요 0', '작업 중 0', '새 결과 0']) {
      fireEvent.click(within(filters).getByRole('button', { name }));
      expect(await within(nav).findByText('이곳에 표시할 대화가 없어요.')).toBeTruthy();
      expect(within(filters).getByRole('button', { name: '전체', pressed: false })).toBeTruthy();
      fireEvent.click(within(nav).getByRole('button', { name: '전체 대화 보기' }));
      expect(within(filters).getByRole('button', { name: '전체', pressed: true })).toBeTruthy();
      expect(await within(nav).findByRole('link', { name: /장바구니 고치기/ })).toBeTruthy();
      expect(within(nav).getByRole('link', { name: /README 다시 쓰기/ })).toBeTruthy();
      expect(within(nav).getByRole('link', { name: /이전 대화 0/ })).toBeTruthy();
      expect(router.state.location.pathname).toBe('/session/cart');
    }

    fireEvent.click(within(filters).getByRole('button', { name: '내 확인 필요 0' }));
    fireEvent.click(within(filters).getByRole('button', { name: '전체' }));
    expect(await within(nav).findByRole('link', { name: /장바구니 고치기/ })).toBeTruthy();
  });

  it('keeps current, pinned, failed and waiting sessions past the recent limit', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => sessionInfo({ id: String(i) }));
    sessions[6] = sessionInfo({ id: '6', pinned: true });
    sessions[7] = sessionInfo({ id: '7', status: 'waiting' });
    sessions[8] = sessionInfo({ id: '8', status: 'failed' });
    expect(visibleSessions(sessions, '9', false).map((s) => s.id)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '6',
      '7',
      '8',
      '9',
    ]);
  });

  it('searches and opens a session with the keyboard even with the sidebar hidden', async () => {
    const { router } = mount('/session/cart');
    await rail();
    fireEvent.click(screen.getByRole('button', { name: '사이드바 닫기' }));
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByRole('combobox', { name: '프로젝트와 대화 찾기' });
    fireEvent.change(input, { target: { value: 'README' } });
    await screen.findByRole('option', { name: /README 다시 쓰기/ });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/readme'));
  });

  it('renames, pins, archives and undoes an archive without losing history', async () => {
    const { connection } = mount('/session/cart');
    fireEvent.click(await screen.findByRole('button', { name: '장바구니 고치기 메뉴' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '이름 바꾸기…' }));
    const input = await screen.findByRole('textbox', { name: '대화 이름' });
    fireEvent.change(input, { target: { value: '결제 개선' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: '결제 개선 메뉴' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '고정' }));
    await waitFor(async () =>
      expect((await connection.request('session/list', {})).sessions.find((s) => s.id === 'cart')?.pinned).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: '결제 개선 메뉴' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '보관' }));
    expect(await screen.findByText('보관함으로 옮겼어요.')).toBeTruthy();
    expect((await connection.request('session/list', {})).sessions.find((s) => s.id === 'cart')?.archived).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '실행 취소' }));
    await waitFor(async () =>
      expect((await connection.request('session/list', {})).sessions.find((s) => s.id === 'cart')?.archived).toBe(
        false,
      ),
    );
  });

  it('finds important and older work across twenty projects and two hundred conversations', async () => {
    const projects = Array.from({ length: 20 }, (_, i) => ({
      path: `/Users/me/scale-${i}`,
      name: `scale-${i}`,
      branch: 'main',
      lastUsedAt: new Date().toISOString(),
      archived: false,
      lastAgent: null,
    }));
    const sessions = projects.flatMap((p, i) =>
      Array.from({ length: 10 }, (_, j) =>
        sessionInfo({
          id: `load-${i}-${j}`,
          cwd: p.path,
          title: `업무 ${i}-${j}`,
          pinned: j === 8,
          status: j === 9 ? 'waiting' : 'idle',
          updatedAt: new Date(Date.now() - j * 3_600_000).toISOString(),
        }),
      ),
    );
    const { router } = mount('/session/load-0-0', sessions, projects);
    expect(await within(await rail()).findByRole('link', { name: /업무 0-9/ })).toBeTruthy();
    expect(within(await rail()).getByRole('link', { name: /업무 0-8/ })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByRole('combobox', { name: '프로젝트와 대화 찾기' });
    fireEvent.change(input, { target: { value: '업무 19-9' } });
    await screen.findByRole('option', { name: /업무 19-9/ });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/load-19-9'));
  });

  it('shows unseen answers across projects and marks them read when opened', async () => {
    const sessions = infos();
    sessions[1] = sessionInfo({
      id: 'readme',
      cwd: docs,
      title: '새 답변',
      summary: '문서 점검을 끝냈어요.',
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const { router } = mount('/session/cart', sessions);
    fireEvent.click(await screen.findByRole('button', { name: '새 결과 1' }));
    fireEvent.click(await within(await rail()).findByRole('link', { name: /새 답변/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/readme'));
    await screen.findByRole('button', { name: '새 결과 0' });
    expect(useNavigation.getState().seen.readme).toBe(sessions[1]!.updatedAt);
  });

  it('finds a phrase from the transcript that is absent from the title and answer preview', async () => {
    const { router } = mount('/session/cart', infos(), undefined, {
      readme: [{ id: 'body-only', kind: 'user_message', text: '독특한본문구절을 점검해 줘' }],
    });
    await within(await rail()).findByRole('link', { name: /장바구니 고치기/ });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    const input = await screen.findByRole('combobox', { name: '프로젝트와 대화 찾기' });
    fireEvent.change(input, { target: { value: '독특한본문구절' } });
    const found = await screen.findByRole('option', { name: /README 다시 쓰기.*독특한본문구절/ });
    fireEvent.click(found);
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/readme'));
  });

  it('cycles conversations in both directions with Ctrl+Tab', async () => {
    const sessions = infos().map((s, i) => ({ ...s, createdAt: `2026-10-01T00:00:0${i}.000Z` }));
    const { router } = mount('/session/cart', sessions);
    await within(await rail()).findByRole('link', { name: /장바구니 고치기/ });
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/readme'));
    fireEvent.keyDown(window, { key: 'Tab', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe('/session/cart'));
  });

  it('remembers project expansion and the last conversation after navigation state is reloaded', async () => {
    mount('/session/readme');
    fireEvent.click(await toggle('alpine-code', false));
    const saved = localStorage.getItem('alpine.navigation.v1')!;
    cleanup();
    useNavigation.setState({ expanded: {}, lastSessions: {}, lastProject: null });
    localStorage.setItem('alpine.navigation.v1', saved);
    await useNavigation.persist.rehydrate();
    const reopened = mount('/');
    await waitFor(() => expect(reopened.router.state.location.pathname).toBe('/session/readme'));
    await toggle('alpine-code', true);
    await toggle('docs-site', true);
    expect(useNavigation.getState().lastSessions[docs]).toBe('readme');
  });

  it('restores archived projects from the archive', async () => {
    const { connection } = mount('/session/cart');
    fireEvent.click(await screen.findByRole('button', { name: 'infra-terraform 메뉴' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '보관' }));
    await screen.findByText('보관함으로 옮겼어요.');
    fireEvent.click(screen.getByRole('button', { name: '보관함' }));
    fireEvent.click(await screen.findByRole('button', { name: '복원' }));
    await waitFor(async () =>
      expect(
        (await connection.request('projects/list', {})).projects.find((p) => p.name === 'infra-terraform')?.archived,
      ).toBe(false),
    );
  });
});
