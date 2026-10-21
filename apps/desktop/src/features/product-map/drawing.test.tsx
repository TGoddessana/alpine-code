import type { TaskForceItem } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // While it draws, the map's input waits.
    expect((screen.getByRole('button', { name: '지도 그리기' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '멈추기' }));
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
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: '멈추기' }));
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

describe('asking the map', () => {
  it('draws from the map input in a new map conversation, and the words wait as the first card', async () => {
    const { request } = wrap(
      {
        results: {
          ...empty,
          'session/new': { info: sessionInfo({ id: 'map-talk', cwd, purpose: 'map' }) },
          'session/send': {},
          'flow/prepare': { board: empty['flow/get'], prompt: 'p', nodeId: null },
        },
      },
      <ProductMap cwd={cwd} onSession={vi.fn()} />,
    );
    const input = await screen.findByRole('textbox', { name: '지도에 부탁하기' });
    fireEvent.change(input, { target: { value: '손님 쪽부터 그려 줘' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/prepare')?.[1]).toMatchObject({
        action: 'discover',
        request: '손님 쪽부터 그려 줘',
      }),
    );
    expect(request.mock.calls.find(([method]) => method === 'session/new')?.[1]).toMatchObject({ purpose: 'map' });
    expect(await screen.findByText('지도를 그리기 시작했어요')).toBeTruthy();
  });

  it('keeps going in the project map conversation instead of making another', async () => {
    const { request } = wrap(
      {
        results: {
          'session/list': { sessions: [sessionInfo({ id: 'map-talk', cwd, purpose: 'map' })] },
          'session/send': {},
        },
      },
      <ProductMap cwd={cwd} onSession={vi.fn()} />,
    );
    const input = await screen.findByRole('textbox', { name: '지도에 부탁하기' });
    fireEvent.change(input, { target: { value: '운영자 쪽도 그려 줘' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'session/send')?.[1]).toMatchObject({
        sessionId: 'map-talk',
      }),
    );
    expect(request.mock.calls.some(([method]) => method === 'session/new')).toBe(false);
  });

  it('shows the latest answer above the input, and opens the conversation on request', async () => {
    const onShow = vi.fn();
    wrap(
      {
        results: {
          'session/open': {
            info: sessionInfo({ id: 'map-talk', cwd, purpose: 'map' }),
            seq: 0,
            items: [
              { id: 'u', kind: 'user_message', text: '그려 줘' },
              {
                id: 'a',
                kind: 'agent_message',
                text: '카드 9장을 그렸어요. 결제는 키가 없어 확인 못 했어요.',
                agent: null,
              },
            ],
            active: [],
          },
        },
      },
      <ProductMap cwd={cwd} sessionId="map-talk" onSession={vi.fn()} onShowConversation={onShow} />,
    );
    expect(await screen.findByText(/카드 9장을 그렸어요/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '대화 보기' }));
    expect(onShow).toHaveBeenCalled();
  });
});

it('keeps the map menu, with deleting the map, before its first card', async () => {
  wrap(
    { results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'r', exists: true } } },
    <ProductMap cwd={cwd} onSession={vi.fn()} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '지도 메뉴' }));
  expect(await screen.findByRole('menuitem', { name: '지도 삭제' })).toBeTruthy();
});

it('starts over when the map is deleted: its conversation is put away and let go of', async () => {
  const onSession = vi.fn();
  const { request } = wrap(
    {
      results: {
        'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'r', exists: true },
        'session/list': { sessions: [sessionInfo({ id: 'map-talk', cwd, purpose: 'map' })] },
        'flow/delete': {},
        'session/setDetails': { info: sessionInfo({ id: 'map-talk', cwd, purpose: 'map', archived: true }) },
      },
    },
    <ProductMap cwd={cwd} onSession={onSession} />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '지도 메뉴' }));
  fireEvent.click(await screen.findByRole('menuitem', { name: '지도 삭제' }));
  fireEvent.click(
    within(await screen.findByRole('region', { name: '지도 삭제' })).getByRole('button', { name: '삭제' }),
  );
  await waitFor(() =>
    expect(request.mock.calls.find(([method]) => method === 'session/setDetails')?.[1]).toEqual({
      sessionId: 'map-talk',
      archived: true,
    }),
  );
  expect(onSession).toHaveBeenCalledWith('');
});
