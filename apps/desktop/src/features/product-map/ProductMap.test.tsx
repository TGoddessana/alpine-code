import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import {
  EXAMPLE_MAP,
  ServerProvider,
  flowScript,
  mergeScripts,
  scriptedConnection,
  sessionInfo,
  type Script,
} from '@/shared/server';

import { ProductMap } from './ProductMap';

const cwd = '/project';
function mount(script: Script = {}, onSession = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const base = mergeScripts(
    flowScript(),
    {
      results: {
        'session/list': { sessions: [] },
        'session/new': { info: sessionInfo({ id: 'new-session', cwd }) },
        'session/send': {},
      },
    },
    script,
  );
  const connection = scriptedConnection(base);
  const request = vi.spyOn(connection, 'request');
  const result = render(
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale="ko">
          <div style={{ height: 900 }}>
            <ProductMap cwd={cwd} onSession={onSession} />
          </div>
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { ...result, request, onSession, client };
}
beforeEach(() => {
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

describe('living product map', () => {
  it('branches from the selected existing feature and opens the real session', async () => {
    const { request, onSession } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /장바구니 구현됨/ }));
    fireEvent.click(screen.getByRole('button', { name: '여기서 확장' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '선물 주문' } });
    fireEvent.click(screen.getByRole('button', { name: '작업 시작' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
    const prepare = request.mock.calls.find(([method]) => method === 'flow/prepare');
    expect(prepare?.[1]).toMatchObject({ action: 'extend', nodeId: 'cart', flowId: 'order', request: '선물 주문' });
    expect(await screen.findByRole('button', { name: /선물 주문 예정/ })).toBeTruthy();
    expect(request.mock.calls.find(([method]) => method === 'session/send')?.[1]).toMatchObject({
      sessionId: 'new-session',
    });
  });
  it('retries a failed send without creating a second session or branch', async () => {
    let attempts = 0;
    const { request, onSession } = mount({
      results: {
        'session/send': () => {
          if (++attempts === 1) throw new Error('Offline');
          return {};
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /장바구니 구현됨/ }));
    fireEvent.click(screen.getByRole('button', { name: '여기서 확장' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '선물 주문' } });
    fireEvent.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(onSession).toHaveBeenCalled());
    expect(request.mock.calls.filter(([method]) => method === 'session/new')).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === 'flow/prepare')).toHaveLength(1);
  });
  it('distinguishes a recorded check from current verification and shows shared usage', async () => {
    mount();
    const nodes = await screen.findAllByRole('button', { name: /결제 문제 있음/ });
    fireEvent.click(nodes[0]!);
    const inspector = screen.getByRole('complementary', { name: '결제' });
    expect(within(inspector).getByText(/2개 흐름에서 사용/)).toBeTruthy();
    expect(within(inspector).getByText('확인 조건 4개 중 3개 통과')).toBeTruthy();
    expect(within(inspector).getByText('10% 쿠폰을 적용하면 할인된 금액으로 결제한다.')).toBeTruthy();
    expect(within(inspector).getByText('실패 보고')).toBeTruthy();
  });
  it('keeps an unreadable document from triggering discovery writes', async () => {
    const { request } = mount({
      results: {
        'flow/get': () => {
          throw new Error('Invalid JSON');
        },
      },
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '만들어진 기능 찾기' })).toBeNull();
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
  });
  it('has an empty discovery state instead of invented features', async () => {
    mount({ results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing' } } });
    expect(await screen.findByRole('button', { name: '만들어진 기능 찾기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /장바구니/ })).toBeNull();
  });
  it('can collapse a whole flow without losing the shared node in another flow', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: EXAMPLE_MAP.flows![0]!.title }));
    expect(screen.queryByRole('button', { name: /장바구니 구현됨/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /결제 문제 있음/ })).toHaveLength(1);
  });
});
