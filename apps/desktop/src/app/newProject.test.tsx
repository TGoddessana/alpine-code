import type { ProjectInfo } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavigation } from '@/shared/navigation';
import { LocaleProvider } from '@/shared/i18n';
import { chatScript, mergeScripts, PROJECTS, scriptedConnection, ServerProvider } from '@/shared/server';

import { routeTree } from './routeTree.gen';

const MADE: ProjectInfo = {
  path: '/Users/me/AlpineCode/craft-booking',
  name: 'craft-booking',
  branch: 'main',
  lastUsedAt: new Date().toISOString(),
  archived: false,
  lastAgent: null,
};

/**
 * The scripted server, whose list of projects gains the new project once a session exists in its folder. It starts on
 * the first project's new session, or at `path`; `known` are the projects it has to begin with.
 */
function mount(path = `/?project=${encodeURIComponent(PROJECTS[0]!.path)}`, known: ProjectInfo[] = PROJECTS) {
  const script = mergeScripts(chatScript({ newProject: { judgeMs: 0, createMs: 0 } }), {
    results: {
      'projects/list': async () => {
        const { sessions } = await connection.request('session/list', {});
        const made = sessions.some((s) => s.cwd === MADE.path);
        return { projects: made ? [MADE, ...known] : known, clones: [] };
      },
    },
  });
  const connection = scriptedConnection(script);
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
  return { router };
}

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

describe('making a new project from the new session screen', () => {
  it('ends in the new project, with the session that works on the idea open', async () => {
    const { router } = mount();
    fireEvent.input(await screen.findByLabelText('메시지'), {
      target: { value: '동네 공방 원데이 클래스를 예약받는 페이지를 만들어 줘' },
    });
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
    fireEvent.click(await screen.findByRole('button', { name: '만들기' }));
    fireEvent.click(await screen.findByRole('button', { name: '세션으로 가기' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/session\/s-/));
    // The rail is now in the new project: its new-session link goes there, and the project is the one shown.
    const rail = await screen.findByRole('navigation', { name: '주 메뉴' });
    await waitFor(() =>
      expect(
        within(rail)
          .getByRole('link', { name: /새 세션\s*⌘N/ })
          .getAttribute('href'),
      ).toBe(`/?project=${encodeURIComponent(MADE.path)}`),
    );
    expect(within(rail).getByText('craft-booking')).toBeTruthy();
  });
});

describe('새로 만들기 (/?new=1)', () => {
  const IDEA = '동네 공방 원데이 클래스를 예약받는 페이지를 만들어 줘';
  const send = async () => {
    fireEvent.input(await screen.findByLabelText('메시지'), { target: { value: IDEA } });
    fireEvent.click(screen.getByRole('button', { name: '보내기' }));
  };

  it('shows the new session, not the first screen, even when there are no projects at all', async () => {
    const { router } = mount('/?new=1', []);
    expect(await screen.findByRole('heading', { name: '무엇을 만들어 볼까요?' })).toBeTruthy();
    expect(screen.queryByText('어떤 프로젝트로 시작할까요?')).toBeNull();
    expect(screen.getByRole('button', { name: '프로젝트: 새 프로젝트' })).toBeTruthy();
    expect(router.state.location.search).toEqual({ new: 1 });
  });

  it('is reached from the first screen, whose first row is 새로 만들기', async () => {
    const { router } = mount('/', []);
    expect(await screen.findByText('어떤 프로젝트로 시작할까요?')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /^새로 만들기/ }));
    await waitFor(() => expect(router.state.location.href).toBe('/?new=1'));
    expect(await screen.findByRole('heading', { name: '무엇을 만들어 볼까요?' })).toBeTruthy();
  });

  it('is reached from the project chip, and ends in the new project with its session open', async () => {
    const { router } = mount();
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트: alpine-code' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '프로젝트 추가…' }));
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: /^새로 만들기/ }));
    await waitFor(() => expect(router.state.location.href).toBe('/?new=1'));

    await send();
    fireEvent.click(await screen.findByRole('button', { name: '만들기' }));
    fireEvent.click(await screen.findByRole('button', { name: '세션으로 가기' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/session\/s-/));
  });

  it('is left by picking a project in the chip', async () => {
    const { router } = mount('/?new=1');
    fireEvent.click(await screen.findByRole('button', { name: '프로젝트: 새 프로젝트' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /docs-site/ }));
    await waitFor(() => expect(router.state.location.href).toBe(`/?project=${encodeURIComponent(PROJECTS[1]!.path)}`));
    expect(await screen.findByRole('heading', { name: '무엇을 해 볼까요?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '프로젝트: docs-site' })).toBeTruthy();
  });
});
