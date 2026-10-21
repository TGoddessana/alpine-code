import type { TaskForceItem } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { mergeScripts, scriptedConnection, ServerProvider, sessionInfo, type Script } from '@/shared/server';

import { MiniMap } from './MiniMap';
import { ProductMap } from './ProductMap';
import { boardScript } from './testBoard';

const cwd = '/project';
const empty = { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing' } };

function wrap(script: Script, children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const connection = scriptedConnection(
    mergeScripts(boardScript(), { results: { 'session/list': { sessions: [] }, 'session/cancel': {} } }, script),
  );
  const request = vi.spyOn(connection, 'request');
  render(
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">{children}</LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { request };
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('drawing the map in place', () => {
  it('shows the drawing on the empty canvas while the attached session works, and can stop it', async () => {
    const running = {
      'session/open': {
        info: sessionInfo({ id: 'draw', cwd, status: 'running' }),
        seq: 0,
        items: [],
        active: [],
      },
    };
    const { request } = wrap(
      { results: { ...empty, ...running } },
      <ProductMap cwd={cwd} sessionId="draw" onSession={vi.fn()} />,
    );
    expect(await screen.findByText(/코드를 살펴보는 중이에요/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '지도 그리기' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '멈추기' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'session/cancel')?.[1]).toEqual({ sessionId: 'draw' }),
    );
  });

  it('keeps showing the drawing while the TF it started works, and stopping stops the TF too', async () => {
    localStorage.setItem(`alpine.product-map.drawing:${cwd}`, 'draw');
    const team: TaskForceItem = {
      id: 'tf1',
      kind: 'taskforce',
      title: '지도 그리기',
      steps: [{ title: '부분별로 그리기', count: 3, model: 'm' }],
      minutes: 10,
      status: 'running',
      members: [],
      step: '부분별로 그리기',
      log: null,
      needed: null,
      error: null,
      startedAt: null,
    };
    const { request } = wrap(
      {
        results: {
          'session/open': { info: sessionInfo({ id: 'draw', cwd, status: 'idle' }), seq: 0, items: [team], active: [] },
          'taskforce/stop': {},
        },
      },
      <ProductMap cwd={cwd} sessionId="draw" onSession={vi.fn()} />,
    );
    expect(await screen.findByText(/지도를 그리는 중/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '멈추기' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'taskforce/stop')?.[1]).toEqual({
        sessionId: 'draw',
        runId: 'tf1',
      }),
    );
  });

  it('offers one button and folds the folders away when nothing is drawn yet', async () => {
    wrap({ results: empty }, <ProductMap cwd={cwd} onSession={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '지도 그리기' })).toBeTruthy();
    expect(screen.getByText('살펴볼 폴더 고르기').closest('details')?.open).toBe(false);
  });
});

describe('small map', () => {
  it('draws the map small and opens it when pressed', async () => {
    const onOpen = vi.fn();
    wrap({}, <MiniMap cwd={cwd} onOpen={onOpen} />);
    fireEvent.click(await screen.findByRole('button', { name: '제품 지도 크게 보기' }));
    expect(onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '작은 지도 접기' }));
    expect(screen.queryByRole('button', { name: '제품 지도 크게 보기' })).toBeNull();
    expect(localStorage.getItem('alpine.mini-map.folded')).toBe('true');
  });

  it('offers to draw a map the project does not have yet', async () => {
    const onOpen = vi.fn();
    wrap({ results: empty }, <MiniMap cwd={cwd} onOpen={onOpen} />);
    expect(await screen.findByText('아직 지도가 없어요')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '지도 그리기' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
