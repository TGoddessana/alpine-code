import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import {
  ServerError,
  STUDIO_MAP,
  ServerProvider,
  flowScript,
  mergeScripts,
  scriptedConnection,
  sessionInfo,
  type Script,
} from '@/shared/server';

import { messages } from './messages';
import { ProductMap } from './ProductMap';
import { bookingBoard, boardScript, ORDER_FLOW, seeded, withBoard } from './testBoard';

const cwd = '/project';
/** The payment feature sits in two flows, so it is on the canvas twice. */
const payment = async () => (await screen.findAllByRole('button', { name: /^5 결제 실패/ }))[0]!;
const dimmed = (button: HTMLElement) => button.className.includes('opacity-35');

/** Opens the filter menu and toggles one entry in it, then closes the menu with Esc. */
async function toggleFilter(name: RegExp | string) {
  const trigger = screen.getByRole('button', { name: /^필터/ });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button', { name }));
}
/** The summary sentence, shown once the map has loaded. */
const loaded = () => screen.findByText(/^약속 \d+개 중 \d+개를 지키고 있어요$/);
/** Opens the map's "⋯" menu and returns its item with this name. */
async function menuItem(name: RegExp | string, role: 'menuitem' | 'menuitemcheckbox' = 'menuitem') {
  fireEvent.click(await screen.findByRole('button', { name: '지도 메뉴' }));
  return screen.findByRole(role, { name });
}
/** The side panel's flow list, which also carries what needs a look and the code changes not on the map. */
const flowList = () => screen.getByRole('region', { name: '흐름' });
/** A row of that list by its title (the accessible name also holds the number, counts and 보기). */
const flowRow = (title: string) => within(flowList()).getByRole('button', { name: new RegExp(title) });
/** The "봐야 할 것 N" count on a flow row, or 0 when it has none. */
const lookCount = (row: HTMLElement) => Number(/봐야 할 것 (\d+)/.exec(row.textContent!)?.[1] ?? 0);
/** The code changes row at the end of the flow list. */
const coverageRow = () => within(flowList()).getByRole('button', { name: /^지도에 아직 없는 코드 변경/ });
/** Every card on the canvas. */
const cards = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('data-node'));
/** The reason tag per tagged card, as `nodeId: tag`. */
const reasonTags = () => [
  ...new Set(
    cards().flatMap((b) => {
      const tag = b.querySelector('[data-reason]');
      return tag ? [`${b.getAttribute('data-node')}: ${tag.textContent}`] : [];
    }),
  ),
];
function mount(script: Script = {}, onSession = vi.fn(), onShowConversation = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const base = mergeScripts(
    boardScript(),
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
            <ProductMap cwd={cwd} onSession={onSession} onShowConversation={onShowConversation} />
          </div>
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { ...result, request, onSession, onShowConversation, client };
}
beforeEach(() => {
  // These tests are about the card map; the person-first view has its own block at the end.
  localStorage.setItem('alpine.product-map.view', 'cards');
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
  localStorage.clear();
});

/** The prepare request the app sent last. */
const lastPrepare = (request: { mock: { calls: unknown[][] } }) =>
  request.mock.calls.filter(([method]) => method === 'flow/prepare').at(-1)?.[1];

describe('living product map', () => {
  it('branches from the selected existing feature and opens the real session', async () => {
    const { request, onSession } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /장바구니/ }));
    fireEvent.click(screen.getByRole('button', { name: '이어지는 기능 추가' }));
    fireEvent.change(screen.getByLabelText(/기능 다음에/), { target: { value: '선물 주문' } });
    fireEvent.click(screen.getByRole('button', { name: '작업 시작' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
    const prepare = request.mock.calls.find(([method]) => method === 'flow/prepare');
    expect(prepare?.[1]).toMatchObject({ action: 'extend', nodeId: 'cart', flowId: 'order', request: '선물 주문' });
    expect(await screen.findByRole('button', { name: /^6 선물 주문 약속 없음/ })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: /장바구니/ }));
    fireEvent.click(screen.getByRole('button', { name: '이어지는 기능 추가' }));
    fireEvent.change(screen.getByLabelText(/기능 다음에/), { target: { value: '선물 주문' } });
    fireEvent.click(screen.getByRole('button', { name: '작업 시작' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await waitFor(() => expect(onSession).toHaveBeenCalled());
    expect(request.mock.calls.filter(([method]) => method === 'session/new')).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === 'flow/prepare')).toHaveLength(1);
  });
  it('distinguishes a recorded check from current verification and shows shared usage', async () => {
    mount();
    fireEvent.click(await payment());
    const inspector = screen.getByRole('complementary', { name: '결제' });
    const flows = within(inspector).getByRole('region', { name: '사용 흐름' });
    expect(within(flows).getByText('상품을 고르고 주문하기')).toBeTruthy();
    expect(within(flows).getByText('다른 서비스에서 주문 만들기')).toBeTruthy();
    expect(within(inspector).getByText('약속 4개 중 3개 통과')).toBeTruthy();
    expect(within(inspector).getByText('10% 쿠폰을 적용하면 할인된 금액으로 결제한다.')).toBeTruthy();
    expect(within(inspector).getByText('쿠폰을 적용하면 결제 금액이 갱신되지 않아요.')).toBeTruthy();
  });
  it('keeps developer details behind a collapsed technical section', async () => {
    mount();
    fireEvent.click(await payment());
    const inspector = screen.getByRole('complementary', { name: '결제' });
    const technical = within(inspector).getByText('기술 정보').closest('details')!;
    expect(technical.open).toBe(false);
    expect(technical.textContent).toContain('payment');
    expect(technical.textContent).toContain('POST /payments');
    const heading = within(inspector).getByRole('heading', { name: '결제', level: 2 });
    expect(heading.parentElement!.parentElement!.textContent).toBe('5결제');
  });
  it('offers exactly one primary next action per status', async () => {
    mount();
    const primary = async (name: RegExp, label: string, others: string[]) => {
      fireEvent.click((await screen.findAllByRole('button', { name }))[0]!);
      const inspector = screen.getByRole('complementary');
      expect(within(inspector).getAllByRole('button', { name: label })).toHaveLength(1);
      for (const other of others) expect(within(inspector).queryByRole('button', { name: other })).toBeNull();
    };
    await primary(/^5 결제 실패/, '이 문제 고쳐 달라고 요청', ['다시 확인', '확인 요청', '약속 정리 요청']);
    await primary(/회원 주문 재확인 필요/, '다시 확인', ['이 문제 고쳐 달라고 요청', '확인 요청', '동작 확인']);
    await primary(/장바구니 아직 확인 안 함/, '확인 요청', ['이 문제 고쳐 달라고 요청', '다시 확인', '동작 확인']);
    await primary(/주문 요청 약속 없음/, '약속 정리 요청', ['이 문제 고쳐 달라고 요청', '확인 요청']);
    fireEvent.click(screen.getByRole('button', { name: /상품 찾기 통과/ }));
    const passed = screen.getByRole('complementary', { name: '상품 찾기' });
    for (const name of ['이 문제 고쳐 달라고 요청', '다시 확인', '확인 요청', '약속 정리 요청'])
      expect(within(passed).queryByRole('button', { name })).toBeNull();
    expect(within(passed).getByRole('button', { name: '동작 확인' })).toBeTruthy();
  });
  it('requests a re-check from the primary action', async () => {
    const { request } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /회원 주문 재확인 필요/ }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: '다시 확인' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/prepare')?.[1]).toMatchObject({
        action: 'verify',
        nodeId: 'member',
      }),
    );
  });
  it('prefills the change form with the issue and the failed promise', async () => {
    const { request } = mount();
    fireEvent.click(await payment());
    const inspector = screen.getByRole('complementary', { name: '결제' });
    const box = within(inspector).getByText('해결되지 않은 문제').parentElement!;
    // The issue appears once, inside its box, together with the fix button.
    expect(within(inspector).getAllByText('쿠폰을 적용하면 결제 금액이 갱신되지 않아요.')).toHaveLength(1);
    fireEvent.click(within(box).getByRole('button', { name: '이 문제 고쳐 달라고 요청' }));
    const value = (screen.getByLabelText('어떻게 바꿀까요?') as HTMLTextAreaElement).value;
    expect(value).toContain('쿠폰을 적용하면 결제 금액이 갱신되지 않아요.');
    expect(value).toContain('10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    fireEvent.click(screen.getByRole('button', { name: '작업 시작' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/prepare')?.[1]).toMatchObject({
        action: 'change',
        nodeId: 'payment',
      }),
    );
  });
  it('explains promises in place and shows plain evidence before the technical record', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^1 상품 찾기/ }));
    const inspector = screen.getByRole('complementary', { name: '상품 찾기' });
    expect(within(inspector).queryByText(/반드시 지켜야 할 동작/)).toBeNull();
    fireEvent.click(within(inspector).getByRole('button', { name: '약속이란?' }));
    expect(within(inspector).getByText(/반드시 지켜야 할 동작/)).toBeTruthy();
    const record = within(inspector).getAllByText('기술 기록')[0]!.closest('details')!;
    expect(record.open).toBe(false);
    expect(record.textContent).toContain('pnpm test');
  });
  it('saves planning decisions through flow/set without a revision', async () => {
    const { request } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /^1 상품 찾기/ }));
    const inspector = screen.getByRole('complementary', { name: '상품 찾기' });
    fireEvent.click(within(inspector).getByRole('button', { name: '필수' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/set')?.[1]).toMatchObject({
        cwd,
        nodeId: 'browse',
        field: 'priority',
        value: 'must',
      }),
    );
    expect(request.mock.calls.find(([method]) => method === 'flow/set')?.[1]).not.toHaveProperty('revision');
    const memo = within(inspector).getByLabelText('결정 메모');
    fireEvent.change(memo, { target: { value: '출시 전에 필요' } });
    fireEvent.keyDown(memo, { key: 'Enter' });
    await waitFor(() =>
      expect(request.mock.calls.filter(([method]) => method === 'flow/set').at(-1)?.[1]).toMatchObject({
        field: 'decision',
        value: '출시 전에 필요',
      }),
    );
    // Tags are the AI's to write: there is no field to pick a group by hand.
    expect(within(inspector).queryByLabelText('영역')).toBeNull();
  });
  it('shows a small inline error when saving a plan field fails', async () => {
    mount({
      results: {
        'flow/set': () => {
          throw new Error('disk full');
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: /^1 상품 찾기/ }));
    fireEvent.click(screen.getByRole('button', { name: '이번에' }));
    expect((await screen.findByText(/저장하지 못했어요/)).getAttribute('role')).toBe('alert');
  });
  it('totals each feature once and dims, never removes, the cards a status filter does not match', async () => {
    mount();
    expect(await loaded()).toBeTruthy();
    // A shared feature is drawn in each flow it belongs to, but counted once.
    expect(screen.getAllByRole('button', { name: /^5 결제/ })).toHaveLength(2);
    await toggleFilter(/^재확인 필요 1/);
    expect(dimmed(screen.getByRole('button', { name: /^3 회원 주문 재확인 필요/ }))).toBe(false);
    const cart = screen.getByRole('button', { name: /장바구니/ });
    expect(dimmed(cart)).toBe(true);
    // Dimmed cards stay focusable buttons.
    cart.focus();
    expect(globalThis.document.activeElement).toBe(cart);
    fireEvent.click(screen.getByRole('button', { name: '모두 지우기' }));
    expect(dimmed(screen.getByRole('button', { name: /장바구니/ }))).toBe(false);
  });
  it('asks before rebuilding an existing map', async () => {
    const { request } = mount();
    fireEvent.click(await menuItem('기능 더 찾기'));
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '찾기 시작' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/prepare')?.[1]).toMatchObject({
        action: 'discover',
      }),
    );
  });
  it('asks for promises from a feature that has none', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^6 주문 요청/ }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('button', { name: '약속 정리 요청' }));
    expect((screen.getByLabelText(/약속 정리/) as HTMLTextAreaElement).value).toMatch(/주문 요청의 요구사항/);
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
    expect(await screen.findByText(ORDER_FLOW.description)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^5 결제 실패/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: ORDER_FLOW.title }));
    expect(screen.queryByRole('button', { name: /장바구니/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^5 결제 실패/ })).toHaveLength(1);
  });

  it('shows the map as one flow canvas with no view tabs', async () => {
    mount();
    await loaded();
    expect(flowList()).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getAllByRole('region', { name: ORDER_FLOW.title })).toHaveLength(1);
  });
  it('shows the AI tags on a card, two at most, and never an empty-area tag', async () => {
    mount(
      withBoard((board) => {
        board.document!.nodes!.find((n) => n.id === 'cart')!.tags = ['상품 탐색', '수량', '할인'];
        board.document!.nodes!.find((n) => n.id === 'guest')!.tags = undefined;
      }),
    );
    const cart = await screen.findByRole('button', { name: '2 장바구니 아직 확인 안 함 상품 탐색 수량 할인' });
    expect(within(cart).getByText('상품 탐색')).toBeTruthy();
    expect(within(cart).getByText('수량')).toBeTruthy();
    expect(within(cart).queryByText('할인')).toBeNull();
    const browse = screen.getByRole('button', { name: /^1 상품 찾기/ });
    expect(within(browse).getByText('상품 탐색')).toBeTruthy();
    // A card with no tags is simply untagged.
    const guest = screen.getByRole('button', { name: /^4 비회원 주문/ });
    expect(screen.queryByText('영역 없음')).toBeNull();
    expect(guest.getAttribute('aria-label')).toBe('4 비회원 주문 약속 없음');
    // The panel shows every tag, with no field to pick an area.
    fireEvent.click(cart);
    const inspector = screen.getByRole('complementary', { name: '장바구니' });
    for (const tag of ['상품 탐색', '수량', '할인']) expect(within(inspector).getByText(tag)).toBeTruthy();
    expect(within(inspector).queryByLabelText('영역')).toBeNull();
  });
  it('puts a screen picture on screen cards, a quiet note when there is none, and a description otherwise', async () => {
    mount(
      withBoard((board) => {
        board.previews = { browse: 'data:image/png;base64,AAAA' };
        board.document!.nodes!.find((n) => n.id === 'browse')!.previewAt = new Date().toISOString();
      }),
    );
    const card = await screen.findByRole('button', { name: /^1 상품 찾기/ });
    expect(card.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(within(card).getByTitle('캡처 오늘')).toBeTruthy();
    expect(screen.getAllByText('주문 금액을 결제합니다.').length).toBeGreaterThan(0);
    const screens = screen.getAllByRole('button').filter((b) => b.querySelector('svg[aria-label="화면"]'));
    for (const other of screens.filter((b) => b !== card))
      expect(within(other).getByText('화면 사진 없음')).toBeTruthy();
  });
  it('dims what the search does not match, counts results and cycles them with Enter', async () => {
    mount();
    await loaded();
    const box = screen.getByPlaceholderText('기능, 태그, 약속 검색') as HTMLInputElement;
    fireEvent.keyDown(globalThis.document.body, { key: '/' });
    expect(globalThis.document.activeElement).toBe(box);
    fireEvent.change(box, { target: { value: '장바구니' } });
    expect(dimmed(screen.getByRole('button', { name: /^2 장바구니/ }))).toBe(false);
    expect(dimmed(screen.getByRole('button', { name: /상품 찾기/ }))).toBe(true);
    expect(screen.getByText('1개 찾음')).toBeTruthy();
    // A flow without a match stays on the canvas and says so quietly.
    expect(screen.getAllByText('일치 없음').length).toBeGreaterThan(0);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
    expect(dimmed(screen.getByRole('button', { name: /상품 찾기/ }))).toBe(false);
    expect(screen.queryByText('일치 없음')).toBeNull();
  });
  it('cycles through several matches with Enter and the next button', async () => {
    mount();
    await loaded();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.getAttribute('data-node') ?? '');
    };
    const box = screen.getByPlaceholderText('기능, 태그, 약속 검색');
    fireEvent.change(box, { target: { value: '주문' } });
    const count = Number(/\d+/.exec(screen.getByText(/개 찾음$/).textContent!)![0]);
    expect(count).toBeGreaterThan(1);
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(scrolled.filter(Boolean)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '다음 검색 결과' }));
    await waitFor(() => expect(scrolled.filter(Boolean).length).toBeGreaterThanOrEqual(2));
    expect(new Set(scrolled.slice(-2)).size).toBe(2);
  });
  it('marks what needs a look on each flow row; a row toggles dimming and reason tags on its cards', async () => {
    mount();
    await loaded();
    const row = flowRow(ORDER_FLOW.title);
    const count = lookCount(row);
    expect(count).toBeGreaterThan(0);
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(cards().some(dimmed)).toBe(false);
    expect(document.querySelector('[data-reason]')).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    expect(row.textContent).toContain('그만 보기');
    // Every card outside the flow is dimmed; its cards that need a look carry a short reason.
    const tagged = cards().filter((b) => b.querySelector('[data-reason]'));
    expect(new Set(tagged.map((b) => b.getAttribute('data-node'))).size).toBe(count);
    expect(tagged.every((b) => ORDER_FLOW.nodeIds.includes(b.getAttribute('data-node')!))).toBe(true);
    expect(tagged.every((b) => !dimmed(b))).toBe(true);
    expect(cards().some(dimmed)).toBe(true);
    expect(reasonTags()).toContain('payment: 실패');
    // It is a focus beside 필터, not a filter tag.
    expect(screen.queryByRole('list', { name: '적용된 필터' })).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('false');
    expect(cards().some(dimmed)).toBe(false);
    expect(document.querySelector('[data-reason]')).toBeNull();
  });
  it('marks no flow as needing a look when nothing does, and says no promise is checked yet', async () => {
    mount(
      withBoard((board) => {
        board.states = {};
        board.document!.nodes = board.document!.nodes!.map((n) => ({
          ...n,
          phase: 'planned',
          conditions: [],
          checks: [],
        }));
      }),
    );
    expect(await screen.findByText('기능 7개 · 아직 확인한 약속이 없어요')).toBeTruthy();
    expect(within(flowList()).queryByText(/봐야 할 것/)).toBeNull();
  });
  it('uses plain wording for features that appear in several flows', async () => {
    mount();
    await payment();
    expect(screen.getAllByText('2곳에 나옴').length).toBeGreaterThan(0);
    fireEvent.click(await payment());
    expect(await screen.findByText('이 기능은 흐름 2곳에 나와요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '다른 곳 보기' })).toBeTruthy();
  });
  it('counts changes since the last visit and opens them in a side panel', async () => {
    localStorage.setItem(`alpine:product-map:seen:${cwd}`, '2026-10-01T00:00:00Z');
    mount(
      withBoard((board) => {
        board.changes = [
          {
            at: '2026-10-10T03:00:00Z',
            nodeId: 'payment',
            title: '결제',
            kind: 'check_failed',
            detail: '쿠폰이 반영되지 않아요.',
          },
          { at: '2026-09-20T03:00:00Z', nodeId: 'cart', title: '장바구니', kind: 'added', detail: '' },
        ];
      }),
    );
    const trigger = await screen.findByRole('button', { name: '지도 메뉴' });
    // A dot on the menu says the history has something new.
    expect(trigger.querySelector('.rounded-full')).toBeTruthy();
    fireEvent.click(await menuItem('바뀐 기록 · 새로 1개'));
    const panel = await screen.findByRole('complementary', { name: '최근 변경' });
    expect(within(panel).getByText(/10월 10일 · 결제 · 확인 실패/)).toBeTruthy();
    expect(within(panel).getByText('쿠폰이 반영되지 않아요.')).toBeTruthy();
    // Opening marks everything as seen.
    await waitFor(() => expect(trigger.querySelector('.rounded-full')).toBeNull());
    expect(await menuItem('바뀐 기록')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(Date.parse(localStorage.getItem(`alpine:product-map:seen:${cwd}`)!)).toBeGreaterThan(
      Date.parse('2026-10-11'),
    );
    fireEvent.click(within(panel).getByRole('button', { name: /결제/ }));
    expect(screen.getByRole('complementary', { name: '결제' })).toBeTruthy();
    localStorage.clear();
  });
  it('checks a whole flow from the flow canvas', async () => {
    const { request } = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: '이 흐름 전체 확인' }))[0]!);
    const flow = ORDER_FLOW;
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/prepare')?.[1]).toMatchObject({
        action: 'verify',
        nodeId: null,
        flowId: flow.id,
        request: `${flow.title} 흐름 전체가 제대로 동작하는지 확인해줘.`,
      }),
    );
  });
  it('filters from one menu, shows each filter as a removable tag and clears them all', async () => {
    mount();
    await loaded();
    const trigger = screen.getByRole('button', { name: '필터' });
    expect(trigger.getAttribute('aria-haspopup')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // Nothing is filtered, so no tags and no clear-all.
    expect(screen.queryByRole('list', { name: '적용된 필터' })).toBeNull();
    fireEvent.click(trigger);
    const failed = await screen.findByRole('button', { name: /^실패 1/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(failed.getAttribute('title')).toMatch(/약속/);
    fireEvent.click(failed);
    expect(failed.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '필수만' }));
    fireEvent.click(screen.getByRole('button', { name: '이번에 할 것' }));
    expect(screen.getByRole('button', { name: '필터 3' })).toBeTruthy();
    const tags = screen.getByRole('list', { name: '적용된 필터' });
    for (const label of ['실패', '필수만', '이번에 할 것'])
      expect(within(tags).getByRole('button', { name: `${label} 필터 지우기` })).toBeTruthy();
    expect(dimmed(screen.getByRole('button', { name: /장바구니/ }))).toBe(true);
    // A tag removes only its own filter.
    fireEvent.click(within(tags).getByRole('button', { name: '필수만 필터 지우기' }));
    expect(screen.getByRole('button', { name: '필터 2' })).toBeTruthy();
    expect(within(tags).queryByRole('button', { name: '필수만 필터 지우기' })).toBeNull();
    fireEvent.click(within(tags).getByRole('button', { name: '모두 지우기' }));
    expect(screen.getByRole('button', { name: '필터' })).toBeTruthy();
    expect(screen.queryByRole('list', { name: '적용된 필터' })).toBeNull();
    expect(dimmed(screen.getByRole('button', { name: /장바구니/ }))).toBe(false);
  });
  it('picks one status at a time in the filter menu', async () => {
    mount();
    await loaded();
    await toggleFilter(/^실패 1/);
    await toggleFilter(/^재확인 필요 1/);
    const tags = screen.getByRole('list', { name: '적용된 필터' });
    expect(within(tags).getAllByRole('listitem')).toHaveLength(2);
    expect(within(tags).getByRole('button', { name: '재확인 필요 필터 지우기' })).toBeTruthy();
    expect(within(tags).queryByRole('button', { name: '실패 필터 지우기' })).toBeNull();
  });
  it('summarises promises in one line, with no bar', async () => {
    mount();
    await loaded();
    const line = screen.getByText(/^약속 \d+개 중 \d+개를 지키고 있어요$/);
    expect(within(line.parentElement!).queryByRole('img')).toBeNull();
  });
  it('closes the detail panel with Esc unless an input is focused', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^1 상품 찾기/ }));
    expect(screen.getByRole('complementary', { name: '상품 찾기' })).toBeTruthy();
    const memo = within(screen.getByRole('complementary')).getByLabelText('결정 메모');
    memo.focus();
    fireEvent.keyDown(memo, { key: 'Escape' });
    expect(screen.getByRole('complementary', { name: '상품 찾기' })).toBeTruthy();
    memo.blur();
    fireEvent.keyDown(globalThis.document.body, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
  });
  it('shows progress changes in plain words', async () => {
    mount(
      withBoard((board) => {
        board.changes = [
          { at: '2026-10-10T03:00:00Z', nodeId: 'cart', title: '장바구니', kind: 'phase', detail: 'planned -> built' },
          { at: '2026-10-10T02:00:00Z', nodeId: 'payment', title: '결제', kind: 'issue_wontfix', detail: '' },
          { at: '2026-10-10T01:00:00Z', nodeId: 'member', title: '회원 주문', kind: 'replay_same', detail: '' },
        ];
      }),
    );
    fireEvent.click(await menuItem(/^바뀐 기록/));
    const panel = await screen.findByRole('complementary', { name: '최근 변경' });
    expect(within(panel).getByText('예정 → 구현됨')).toBeTruthy();
    expect(within(panel).queryByText(/planned/)).toBeNull();
    expect(within(panel).getByText(/결제 · 안 고치기로 함/)).toBeTruthy();
    expect(within(panel).getByText(/회원 주문 · 다시 돌려 봄 · 같은 결과/)).toBeTruthy();
  });
  it('has no tag row; checks every card the search found, tags included, in one run', async () => {
    const { request } = mount();
    await loaded();
    expect(screen.queryByRole('group', { name: '태그' })).toBeNull();
    expect(screen.queryByRole('button', { name: '찾은 기능 모두 확인' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('기능, 태그, 약속 검색'), { target: { value: '주문' } });
    const cards = (id: string) => [...globalThis.document.querySelectorAll<HTMLElement>(`[data-node="${id}"]`)];
    for (const id of ['member', 'guest']) for (const card of cards(id)) expect(dimmed(card)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '찾은 기능 모두 확인' }));
    await waitFor(() =>
      expect(lastPrepare(request)).toMatchObject({
        action: 'verify',
        nodeId: null,
        flowId: null,
        nodeIds: expect.arrayContaining(['member', 'guest']),
        request: '검색어 "주문"에 맞는 기능이 모두 제대로 동작하는지 확인해 주세요.',
      }),
    );
  });
  it('finds cards by their tags in the search', async () => {
    mount();
    await loaded();
    fireEvent.change(screen.getByPlaceholderText('기능, 태그, 약속 검색'), { target: { value: '연동' } });
    expect(screen.getByText('2개 찾음')).toBeTruthy();
    expect(dimmed(screen.getByRole('button', { name: /^6 주문 요청/ }))).toBe(false);
    expect(dimmed(screen.getByRole('button', { name: /^7 주문 결과 받기/ }))).toBe(false);
    expect(dimmed(screen.getByRole('button', { name: /^2 장바구니/ }))).toBe(true);
  });
  it('hides the new-flow button until a map exists', async () => {
    mount({ results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing' } } });
    await screen.findByRole('button', { name: '만들어진 기능 찾기' });
    expect(screen.queryByRole('button', { name: '새 흐름' })).toBeNull();
    expect(screen.queryByRole('button', { name: '지도 메뉴' })).toBeNull();
  });
});

const promiseCalls = (request: { mock: { calls: unknown[][] } }) =>
  request.mock.calls.filter(([method]) => method === 'flow/promise').map(([, params]) => params);
const openCard = async (name: RegExp) => {
  fireEvent.click((await screen.findAllByRole('button', { name }))[0]!);
  return screen.getByRole('complementary');
};
/** Opens the promise row whose text matches, so its body is readable. */
const openPromise = (inspector: HTMLElement, text: string | RegExp) => {
  const row = within(inspector).getByText(text).closest('details')!;
  row.open = true;
  return row;
};

describe('map upkeep', () => {
  it('shows a rule the AI guessed and failed as a question, not as a failure', async () => {
    const { request } = mount(
      seeded((board) => {
        const guest = board.document!.nodes!.find((n) => n.id === 'guest')!;
        guest.conditions = [{ id: 'phone', expectation: '연락처는 숫자만 받는다.' }];
        guest.checks = [
          {
            id: 'c1',
            conditionId: 'phone',
            expectation: '연락처는 숫자만 받는다.',
            summary: '하이픈 입력',
            command: 'test',
            output: '',
            result: 'failed',
          },
        ];
        board.states!.guest = {
          status: 'question',
          passed: 0,
          total: 1,
          promises: { phone: { status: 'failed', issue: 'question', origin: 'inferred' } },
        };
      }),
    );
    const card = await screen.findByRole('button', { name: /비회원 주문 확인 필요한 규칙/ });
    expect(card.className).toMatch(/border-attention/);
    // On its flow, it is tagged as a rule to confirm, apart from the failed feature.
    fireEvent.click(flowRow(ORDER_FLOW.title));
    expect(reasonTags()).toEqual(expect.arrayContaining(['guest: 규칙인지 확인', 'payment: 실패']));
    fireEvent.click(flowRow(ORDER_FLOW.title));
    fireEvent.click(card);
    const inspector = screen.getByRole('complementary', { name: '비회원 주문' });
    expect(
      within(inspector).getAllByText('AI가 짐작해서 적은 규칙이 지켜지지 않았어요. 맞는 규칙인지 알려 주세요.'),
    ).toHaveLength(1);
    expect(within(inspector).queryByRole('button', { name: '이 문제 고쳐 달라고 요청' })).toBeNull();
    openPromise(inspector, '연락처는 숫자만 받는다.');
    fireEvent.click(within(inspector).getByRole('button', { name: '아니에요' }));
    expect((screen.getByLabelText('어떻게 바꿀까요?') as HTMLTextAreaElement).value).toContain(
      '"연락처는 숫자만 받는다." 규칙은 맞지 않아요',
    );
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    fireEvent.click(within(inspector).getByRole('button', { name: '맞아요' }));
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'guest',
        conditionId: 'phone',
        action: 'confirm',
      }),
    );
    // Confirmed, it is an open problem like any other.
    expect(await screen.findByRole('button', { name: /비회원 주문 실패/ })).toBeTruthy();
  });

  it('shows each issue state with its date and the actions that fit it', async () => {
    const { request } = mount();
    const inspector = await openCard(/^5 결제 실패/);
    const row = openPromise(inspector, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(row).getByText(/^열림 · \d+월 \d+일부터$/)).toBeTruthy();
    expect(within(row).getAllByText('확정').length).toBeGreaterThan(0);
    fireEvent.click(within(row).getByRole('button', { name: '나중에 보기' }));
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'payment',
        conditionId: 'coupon',
        action: 'later',
      }),
    );
    const later = openPromise(screen.getByRole('complementary'), '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(await within(later).findByText(/^나중에 보기 · /)).toBeTruthy();
    fireEvent.click(within(later).getByRole('button', { name: '다시 열기' }));
    await waitFor(() => expect(promiseCalls(request).at(-1)).toMatchObject({ action: 'reopen' }));
  });

  it('asks for a one-line reason before marking a problem as will-not-fix', async () => {
    const { request } = mount();
    const inspector = await openCard(/^5 결제 실패/);
    const row = openPromise(inspector, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    fireEvent.click(within(row).getByRole('button', { name: '안 고침' }));
    const save = within(row).getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(row).getByLabelText('안 고치는 이유를 한 줄로 적어 주세요'), {
      target: { value: '쿠폰은 곧 없앨 예정' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'payment',
        conditionId: 'coupon',
        action: 'wontfix',
        reason: '쿠폰은 곧 없앨 예정',
      }),
    );
    expect(await screen.findByText('안 고침 · 쿠폰은 곧 없앨 예정')).toBeTruthy();
  });

  it.each([
    ['regressed', /^다시 깨짐 · \d+월 \d+일부터 · 전에 고쳤던 문제$/],
    ['resolved', /^해결 · \d+월 \d+일$/],
  ] as const)('words a %s issue plainly', async (issue, text) => {
    mount(
      withBoard((board) => {
        const coupon = board.states!.payment!.promises!.coupon!;
        coupon.issue = issue;
        if (issue === 'resolved') coupon.status = 'passed';
      }),
    );
    const inspector = await openCard(/^5 결제/);
    expect(within(inspector).getByText(text)).toBeTruthy();
  });

  it('offers a recheck when the files of an open issue changed', async () => {
    const { request } = mount(
      withBoard((board) => {
        const coupon = board.states!.payment!.promises!.coupon!;
        coupon.issue = 'maybe_fixed';
        coupon.changed = ['src/payments.ts'];
        board.states!.payment!.changed = true;
      }),
    );
    const inspector = await openCard(/^5 결제/);
    const row = openPromise(inspector, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(row).getByText('고쳐졌을 수도')).toBeTruthy();
    expect(within(row).getByText('관련 파일이 바뀌었어요. 다시 확인할까요?')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', nodeId: 'payment' }));
  });

  it('lets the user confirm a rule the AI guessed, and take the confirmation back', async () => {
    const { request } = mount();
    const inspector = await openCard(/^2 장바구니/);
    const row = openPromise(inspector, '비어 있으면 주문하기를 누를 수 없다.');
    expect(within(row).getByText('AI 추정')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: '맞아요' }));
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'cart',
        conditionId: 'empty',
        action: 'confirm',
      }),
    );
    expect(await within(inspector).findByRole('button', { name: '확정 취소' })).toBeTruthy();
  });

  it('says where each record came from: Alpine, first seen, another computer, changed since, no match', async () => {
    mount(
      withBoard((board) => {
        const coupon = board.states!.payment!.promises!.coupon!;
        coupon.stamp = { at: '2026-10-02T03:00:00Z', witness: 'mismatch', uncertain: true };
        board.states!.payment!.promises!.retry!.stamp = { at: '2026-10-02T03:00:00Z', witness: 'other' };
      }),
    );
    const payment = await openCard(/^5 결제/);
    const lines = within(payment)
      .getAllByTestId('stamp')
      .map((line) => line.textContent);
    expect(lines.some((line) => /Alpine이 기록$/.test(line!))).toBe(true);
    expect(lines.some((line) => /다른 컴퓨터 기록 · 여기선 대조할 수 없어요$/.test(line!))).toBe(true);
    expect(lines.some((line) => /기록과 다름$/.test(line!))).toBe(true);
    expect(within(payment).getByText('확인 뒤 파일이 바뀌어 확실하지 않음')).toBeTruthy();
    cleanup();
    mount();
    const cart = await openCard(/^2 장바구니/);
    expect(within(cart).getAllByTestId('stamp')[0]!.textContent).toMatch(/^Alpine이 처음 본 시각 · /);
  });

  it('marks observation labels that come from another computer', async () => {
    mount(
      withBoard((board) => {
        const coupon = board
          .document!.nodes!.find((n) => n.id === 'payment')!
          .checks!.find((c) => c.conditionId === 'coupon')!;
        coupon.observations = [{ label: '결제 금액이 9,000원', show: 'text' }];
        board.provenance = { 'payment/coupon': [{ label: 'verified', elsewhere: true }] };
      }),
    );
    const payment = await openCard(/^5 결제/);
    expect(within(payment).getByText('다른 컴퓨터에서 확인한 기록 · 여기선 대조할 수 없어요')).toBeTruthy();
    expect(payment.querySelector('[data-provenance="verified"]')).toBeNull();
  });

  it('says a check that only read code was judged from reading, not from running', async () => {
    mount(
      withBoard((board) => {
        const coupon = board
          .document!.nodes!.find((n) => n.id === 'payment')!
          .checks!.find((c) => c.conditionId === 'coupon')!;
        coupon.observations = [
          {
            label: '할인 계산 코드',
            show: 'text',
            excerpt: 'total * 0.9',
            source: { kind: 'tool_call', sessionId: 's1', ref: 'c1' },
          },
        ];
        board.provenance = { 'payment/coupon': [{ label: 'read', matched: 'c1' }] };
      }),
    );
    const payment = await openCard(/^5 결제/);
    const row = openPromise(payment, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(row).getByText('AI가 코드를 읽고 판단함')).toBeTruthy();
    expect(within(row).getAllByText('코드를 읽고 판단한 결과예요 · 실행해 보진 않았어요').length).toBeGreaterThan(0);
    expect(row.querySelector('[data-provenance="verified"]')).toBeNull();
  });

  it('asks before re-running a command by itself, and shows what a re-run found', async () => {
    const { request } = mount(
      seeded((board) => {
        board.states!.member!.promises!.address!.replay = { key: 'k1', approved: false };
        board.states!.browse!.promises!['sold-out']!.replay = {
          approved: true,
          at: '2026-10-03T03:00:00Z',
          same: false,
          output: '1 failed',
        };
        board.states!.browse!.promises!.list!.replay = { approved: true, running: true };
      }),
    );
    const member = await openCard(/회원 주문 재확인 필요/);
    const ask = within(member).getByRole('button', { name: '자동으로 다시 돌려도 돼요' });
    expect(within(member).getByText('pnpm test order -- address', { exact: false }).closest('details')!.open).toBe(
      false,
    );
    fireEvent.click(ask);
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'member',
        conditionId: 'address',
        action: 'approve_replay',
        key: 'k1',
      }),
    );
    expect(await within(member).findByRole('button', { name: '자동 다시 돌리기 끄기' })).toBeTruthy();
    cleanup();
    mount(
      withBoard((board) => {
        board.states!.browse!.promises!['sold-out']!.replay = {
          approved: true,
          at: '2026-10-03T03:00:00Z',
          same: true,
        };
        board.states!.browse!.promises!.list!.replay = { approved: true, running: true };
      }),
    );
    const browse = await openCard(/^1 상품 찾기/);
    expect(within(browse).getByText(/^다시 돌려 봄 · 같은 결과 · \d+월 \d+일$/)).toBeTruthy();
    expect(within(browse).getByText('다시 돌리는 중')).toBeTruthy();
    cleanup();
    mount(
      withBoard((board) => {
        board.states!.browse!.promises!['sold-out']!.replay = {
          approved: true,
          at: '2026-10-03T03:00:00Z',
          same: false,
        };
      }),
    );
    const differs = await openCard(/^1 상품 찾기/);
    expect(within(differs).getByText(/^다시 돌려 보니 결과가 달라요/)).toBeTruthy();
  });

  it('asks about a promise the AI rewrote after the user decided it, and shows where a decision was made', async () => {
    const { request } = mount(
      withBoard((board) => {
        const address = board.states!.member!.promises!.address!;
        address.reworded = true;
        address.mine = '배송지는 회원 정보에서 불러온다';
        address.decidedElsewhere = true;
      }),
    );
    const member = await openCard(/회원 주문 재확인 필요/);
    expect(within(member).getByText('AI가 내가 정한 걸 바꿨어요')).toBeTruthy();
    expect(within(member).getByText('내가 쓴 문장: 배송지는 회원 정보에서 불러온다')).toBeTruthy();
    expect(within(member).getByText('다른 컴퓨터에서 정함')).toBeTruthy();
    fireEvent.click(within(member).getByRole('button', { name: '되돌리기' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/review', {
        cwd: expect.any(String),
        target: 'promise',
        action: 'restore',
        nodeId: 'member',
        conditionId: 'address',
      }),
    );
  });

  it('tells the user when the command to re-run changed before approval', async () => {
    const { request } = mount({
      results: {
        'flow/promise': () => {
          throw new ServerError(-32000, 'changed', { reason: 'replay_changed' });
        },
      },
    });
    const again = await openCard(/회원 주문 재확인 필요/);
    fireEvent.click(within(again).getByRole('button', { name: '자동으로 다시 돌려도 돼요' }));
    expect((await within(again).findByRole('alert')).textContent).toBe(
      '다시 돌리는 명령이 바뀌었어요. 바뀐 명령을 확인해 주세요.',
    );
    expect(request.mock.calls.filter(([method]) => method === 'flow/get').length).toBeGreaterThan(1);
  });

  it('lists the changed files of a stale promise under the technical record', async () => {
    mount();
    const member = await openCard(/회원 주문 재확인 필요/);
    const record = within(member).getAllByText('기술 기록')[0]!.closest('details')!;
    expect(record.open).toBe(false);
    expect(record.textContent).toContain('src/order.ts');
  });

  it('puts "changed" and "missing files" badges on the card', async () => {
    mount(
      withBoard((board) => {
        board.states!.cart!.missing = ['src/Cart.tsx'];
      }),
    );
    const member = await screen.findByRole('button', { name: /회원 주문 재확인 필요/ });
    expect(within(member).getByText('바뀜 · 확인 필요')).toBeTruthy();
    const cart = screen.getByRole('button', { name: /장바구니/ });
    expect(within(cart).getByText('찾을 수 없는 파일')).toBeTruthy();
    expect(within(cart).queryByText('바뀜 · 확인 필요')).toBeNull();
    fireEvent.click(cart);
    const technical = within(screen.getByRole('complementary')).getByText('기술 정보').closest('details')!;
    expect(technical.textContent).toContain('src/Cart.tsx');
  });

  it('shows changes the map does not cover, and updates the map from them', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.coverage = {
          git: true,
          uncovered: ['src/gift.ts', 'src/coupon.ts'],
          uncoveredCount: 5,
          outOfScope: 2,
          excluded: 7,
        };
      }),
    );
    await loaded();
    // It is the last row of the flow list.
    const row = coverageRow();
    expect(within(flowList()).getAllByRole('button').at(-1)).toBe(row);
    expect(row.textContent).toContain('5');
    // The changes not counted are folded inside its popover, not on the map.
    expect(screen.queryByText('범위 밖 변경 2개')).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByText('src/gift.ts')).toBeTruthy();
    expect(screen.getByText('외 3개')).toBeTruthy();
    expect(screen.getByText('범위 밖 변경 2개').closest('details')!.open).toBe(false);
    expect(screen.getByText('제외된 변경 7개').closest('details')!.open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '지도 맞추기' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'sync', nodeId: null, flowId: null }));
    expect(request.mock.calls.some(([method]) => method === 'session/send')).toBe(true);
  });

  it('shows what the AI has not mapped yet, and continues the map from it', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.coverage = { git: true, uncovered: ['src/gift.ts'], uncoveredCount: 1 };
        board.unmapped = [
          { title: '운영자 콘솔에서 회원 정지하기', why: '이번에 다 보지 못함', paths: ['admin/'] },
          { title: '쿠폰 발급하기', paths: [] },
        ];
      }),
    );
    await loaded();
    // A row of its own below the code changes, counting the parts.
    const row = within(flowList()).getByRole('button', { name: /^아직 그리지 않은 것/ });
    expect(within(flowList()).getAllByRole('button').at(-1)).toBe(row);
    expect(row.textContent).toContain('2');
    fireEvent.click(row);
    expect(await screen.findByText('운영자 콘솔에서 회원 정지하기')).toBeTruthy();
    expect(screen.getByText('이번에 다 보지 못함')).toBeTruthy();
    expect(screen.getByText('admin/')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '이어서 그리기' }));
    await waitFor(() =>
      expect(lastPrepare(request)).toMatchObject({
        action: 'discover',
        request: '지도에 아직 그리지 않은 것으로 남은 부분부터 이어서 지도를 그려 주세요.',
      }),
    );
  });

  it('shows no row for code changes without git, or when all is covered', async () => {
    mount(
      withBoard((board) => {
        board.coverage = { git: false, uncoveredCount: 3 };
      }),
    );
    await loaded();
    expect(screen.queryByText('지도에 아직 없는 코드 변경')).toBeNull();
    cleanup();
    mount();
    await loaded();
    expect(screen.queryByText('지도에 아직 없는 코드 변경')).toBeNull();
  });

  it('checks every card that needs a look from the map menu, in look-first order', async () => {
    const { request } = mount(
      withBoard((board) => {
        // A failed card whose files also changed is rechecked too; the must-have goes first.
        board.states!.cart!.changed = true;
        board.states!.cart!.status = 'recheck';
        board.document!.nodes!.find((n) => n.id === 'cart')!.priority = 'must';
      }),
    );
    await loaded();
    fireEvent.click(await menuItem('바뀐 기능 2개 다시 확인'));
    await waitFor(() =>
      expect(lastPrepare(request)).toMatchObject({
        action: 'verify',
        nodeId: null,
        flowId: null,
        nodeIds: ['cart', 'member'],
        request: '바뀐 파일이 있거나 다시 확인이 필요한 기능을 하나씩 확인해 주세요.',
      }),
    );
  });

  it('hides the batch recheck when nothing needs rechecking', async () => {
    mount(
      withBoard((board) => {
        board.states!.member = { status: 'passed', passed: 1, total: 1 };
      }),
    );
    await loaded();
    // The menu is open (another item is there), but the batch recheck is not.
    expect(await menuItem('지도 범위 바꾸기')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /다시 확인$/ })).toBeNull();
  });

  it('puts rules that broke again first, then failed must-haves, in the look-first order', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.states!.browse = {
          status: 'failed',
          passed: 0,
          total: 1,
          changed: true,
          promises: { list: { status: 'failed', issue: 'regressed', origin: 'confirmed' } },
        };
        // A failed must-have and a failed plain feature, both changed, so all of them are in the batch recheck.
        board.document!.nodes!.find((n) => n.id === 'payment')!.priority = 'must';
        board.states!.payment!.changed = true;
        board.states!.cart = {
          status: 'failed',
          passed: 0,
          total: 1,
          changed: true,
          promises: { empty: { status: 'failed', issue: 'open', origin: 'confirmed' } },
        };
      }),
    );
    await loaded();
    // On the flow, a rule that broke again is tagged as such, not as a plain failure.
    fireEvent.click(flowRow(ORDER_FLOW.title));
    expect(reasonTags()).toEqual(
      expect.arrayContaining(['browse: 다시 깨짐', 'payment: 실패', 'cart: 실패', 'member: 재확인 필요']),
    );
    // The batch recheck takes them in the look-first order.
    fireEvent.click(await menuItem('바뀐 기능 4개 다시 확인'));
    await waitFor(() =>
      expect(lastPrepare(request)).toMatchObject({ nodeIds: ['browse', 'payment', 'cart', 'member'] }),
    );
  });

  it('shows a banner and disables every write when the map is from a newer Alpine', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.readOnly = true;
        board.coverage = { git: true, uncovered: ['src/a.ts'], uncoveredCount: 1 };
      }),
    );
    expect(
      await screen.findByText('이 지도는 새 버전 Alpine으로 만들어졌어요. 업데이트하면 고칠 수 있어요'),
    ).toBeTruthy();
    expect((await menuItem('기능 더 찾기')).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitem', { name: '새 흐름' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('menuitemcheckbox', { name: '매일 자동으로 확인' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.queryByRole('menuitem', { name: '지도 삭제' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '바뀐 기능 1개 다시 확인' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(coverageRow());
    expect(((await screen.findByRole('button', { name: '지도 맞추기' })) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(globalThis.document.body, { key: 'Escape' });
    const inspector = await openCard(/^5 결제/);
    for (const name of ['수정 요청', '동작 확인', '이어지는 기능 추가', '필수'])
      expect((within(inspector).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    const row = openPromise(inspector, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect((within(row).getByRole('button', { name: '나중에 보기' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(inspector).getByLabelText('결정 메모') as HTMLInputElement).disabled).toBe(true);
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare' || method === 'flow/promise')).toBe(false);
  });

  it('lists the map files that could not be read without hiding the rest', async () => {
    mount(
      withBoard((board) => {
        board.problems = [
          { file: '.alpine-code/map/features/gift.json', message: 'title is required' },
          { file: '.alpine-code/map/flows/old.json', message: 'bad JSON' },
        ];
      }),
    );
    const summary = await screen.findByText('지도 파일 2개를 읽지 못했어요');
    expect(summary.closest('details')!.open).toBe(false);
    expect(within(summary.closest('details')!).getByText(/gift\.json/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^1 상품 찾기/ })).toBeTruthy();
  });

  it('asks only for what changed: an unchanged answer keeps the map on screen', async () => {
    const { request, client } = mount();
    await loaded();
    const first = request.mock.calls.filter(([method]) => method === 'flow/get');
    expect(first[0]![1]).toMatchObject({ cwd, since: null });
    await client.refetchQueries({ queryKey: ['product-map', cwd] });
    const gets = request.mock.calls.filter(([method]) => method === 'flow/get');
    expect(gets.at(-1)![1]).toMatchObject({ cwd, since: 'etag-0' });
    const answer = await request.mock.results.filter((_, i) => request.mock.calls[i]![0] === 'flow/get').at(-1)!.value;
    expect(answer.unchanged).toBe(true);
    expect(screen.getByText(/^약속 \d+개 중 \d+개를 지키고 있어요$/)).toBeTruthy();
    expect(client.getQueryData<{ document: unknown }>(['product-map', cwd])?.document).toBeTruthy();
  });

  it('loads check pictures when a card opens and not before', async () => {
    const { request } = mount({
      results: { 'flow/node': { checkScreenshots: { coupon: 'data:image/png;base64,AAAA' }, observationImages: {} } },
    });
    await loaded();
    expect(request.mock.calls.some(([method]) => method === 'flow/node')).toBe(false);
    const inspector = await openCard(/^5 결제/);
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/node')?.[1]).toEqual({ cwd, nodeId: 'payment' }),
    );
    openPromise(inspector, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    await waitFor(() => expect(inspector.querySelector('img[src="data:image/png;base64,AAAA"]')).toBeTruthy());
  });

  it('puts each map setting where it matters, with no settings window', async () => {
    const board = bookingBoard();
    board.include = ['apps/web'];
    board.exclude = ['**/*.lock', 'fixtures/**'];
    board.coverage = { git: true, uncovered: ['src/a.ts'], uncoveredCount: 1, outOfScope: 0, excluded: 4 };
    const { request } = mount(boardScript(board));
    await loaded();
    // The AI's exclusions sit under the changes they hide, not in the settings.
    fireEvent.click(coverageRow());
    const excluded = (await screen.findByText('제외된 변경 4개')).closest('details')!;
    expect(within(excluded).getByText('fixtures/**')).toBeTruthy();
    fireEvent.keyDown(globalThis.document.body, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '지도 설정' })).toBeNull();
    // The scope is one item of the map menu; it opens the editor under the header.
    expect(screen.queryByRole('region', { name: '지도 범위' })).toBeNull();
    fireEvent.click(await menuItem('지도 범위 바꾸기'));
    expect(within(await screen.findByRole('region', { name: '지도 범위' })).getByText('apps/web')).toBeTruthy();
    const field = screen.getByLabelText('폴더 경로');
    fireEvent.change(field, { target: { value: './apps/api/' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/scope')?.[1]).toEqual({
        cwd,
        include: ['apps/web', 'apps/api'],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'apps/web 빼기' }));
    await waitFor(() =>
      expect(request.mock.calls.filter(([method]) => method === 'flow/scope').at(-1)?.[1]).toEqual({
        cwd,
        include: ['apps/api'],
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('region', { name: '지도 범위' })).toBeNull();
    // The daily check is a checkbox item that keeps the menu open.
    const daily = await menuItem('매일 자동으로 확인', 'menuitemcheckbox');
    expect(daily.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(daily);
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/schedule')?.[1]).toEqual({
        cwd,
        enabled: true,
        limit: 20,
      }),
    );
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('starts the daily check once when it is due, in look-first order and within the limit', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.schedule = { enabled: true, limit: 1, lastRun: '2026-01-01T00:00:00Z' };
        board.states!.cart!.changed = true;
        board.states!.cart!.status = 'recheck';
        board.document!.nodes!.find((n) => n.id === 'cart')!.priority = 'must';
      }),
    );
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', nodeIds: ['cart'] }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/schedule')?.[1]).toEqual({
        cwd,
        enabled: true,
        limit: 1,
        ran: true,
      }),
    );
    expect(request.mock.calls.filter(([method]) => method === 'flow/prepare')).toHaveLength(1);
  });

  it('starts no batch when the server refuses the daily claim, and does not try again', async () => {
    const { request } = mount(
      mergeScripts(
        withBoard((board) => {
          board.schedule = { enabled: true, limit: 5, lastRun: 'not a date' };
        }),
        {
          results: {
            'flow/schedule': () => {
              throw new ServerError(-32000, 'ran today', { reason: 'flow_conflict' });
            },
          },
        },
      ),
    );
    await waitFor(() => expect(request.mock.calls.some(([method]) => method === 'flow/schedule')).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(request.mock.calls.filter(([method]) => method === 'flow/schedule')).toHaveLength(1);
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
  });

  it('does not start the daily check while another session of the project is working', async () => {
    const { request } = mount(
      mergeScripts(
        withBoard((board) => {
          board.schedule = { enabled: true, limit: 5, lastRun: null };
        }),
        { results: { 'session/list': { sessions: [sessionInfo({ id: 'busy', cwd, status: 'running' })] } } },
      ),
    );
    await loaded();
    expect(request.mock.calls.some(([method]) => method === 'flow/schedule')).toBe(false);
  });

  it('keeps the reason typed for will-not-fix when saving fails', async () => {
    mount({
      results: {
        'flow/promise': () => {
          throw new Error('offline');
        },
      },
    });
    const inspector = await openCard(/^5 결제 실패/);
    const row = openPromise(inspector, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    fireEvent.click(within(row).getByRole('button', { name: '안 고침' }));
    const field = within(row).getByLabelText('안 고치는 이유를 한 줄로 적어 주세요') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '곧 없앰' } });
    fireEvent.click(within(row).getByRole('button', { name: '저장' }));
    expect((await within(inspector).findAllByRole('alert')).length).toBeGreaterThan(0);
    expect((within(row).getByLabelText('안 고치는 이유를 한 줄로 적어 주세요') as HTMLInputElement).value).toBe(
      '곧 없앰',
    );
  });

  it("never shows one card's pictures on another", async () => {
    mount({
      results: {
        'flow/node': ({ nodeId }) => ({
          checkScreenshots:
            nodeId === 'payment' ? { coupon: 'data:image/png;base64,PAY' } : ({} as Record<string, string>),
          observationImages: {},
        }),
      },
    });
    const payment = await openCard(/^5 결제/);
    await waitFor(() => expect(payment.querySelector('img[src="data:image/png;base64,PAY"]')).toBeTruthy());
    fireEvent.click((await screen.findAllByRole('button', { name: /^1 상품 찾기/ }))[0]!);
    const browse = screen.getByRole('complementary', { name: '상품 찾기' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(browse.querySelector('img[src="data:image/png;base64,PAY"]')).toBeNull();
  });

  it('does not start the daily check when it ran today or is switched off', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.schedule = { enabled: true, limit: 5, lastRun: new Date().toISOString() };
      }),
    );
    await loaded();
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
    cleanup();
    const off = mount();
    await loaded();
    expect(off.request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
  });
});

describe('check records', () => {
  const open = async (name: RegExp, title: string) => {
    mount(flowScript(STUDIO_MAP));
    fireEvent.click((await screen.findAllByRole('button', { name }))[0]!);
    return screen.getByRole('complementary', { name: title });
  };
  it('labels each observation with where Alpine got it', async () => {
    const inspector = await open(/^\d+ 카드 결제 승인/, '카드 결제 승인');
    expect(within(inspector).getAllByText('Alpine이 확인함').length).toBeGreaterThan(0);
    expect(within(inspector).getAllByText('해본 것', { selector: 'h4' }).length).toBeGreaterThan(0);
    expect(within(inspector).getAllByText('관찰', { selector: 'h4' }).length).toBeGreaterThan(0);
    expect(within(inspector).getAllByText('판단', { selector: 'h4' }).length).toBeGreaterThan(0);
    expect(within(inspector).getByText('AI 설명')).toBeTruthy();
  });
  it('puts the badge on the quoted excerpt and styles the AI words as the AI', async () => {
    const inspector = await open(/^\d+ 결제 결과 받기/, '결제 결과 받기');
    const excerpt = within(inspector).getByText(/webhook body status: CANCELED/);
    expect(excerpt.textContent).toContain('stored status: DONE');
    const item = excerpt.closest('li')!;
    const badge = item.querySelector('[data-provenance="verified"]')!;
    expect(badge).toBeTruthy();
    // The badge precedes the excerpt, and the caption is marked as the AI's words.
    expect(badge.compareDocumentPosition(excerpt) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const words = item.querySelector('[data-ai-words]')!;
    expect(words.textContent).toContain('AI 설명:');
    expect(words.contains(badge)).toBe(false);
  });
  it('hints at thin or contradicted evidence in the collapsed promise row', async () => {
    const inspector = await open(/^\d+ 카드 결제 승인/, '카드 결제 승인');
    const hints = within(inspector).getAllByTestId('evidence-hint');
    expect(hints.some((hint) => hint.textContent === '근거 확인 안 됨기록과 다름 1')).toBe(true);
    expect(hints.every((hint) => hint.closest('summary'))).toBe(true);
    expect(within(inspector).getByText(/^약속 3개 중 \d개 통과$/)).toBeTruthy();
  });
  it('words the session and Alpine-record mismatch reasons plainly', () => {
    const t = messages.ko;
    expect(t.reasonOutsideSession).toBe('이 작업 중에 만든 파일이 아니에요.');
    expect(t.reasonAlpineRecord).toBe('Alpine 기록 파일을 근거로 쓸 수 없어요.');
    expect(messages.en.reasonOutsideSession).toBeTruthy();
    expect(messages.en.reasonAlpineRecord).toBeTruthy();
  });
  it('shows a mismatch with its reason and marks a check with no confirmed evidence', async () => {
    const inspector = await open(/^\d+ 카드 결제 승인/, '카드 결제 승인');
    expect(within(inspector).getAllByText('기록과 다름')).toHaveLength(1);
    expect(within(inspector).getByText('기록에서 이 내용을 찾지 못했어요.')).toBeTruthy();
    // The amount check (only a mismatch and an agent note) and the older decline check rest on nothing confirmed.
    // The result is still shown as passed.
    expect(within(inspector).getAllByText('근거 확인 안 됨')).toHaveLength(4);
    expect(within(inspector).getByText(/^약속 3개 중 \d개 통과$/)).toBeTruthy();
  });
  it('keeps what could not be checked outside the technical record', async () => {
    const inspector = await open(/^\d+ 이용권 환불/, '이용권 환불');
    const limit = within(inspector).getByText('약관의 정확한 계산식은 확인하지 못했어요. 기대값은 예시 계산이에요.');
    expect(limit.closest('details')!.querySelector('summary')!.textContent).not.toContain('기술 기록');
    const expected = within(inspector).getByText('180,000원 (사용분 90,000원과 위약금 30,000원을 뺀 금액)');
    expect(expected.closest('dl')!.textContent).toContain('210,000원');
    const record = within(inspector).getAllByText('기술 기록')[0]!.closest('details')!;
    expect(record.open).toBe(false);
    expect(record.textContent).toContain('call_f1');
    expect(within(inspector).getAllByText(/로컬 개발 서버 · 토스 테스트 결제/).length).toBeGreaterThan(0);
  });
  it('renders captured screens inline and says so when the picture is not here', async () => {
    const schedule = await open(/^\d+ 주간 시간표/, '주간 시간표');
    expect(
      (await within(schedule).findByAltText('마감된 수업 줄에 [예약] 대신 [대기 신청]이 보여요.')).getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);
    expect(within(schedule).getAllByText('Alpine이 직접 찍음').length).toBeGreaterThan(0);
    cleanup();
    const signup = await open(/^\d+ 카카오로 가입/, '카카오로 가입');
    expect(await within(signup).findByText('다른 컴퓨터에서 찍은 화면이라 여기엔 없어요.')).toBeTruthy();
  });
  it('keeps the two-tier view for older checks and labels them as unconfirmed evidence', async () => {
    const inspector = await open(/^\d+ 휴대폰 인증/, '휴대폰 인증');
    expect(within(inspector).queryByText('관찰', { selector: 'h4' })).toBeNull();
    expect(within(inspector).getAllByText('근거 확인 안 됨').length).toBeGreaterThan(0);
    expect(
      within(inspector).getByText('맞는 인증번호로 확인을 요청하자 휴대폰 번호가 확인됨으로 바뀌었어요.'),
    ).toBeTruthy();
    expect(within(inspector).getAllByText('기술 기록')[0]!.closest('details')!.textContent).toContain(
      'pnpm test phone',
    );
  });
  it('shows the corrected webhook promises', async () => {
    const inspector = await open(/^\d+ 결제 결과 받기/, '결제 결과 받기');
    expect(
      within(inspector).getByText('결제 알림을 받으면 orderId로 결제를 다시 조회해 확인된 상태만 반영한다.'),
    ).toBeTruthy();
    expect(within(inspector).getByText('결제 알림에 10초 안에 응답한다.')).toBeTruthy();
    expect(within(inspector).queryByText(/서명/)).toBeNull();
  });
});

describe('discovery and map settings', () => {
  it('marks sources the AI never opened on the card and in its details', async () => {
    mount(
      withBoard((board) => {
        board.document!.nodes!.find((n) => n.id === 'cart')!.sources = ['src/Cart.tsx', 'src/cartStore.ts'];
        board.states!.cart!.unread = ['src/cartStore.ts'];
      }),
    );
    const cart = await screen.findByRole('button', { name: /장바구니/ });
    expect(within(cart).getByText('안 열어 본 근거')).toBeTruthy();
    fireEvent.click(cart);
    const inspector = screen.getByRole('complementary');
    expect(within(inspector).getByText(/열어 보지 않은 근거 파일이 1개/)).toBeTruthy();
    const technical = within(inspector).getByText('기술 정보').closest('details')!;
    expect(within(technical).getByText(/src\/cartStore.ts/).textContent).toContain('열어 보지 않음');
    expect(within(technical).getByText('src/Cart.tsx').textContent).not.toContain('열어 보지 않음');
  });

  it('shows the started work in the dock, with no status strip or conversation panel on the map', async () => {
    const { onShowConversation, onSession } = mount();
    fireEvent.click((await screen.findAllByRole('button', { name: '이 흐름 전체 확인' }))[0]!);
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
    expect(onShowConversation).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '작업 내용' })).toBeNull();
    expect(screen.queryByText(/에이전트 작업이 끝났어요/)).toBeNull();
  });
  it('deletes the map from its settings after one confirmation', async () => {
    const { request } = mount();
    await loaded();
    fireEvent.click(await menuItem('지도 삭제'));
    expect(request.mock.calls.some(([method]) => method === 'flow/delete')).toBe(false);
    const strip = await screen.findByRole('region', { name: '지도 삭제' });
    expect(within(strip).getByText(/되돌릴 수 없어요/)).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(request.mock.calls.find(([method]) => method === 'flow/delete')?.[1]).toEqual({ cwd }));
    expect(await screen.findByRole('button', { name: '만들어진 기능 찾기' })).toBeTruthy();
  });

  it('shows the scope before the map is made', async () => {
    const { request } = mount({
      results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing', include: [] } },
    });
    expect(await screen.findByText('지도로 만들 폴더')).toBeTruthy();
    expect(screen.getByText('프로젝트 전체')).toBeTruthy();
    const field = screen.getByLabelText('폴더 경로');
    fireEvent.change(field, { target: { value: 'apps/web' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/scope')?.[1]).toEqual({
        cwd,
        include: ['apps/web'],
      }),
    );
  });
});

describe("the user's own sentences (decision 16)", () => {
  it('rewrites a promise in place; it becomes theirs and waits for one check run', async () => {
    const { request } = mount();
    const member = await openCard(/회원 주문 재확인 필요/);
    const row = within(member).getByText('저장된 기본 배송지가 미리 채워진다.').closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: '문장 고치기' }));
    const field = within(member).getByRole('textbox', { name: '문장 고치기' });
    fireEvent.change(field, { target: { value: '배송지는 매번 새로 입력한다.' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/edit', {
        cwd,
        nodeId: 'member',
        field: 'promise',
        conditionId: 'address',
        value: '배송지는 매번 새로 입력한다.',
      }),
    );
    const mine = (await within(member).findByText('배송지는 매번 새로 입력한다.')).closest('li')!;
    expect(within(mine).getByText('내가 정함')).toBeTruthy();
    expect(within(mine).getByText('지금 코드가 이렇게 하는지 아직 몰라요')).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'AI에게 확인 맡기기' })).toBeTruthy();
    // Nothing ran on save; the side panel gathers edited promises into one check.
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
    const edited = screen.getByText('고친 약속 1개').closest('p')!;
    fireEvent.click(within(edited).getByRole('button', { name: '확인하기' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', nodeIds: ['member'] }));
  });

  it("adds a promise in the user's words and cancels an edit with Escape", async () => {
    const { request } = mount();
    const member = await openCard(/회원 주문 재확인 필요/);
    fireEvent.click(within(member).getByRole('button', { name: '약속 추가' }));
    const field = within(member).getByRole('textbox', { name: '약속 추가' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(within(member).queryByRole('textbox', { name: '약속 추가' })).toBeNull();
    fireEvent.click(within(member).getByRole('button', { name: '약속 추가' }));
    const again = within(member).getByRole('textbox', { name: '약속 추가' });
    fireEvent.change(again, { target: { value: '비회원도 주문 내역을 조회할 수 있다.' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/edit', {
        cwd,
        nodeId: 'member',
        field: 'promise',
        conditionId: null,
        value: '비회원도 주문 내역을 조회할 수 있다.',
      }),
    );
  });

  it('writes the title and "직접 해 보려면" in place', async () => {
    const { request } = mount();
    const member = await openCard(/회원 주문 재확인 필요/);
    fireEvent.click(within(member).getByRole('button', { name: '적기' }));
    const field = within(member).getByRole('textbox', { name: '직접 해 보려면' });
    fireEvent.change(field, { target: { value: '테스트 회원 계정으로 로그인' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await within(member).findByText('테스트 회원 계정으로 로그인')).toBeTruthy();
    fireEvent.click(within(member).getByRole('button', { name: '이름 고치기' }));
    const title = within(member).getByRole('textbox', { name: '이름 고치기' });
    fireEvent.change(title, { target: { value: '회원으로 주문하기' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/edit', {
        cwd,
        nodeId: 'member',
        field: 'title',
        value: '회원으로 주문하기',
      }),
    );
  });

  it('asks for structure changes in words, as a "지도에서 고치기" run', async () => {
    const { request } = mount();
    const member = await openCard(/회원 주문 재확인 필요/);
    fireEvent.click(within(member).getByRole('button', { name: '지도에서 고치기' }));
    fireEvent.change(within(member).getByLabelText(/나누거나 합치거나/), {
      target: { value: '회원 주문이랑 배송지 저장은 따로 봐야 해' },
    });
    fireEvent.click(within(member).getByRole('button', { name: '작업 시작' }));
    await waitFor(() =>
      expect(lastPrepare(request)).toMatchObject({
        action: 'reshape',
        nodeId: 'member',
        request: '회원 주문이랑 배송지 저장은 따로 봐야 해',
      }),
    );
  });

  it('shows what a "지도에서 고치기" run changed until the user keeps it or puts the map back', async () => {
    const { request } = mount(
      seeded((board) => {
        board.review = {
          sessionId: 's1',
          at: '2026-10-14T00:00:00Z',
          added: ['가입하기'],
          removed: [],
          changed: ['로그인하기'],
        };
      }),
    );
    const banner = (await screen.findByText('AI가 지도를 이렇게 바꿨어요')).closest('[data-review]') as HTMLElement;
    expect(within(banner).getByText('새 카드: 가입하기')).toBeTruthy();
    expect(within(banner).getByText('바뀐 카드: 로그인하기')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: '예전 지도로 되돌리기' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('flow/review', { cwd, target: 'map', action: 'restore' }));
    await waitFor(() => expect(screen.queryByText('AI가 지도를 이렇게 바꿨어요')).toBeNull());
  });

  it('lists cards the user decided on that the AI removed, with keep and put back', async () => {
    const { request } = mount(
      seeded((board) => {
        board.removedCards = [{ id: 'refund', title: '환불 받기' }];
      }),
    );
    const list = await screen.findByRole('region', { name: 'AI가 지운, 내가 정한 카드' });
    expect(within(list).getByText('환불 받기')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: '되돌리기' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/review', {
        cwd,
        target: 'card',
        action: 'restore',
        nodeId: 'refund',
      }),
    );
  });

  it('says a promise without any check was written from the code', async () => {
    mount(
      withBoard((board) => {
        const node = board.document!.nodes!.find((n) => n.id === 'member')!;
        node.checks = [];
        board.states!.member!.promises!.address = { status: 'unconfirmed', origin: 'inferred' };
      }),
    );
    const member = await openCard(/^\d+ 회원 주문/);
    expect(within(member).getByText('코드만 보고 쓴 약속 · 확인 전')).toBeTruthy();
  });
});

describe('flows that call another flow (decision 19)', () => {
  it('draws the called flow as one box that leads to that flow', async () => {
    let calledTitle = '';
    let cards = 0;
    mount(
      withBoard((board) => {
        const [first, second] = board.document!.flows!;
        calledTitle = second!.title;
        cards = second!.nodeIds!.length;
        first!.nodeIds = [`flow:${second!.id}`, ...first!.nodeIds!];
      }),
    );
    const box = await screen.findByRole('button', { name: `${calledTitle} 흐름으로 이동` });
    expect(within(box).getByText(`카드 ${cards}장 · 눌러서 보기`)).toBeTruthy();
    fireEvent.click(box);
  });
});

describe('person-first view', () => {
  beforeEach(() => localStorage.removeItem('alpine.product-map.view'));

  it('opens by person, and switching to the card map is remembered', async () => {
    mount();
    const byPerson = await screen.findByRole('radio', { name: '사람별 흐름' });
    expect(byPerson.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: '카드 지도' }));
    expect(localStorage.getItem('alpine.product-map.view')).toBe('cards');
    expect(await loaded()).toBeTruthy();
  });

  it('asking the AI to check sends one verify for the unchecked steps and opens its session', async () => {
    const { request, onSession } = mount();
    const panel = await screen.findByRole('complementary');
    fireEvent.click(await within(panel).findByRole('button', { name: 'AI에게 확인 맡기기' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', cwd }));
    expect((lastPrepare(request) as { nodeIds: string[] }).nodeIds.length).toBeGreaterThan(0);
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
  });

  it('grouping journeys under who walks them writes their actor, and the band takes that name', async () => {
    const { request } = mount();
    const panel = await screen.findByRole('complementary');
    fireEvent.click(await within(panel).findByRole('button', { name: '이 여정들 묶기' }));
    fireEvent.change(within(panel).getByLabelText(/누가 걷는지/), { target: { value: '회원' } });
    fireEvent.click(within(panel).getByRole('button', { name: '추가' }));
    await waitFor(() =>
      expect(
        request.mock.calls.some(
          ([method, params]) => method === 'flow/actor' && (params as { actor: string }).actor === '회원',
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole('heading', { name: '회원' })).toBeTruthy();
  });
});
