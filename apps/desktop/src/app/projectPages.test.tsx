import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import {
  EXAMPLE_MAP,
  flowScript,
  mergeScripts,
  PROJECTS,
  scriptedConnection,
  ServerProvider,
  setUpScript,
} from '@/shared/server';

import { routeTree } from './routeTree.gen';

const cwd = '/Users/me/alpine-code';
const q = (path: string) => `?project=${encodeURIComponent(path)}`;

function mount(path: string, projects = PROJECTS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = scriptedConnection(
    mergeScripts(
      setUpScript(),
      flowScript(() => EXAMPLE_MAP),
      {
        results: { 'projects/list': { projects, clones: [] } },
      },
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

beforeEach(() => {
  localStorage.clear();
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

describe('project pages in the rail', () => {
  it('lists 지도 and 기억 under the project, linking to its pages, the current one marked', async () => {
    mount('/memory' + q(cwd));
    const pages = await screen.findByRole('navigation', { name: 'alpine-code 화면' });
    const map = within(pages).getByRole('link', { name: '지도' });
    const memory = within(pages).getByRole('link', { name: '기억' });
    expect(map.getAttribute('href')).toBe('/board' + q(cwd));
    expect(memory.getAttribute('href')).toBe('/memory' + q(cwd));
    await waitFor(() => expect(memory.getAttribute('aria-current')).toBe('page'));
    expect(map.getAttribute('aria-current')).toBeNull();
  });

  it('marks 지도 on the board', async () => {
    mount('/board' + q(cwd));
    const pages = await screen.findByRole('navigation', { name: 'alpine-code 화면' });
    await waitFor(() =>
      expect(within(pages).getByRole('link', { name: '지도' }).getAttribute('aria-current')).toBe('page'),
    );
  });

  it('no longer offers 기억 열기 in the project menu', async () => {
    mount('/board' + q(cwd));
    const trigger = await screen.findByRole('button', { name: 'alpine-code 메뉴' });
    fireEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: '새 세션' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: '기억 열기' })).toBeNull();
  });
});

describe('page tabs in the top bar', () => {
  const bar = () => screen.findByRole('navigation', { name: '프로젝트 화면' });

  it('on the board select 지도 and link to the memory', async () => {
    mount('/board' + q(cwd));
    const tabs = await bar();
    expect(within(tabs).getByRole('link', { name: '지도' }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByRole('link', { name: '기억' }).getAttribute('href')).toBe('/memory' + q(cwd));
  });

  it('on the memory select 기억, link back to the map, and show no dock button', async () => {
    mount('/memory' + q(cwd));
    const tabs = await bar();
    expect(within(tabs).getByRole('link', { name: '기억' }).getAttribute('aria-current')).toBe('page');
    expect(within(tabs).getByRole('link', { name: '지도' }).getAttribute('href')).toBe('/board' + q(cwd));
    expect(screen.queryByRole('button', { name: /오른쪽 창/ })).toBeNull();
  });

  it('are hidden for an unknown project', async () => {
    mount('/memory' + q('/Users/me/gone'));
    expect(await screen.findByText('gone')).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '프로젝트 화면' })).toBeNull();
  });

  it('are hidden for an archived project', async () => {
    mount(
      '/board' + q(cwd),
      PROJECTS.map((p) => (p.path === cwd ? { ...p, archived: true } : p)),
    );
    expect(await screen.findByText(cwd)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '프로젝트 화면' })).toBeNull();
  });
});
