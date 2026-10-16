import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
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

import { routeTree } from './routeTree.gen';

const app = '/Users/me/alpine-code';
const docs = '/Users/me/docs-site';
const q = (path: string) => `?project=${encodeURIComponent(path)}`;

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = scriptedConnection(
    mergeScripts(
      setUpScript(),
      sessionScript({
        sessions: [
          { info: sessionInfo({ id: 'cart', cwd: app, title: '장바구니 고치기' }) },
          { info: sessionInfo({ id: 'readme', cwd: docs, title: 'README 다시 쓰기' }) },
          { info: sessionInfo({ id: 'deploy', cwd: docs, title: '배포 확인', status: 'waiting' }) },
        ],
      }),
      flowScript(() => EXAMPLE_MAP),
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
  return router;
}

const rail = () => screen.findByRole('navigation', { name: '주 메뉴' });
/** A project's line: open (the current one) or closed, and what it is doing when it says so. */
const row = (name: string, open: boolean, doing = '') =>
  screen.findByRole('button', { name: new RegExp(`^${name}\\s*${doing}$`), expanded: open });

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

describe('the rail opens only the current project', () => {
  it("opens the open session's project, with only its sessions, and closes the others", async () => {
    mount('/session/readme');
    await row('docs-site', true);
    await row('alpine-code', false);
    await row('infra-terraform', false);
    const nav = await rail();
    expect(await within(nav).findByRole('link', { name: /README 다시 쓰기/ })).toBeTruthy();
    expect(within(nav).queryByRole('link', { name: /장바구니 고치기/ })).toBeNull();
  });

  it('starts a new session in the open project', async () => {
    mount('/board' + q(docs));
    await row('docs-site', true);
    const nav = await rail();
    expect(
      within(nav)
        .getByRole('link', { name: /새 세션/ })
        .getAttribute('href'),
    ).toBe('/' + q(docs));
  });

  it('opening another project keeps the page from the map, and starts a new session from a session', async () => {
    const router = mount('/board' + q(app));
    fireEvent.click(await row('docs-site', false, '확인이 필요해요'));
    await waitFor(() => expect(router.state.location.href).toBe('/board' + q(docs)));
    await row('docs-site', true);

    cleanup();
    const second = mount('/session/cart');
    fireEvent.click(await row('docs-site', false, '확인이 필요해요'));
    await waitFor(() => expect(second.state.location.href).toBe('/' + q(docs)));
  });

  it('keeps the project shown last open on pages without one, and ⌘N starts there', async () => {
    const router = mount('/memory' + q(docs));
    await row('docs-site', true);
    fireEvent.click(within(await rail()).getByRole('link', { name: '설정' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    await row('docs-site', true);
    fireEvent.keyDown(window, { key: 'n', metaKey: true });
    await waitFor(() => expect(router.state.location.href).toBe('/' + q(docs)));
  });

  it('says on a closed project when a session there waits for my OK', async () => {
    mount('/board' + q(app));
    expect(await row('docs-site', false, '확인이 필요해요')).toBeTruthy();
    // Open, the project shows the waiting session itself instead.
    expect(await row('alpine-code', true)).toBeTruthy();
  });
});
