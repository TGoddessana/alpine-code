import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

describe('project pages', () => {
  it('has no page links under the project or in the top bar: the project name opens its map', async () => {
    mount('/memory' + q(cwd));
    const name = await screen.findByRole('button', { name: 'alpine-code 열기' });
    expect(screen.queryByRole('link', { name: '지도' })).toBeNull();
    expect(screen.queryByRole('link', { name: '기억' })).toBeNull();
    fireEvent.click(name);
    expect(await screen.findByRole('main', { name: '제품 지도' })).toBeTruthy();
  });

  it('opens the memory from the project menu', async () => {
    mount('/board' + q(cwd));
    fireEvent.click(await screen.findByRole('button', { name: 'alpine-code 메뉴' }));
    const memory = await screen.findByRole('menuitem', { name: '기억 열기' });
    expect(memory.getAttribute('href')).toBe('/memory' + q(cwd));
  });

  it('shows the memory without a dock button', async () => {
    mount('/memory' + q(cwd));
    expect(await screen.findByText('alpine-code', { selector: 'span[title]' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /오른쪽 창/ })).toBeNull();
  });
});
