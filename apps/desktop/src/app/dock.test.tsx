import type { ApprovalItem, ToolCallItem, TerminalProcess } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDockOpen, useDockTab } from '@/features/dock/state';
import { LocaleProvider } from '@/shared/i18n';
import {
  EXAMPLE_MAP,
  flowScript,
  mergeScripts,
  PROJECTS,
  scriptedConnection,
  type Script,
  ServerProvider,
  sessionInfo,
  sessionScript,
  setUpScript,
} from '@/shared/server';

import { routeTree } from './routeTree.gen';

vi.mock('@/features/terminal/TerminalScreen', () => ({
  default: ({ label }: { label: string }) => <textarea aria-label={label} />,
}));

const cwd = '/Users/me/alpine-code';
const edit: ToolCallItem = {
  id: 'e1',
  kind: 'tool_call',
  name: 'edit',
  args: { path: 'src/Cart.tsx' },
  status: 'done',
  result: null,
  images: 0,
  commandResult: null,
  fileChanges: [{ path: 'src/Cart.tsx', added: 1, removed: 1, diff: ['@@ -1 +1 @@', '-x', '+y'] }],
};
const approval: ApprovalItem = {
  id: 'e1a',
  kind: 'approval',
  callId: 'e1',
  title: 'Edit src/Cart.tsx',
  preview: '@@ -1 +1 @@\n-x\n+y\n',
  previewKind: 'diff',
  reason: null,
  remember: null,
  decision: 'allow',
  feedback: null,
  review: null,
  reviewError: null,
  askedBy: [],
  tool: 'edit',
  args: { path: 'src/Cart.tsx' },
};

/** `extra` answers after the defaults, so a test can change one result (e.g. an archived project). */
function mount(path: string, extra: Script = {}, running = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = scriptedConnection(
    mergeScripts(
      setUpScript(),
      { results: { 'devServers/list': { servers: [] } } },
      sessionScript({
        sessions: [
          {
            info: sessionInfo({ id: 'work', cwd, title: '장바구니 고치기', status: running ? 'running' : 'idle' }),
            items: [approval, edit],
          },
          { info: sessionInfo({ id: 'elsewhere', cwd: '/Users/me/docs-site' }), items: [approval, edit] },
        ],
      }),
      flowScript(() => EXAMPLE_MAP),
      extra,
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
}

const board = (session?: string) => `/board?project=${encodeURIComponent(cwd)}${session ? `&session=${session}` : ''}`;
const toggle = () => screen.findByRole('button', { name: '오른쪽 창 닫기', pressed: true });
/** The dock's open state is shared across a test file: set it for each test (it is remembered, as in the app). */
function setDock(value: boolean) {
  const { result, unmount } = renderHook(() => useDockOpen());
  act(() => result.current[1](value));
  unmount();
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('alpine.rail.open', 'false');
  setDock(false);
  // Each test starts on the route's first tab; another test may have selected a project tool.
  const selection = renderHook(() => useDockTab());
  act(() => selection.result.current[1](''));
  selection.unmount();
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

describe('right dock on the routes', () => {
  it('opens actual execution state when the running conversation is stopped', async () => {
    mount('/session/work', { results: { 'processes/list': { processes: [], tools: [] } } }, true);
    fireEvent.click(await screen.findByRole('button', { name: '멈추기' }));
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    expect(within(dock).getByRole('tab', { name: '에이전트 실행', selected: true })).toBeTruthy();
    expect(await within(dock).findByRole('region', { name: '에이전트 실행' })).toBeTruthy();
  });

  it('opens the actual source viewer from a changed file and exposes the project execution tools', async () => {
    let shell: TerminalProcess | null = null;
    let launches = 0;
    mount('/session/work', {
      results: {
        'files/read': ({ cwd: project, path, line = 1 }) => ({
          path: `${project}/${path}`,
          relativePath: path,
          line,
          content: 'export const cart = true;',
          startLine: 1,
          totalLines: 1,
          truncated: false,
        }),
        'terminals/list': () => ({ processes: shell ? [shell] : [] }),
        'terminals/start': ({ command, title, kind, sessionId }) => {
          launches++;
          shell = {
            id: 'default-shell',
            command,
            title: title!,
            kind,
            sessionId,
            cwd,
            pty: true,
            pid: 42,
            status: 'running',
            createdAt: 1,
            outputSize: 0,
            cancelled: false,
          };
          return { process: shell };
        },
        'devServers/list': { servers: [] },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: '오른쪽 창 열기, 바뀐 파일 1개' }));
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    fireEvent.click(await within(dock).findByRole('button', { name: /Cart\.tsx/ }));
    expect(within(dock).getByRole('tab', { name: '변경 사항', selected: true })).toBeTruthy();
    expect(within(dock).getByRole('region', { name: 'Cart.tsx 바뀐 내용' })).toBeTruthy();
    fireEvent.click(await within(dock).findByRole('button', { name: '전체 파일 보기' }));
    expect(within(dock).getByRole('tab', { name: '파일', selected: true })).toBeTruthy();
    expect(await within(dock).findByText('export const cart = true;')).toBeTruthy();
    fireEvent.click(within(dock).getByRole('button', { name: '변경 사항으로 돌아가기' }));
    expect(within(dock).getByRole('region', { name: 'Cart.tsx 바뀐 내용' })).toBeTruthy();
    expect(within(dock).getByRole('tab', { name: '변경 사항', selected: true })).toBeTruthy();
    fireEvent.click(within(dock).getByRole('tab', { name: '터미널' }));
    expect(await within(dock).findByRole('textbox', { name: '터미널 입력: 셸 1' })).toBeTruthy();
    expect(launches).toBe(1);
    expect(within(dock).queryByRole('tab', { name: '개발 서버' })).toBeNull();
    fireEvent.click(within(dock).getByRole('button', { name: '터미널 메뉴' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '개발 서버 실행…' }));
    expect(await within(dock).findByRole('tab', { name: '개발 서버', selected: true })).toBeTruthy();
    expect(await within(dock).findByRole('button', { name: '서버 실행' })).toBeTruthy();
    fireEvent.click(within(dock).getByRole('button', { name: '개발 서버 탭 닫기' }));
    expect(within(dock).queryByRole('tab', { name: '개발 서버' })).toBeNull();
    expect(within(dock).getByRole('tab', { name: '터미널', selected: true })).toBeTruthy();
    expect(await within(dock).findByRole('textbox', { name: '터미널 입력: 셸 1' })).toBeTruthy();
    expect(launches).toBe(1);
  });

  it('opens from the top bar on a session and shows its work result', async () => {
    mount('/session/work');
    fireEvent.click(await screen.findByRole('button', { name: '오른쪽 창 열기, 바뀐 파일 1개' }));
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    expect(within(dock).getByRole('tab', { name: '변경 사항', selected: true })).toBeTruthy();
    expect(await within(dock).findByRole('button', { name: /Cart\.tsx/ })).toBeTruthy();
    fireEvent.click(await toggle());
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '오른쪽 창' })).toBeNull());
  });

  it('opens on the product map with the attached session, and the top bar shows the project and the count', async () => {
    mount(board('work'));
    expect(await screen.findByText('alpine-code', { selector: 'span' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: '오른쪽 창 열기, 바뀐 파일 1개' }));
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    // The map's session sits in the dock: its conversation first, then what it changed.
    expect(within(dock).getByRole('tab', { name: '작업 내용' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(dock).getByRole('tab', { name: '변경 사항' }));
    expect(await within(dock).findByRole('button', { name: /Cart\.tsx/ })).toBeTruthy();
  });

  it('says plainly that no work is connected when the product map has no session', async () => {
    mount(board());
    fireEvent.click(await screen.findByRole('button', { name: '오른쪽 창 열기' }));
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    expect(within(dock).getByText('아직 연결된 작업이 없어요')).toBeTruthy();
  });

  it('does not show the work of a session from another project on the map', async () => {
    mount(board('elsewhere'));
    fireEvent.click(await screen.findByRole('button', { name: '오른쪽 창 열기' }));
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    expect(within(dock).getByText('아직 연결된 작업이 없어요')).toBeTruthy();
  });

  it('remembers that it is open, and 크게 보기 hides the map until it is shrunk', async () => {
    setDock(true);
    mount(board());
    const dock = await screen.findByRole('complementary', { name: '오른쪽 창' });
    const map = await screen.findByRole('main', { hidden: true });
    expect(map.parentElement!.className).not.toContain('hidden');
    fireEvent.click(within(dock).getByRole('button', { name: '크게 보기' }));
    expect(map.parentElement!.className).toContain('hidden');
    fireEvent.click(within(dock).getByRole('button', { name: '작게 보기' }));
    expect(map.parentElement!.className).not.toContain('hidden');
  });

  it('shows no dock button for a project that is not listed', async () => {
    mount('/board?project=' + encodeURIComponent('/Users/me/gone'));
    expect(await screen.findByText('/Users/me/gone')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /오른쪽 창/ })).toBeNull();
  });

  it('shows no dock button for an archived project, which the board renders without a dock', async () => {
    const archived = PROJECTS.map((p) => (p.path === cwd ? { ...p, archived: true } : p));
    mount(board('work'), { results: { 'projects/list': { projects: archived, clones: [] } } });
    expect(await screen.findByText(cwd)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /오른쪽 창/ })).toBeNull();
  });

  it.each([
    [700, true],
    [1400, false],
  ])('with the map area %ipx wide, an open feature panel overlays the dock: %s', async (width, overlaid) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: (entries: unknown[]) => void) {}
        observe() {
          this.callback([{ contentRect: { width } }]);
        }
        disconnect() {}
      },
    );
    setDock(true);
    mount(board());
    fireEvent.click(await screen.findByRole('button', { name: /장바구니/ }));
    const panel = await screen.findByRole('complementary', { name: /장바구니/ });
    expect(panel.closest('[data-overlay]') !== null).toBe(overlaid);
    expect(screen.getByRole('complementary', { name: '오른쪽 창' })).toBeTruthy();
  });
});

it('shows the development server tab when a real registered server is discovered', async () => {
  mount('/session/work', {
    results: {
      'devServers/list': {
        servers: [
          {
            id: 'web',
            cwd,
            command: 'pnpm dev',
            port: 5173,
            status: 'running',
            url: 'http://localhost:5173',
            external: false,
          },
        ],
      },
    },
  });
  fireEvent.click(await screen.findByRole('button', { name: '오른쪽 창 열기, 바뀐 파일 1개' }));
  expect(await screen.findByRole('tab', { name: '개발 서버' })).toBeTruthy();
});
