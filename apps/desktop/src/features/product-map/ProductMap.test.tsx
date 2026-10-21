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
import { bookingBoard, boardScript, ORDER_FLOW, SDK_FLOW, seeded, withBoard } from './testBoard';

const cwd = '/project';
/** The map's top row is there once the map has loaded. */
const loaded = () => screen.findByRole('button', { name: '지도 메뉴' });
/** The step cards with this title (a step shared by two journeys has a card in each). */
const stepCards = (title: string) =>
  screen
    .getAllByRole('button', { hidden: true })
    .filter(
      (button) =>
        button.hasAttribute('aria-expanded') &&
        button.closest('[data-node]') &&
        within(button).queryAllByText(title, { exact: true }).length > 0,
    );
/** The first step card with this title, once the map has drawn it. */
async function stepCard(title: string) {
  await waitFor(() => expect(stepCards(title).length).toBeGreaterThan(0));
  return stepCards(title)[0]!;
}
/** Whether the map quiets this card (a search or a status lights the others). */
const dimmed = (card: HTMLElement) =>
  (card.closest('[data-node]')!.firstElementChild as HTMLElement).style.opacity === '0.35';
/** Opens a step's panel from its card on the canvas. */
async function openStep(title: string) {
  fireEvent.click(await stepCard(title));
  return screen.findByRole('dialog');
}
/** In an open step's panel, opens the promise whose sentence starts with `text`. */
function openPromise(panel: HTMLElement, text: string) {
  fireEvent.click(within(panel).getByRole('button', { name: (name) => name.startsWith(text) }));
  return screen.getByRole('dialog');
}
/** Opens a step, then one of its promises. */
async function promiseView(title: string, text: string) {
  return openPromise(await openStep(title), text);
}
/** From a promise back to its step, through the breadcrumb. */
function backToStep(panel: HTMLElement, title: string) {
  fireEvent.click(within(panel).getByRole('button', { name: title }));
  return screen.getByRole('dialog');
}
/** Opens the map's "⋯" menu and returns its item with this name. */
async function menuItem(name: RegExp | string, role: 'menuitem' | 'menuitemcheckbox' = 'menuitem') {
  fireEvent.click(await screen.findByRole('button', { name: '지도 메뉴' }));
  return screen.findByRole(role, { name });
}
/** The row under the top one that lists what wants a look, or null when nothing does. */
const notices = () => screen.queryByRole('list', { name: '지도에서 볼 것' });
/** Every step card on the canvas. */
const allSteps = () =>
  screen.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded') && b.closest('[data-node]'));

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
  Element.prototype.scrollIntoView = vi.fn();
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
  it('asks the AI about a card in words and opens the real session', async () => {
    const { request, onSession } = mount();
    const panel = await openStep('장바구니');
    const send = within(panel).getByRole('button', { name: '보내기' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText('AI에게 부탁하기'), {
      target: { value: '선물 포장 단계를 추가해 줘' },
    });
    fireEvent.click(send);
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
    expect(lastPrepare(request)).toMatchObject({
      action: 'change',
      nodeId: 'cart',
      flowId: null,
      request: '선물 포장 단계를 추가해 줘',
    });
    expect(request.mock.calls.find(([method]) => method === 'session/send')?.[1]).toMatchObject({
      sessionId: 'new-session',
    });
    // Once the AI has it, the box is empty for the next request.
    await waitFor(() =>
      expect((within(screen.getByRole('dialog')).getByLabelText('AI에게 부탁하기') as HTMLTextAreaElement).value).toBe(
        '',
      ),
    );
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
    const panel = await openStep('장바구니');
    fireEvent.change(within(panel).getByLabelText('AI에게 부탁하기'), { target: { value: '선물 주문' } });
    fireEvent.click(within(panel).getByRole('button', { name: '보내기' }));
    expect(await screen.findByRole('alert', { hidden: true })).toBeTruthy();
    // What was typed stays until the AI has it.
    expect((within(panel).getByLabelText('AI에게 부탁하기') as HTMLTextAreaElement).value).toBe('선물 주문');
    fireEvent.click(screen.getByRole('button', { name: '다시 시도', hidden: true }));
    await waitFor(() => expect(onSession).toHaveBeenCalled());
    expect(request.mock.calls.filter(([method]) => method === 'session/new')).toHaveLength(1);
    expect(request.mock.calls.filter(([method]) => method === 'flow/prepare')).toHaveLength(1);
  });
  it("shows a step's promises, where else it is used, and a failed promise's plain record", async () => {
    mount();
    const panel = await openStep('결제');
    expect(within(panel).getByText('약속 4개 중 3개 통과')).toBeTruthy();
    expect(within(panel).getByText(ORDER_FLOW.title)).toBeTruthy();
    const elsewhere = within(panel).getByText('다른 여정에도 나와요').parentElement!;
    expect(within(elsewhere).getByText(SDK_FLOW.title)).toBeTruthy();
    const coupon = openPromise(panel, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(coupon).getByText('10% 쿠폰을 적용하면 할인된 금액으로 결제한다.')).toBeTruthy();
    expect(within(coupon).getByText('쿠폰을 적용하면 결제 금액이 갱신되지 않아요.')).toBeTruthy();
  });
  it('requests a re-check of the open card', async () => {
    const { request } = mount();
    const panel = await openStep('회원 주문');
    fireEvent.click(within(panel).getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', nodeId: 'member' }));
  });
  it('asks the AI to fix a failed promise from the promise itself', async () => {
    const { request } = mount();
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    fireEvent.click(within(coupon).getByRole('button', { name: '고쳐 달라고 하기' }));
    await waitFor(() =>
      expect(lastPrepare(request)).toMatchObject({
        action: 'change',
        nodeId: 'payment',
        request: expect.stringContaining('10% 쿠폰을 적용하면 할인된 금액으로 결제한다.'),
      }),
    );
  });
  it('shows plain evidence before the folded technical record', async () => {
    mount();
    const list = await promiseView('상품 찾기', '판매 중인 상품만 가격과 함께 보인다.');
    expect(within(list).getByText('예제 실행 기록')).toBeTruthy();
    const record = within(list).getByText('기술 기록').closest('details')!;
    expect(record.open).toBe(false);
    expect(record.textContent).toContain('pnpm test list');
  });
  it('saves planning decisions through flow/set without a revision', async () => {
    const { request } = mount();
    const panel = await openStep('상품 찾기');
    fireEvent.click(within(panel).getByRole('radio', { name: '필수' }));
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/set')?.[1]).toMatchObject({
        cwd,
        nodeId: 'browse',
        field: 'priority',
        value: 'must',
      }),
    );
    expect(request.mock.calls.find(([method]) => method === 'flow/set')?.[1]).not.toHaveProperty('revision');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('radio', { name: '이번에' }));
    await waitFor(() =>
      expect(request.mock.calls.filter(([method]) => method === 'flow/set').at(-1)?.[1]).toMatchObject({
        field: 'scope',
        value: 'now',
      }),
    );
    // Tags are the AI's to write: there is no field to pick a group by hand.
    expect(within(screen.getByRole('dialog')).queryByLabelText('영역')).toBeNull();
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
  it('keeps an unreadable document from triggering discovery writes', async () => {
    const { request } = mount({
      results: {
        'flow/get': () => {
          throw new Error('Invalid JSON');
        },
      },
    });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '지도 그리기' })).toBeNull();
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
  });
  it('has an empty discovery state instead of invented features', async () => {
    mount({ results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing' } } });
    expect(await screen.findByRole('button', { name: '지도 그리기' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /장바구니/ })).toBeNull();
  });
  it('opens on the person view, with one card per journey and no view switch', async () => {
    mount();
    await loaded();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('radio', { name: '카드 지도' })).toBeNull();
    expect(screen.queryByRole('radio', { name: '사람별 흐름' })).toBeNull();
    expect(screen.getAllByRole('button', { name: new RegExp(ORDER_FLOW.title) })).toHaveLength(1);
    // A step on two journeys has a card on each.
    expect(await screen.findAllByText('결제', { exact: true })).toHaveLength(2);
    expect(stepCards('결제')).toHaveLength(2);
    expect(localStorage.getItem('alpine.product-map.view')).toBeNull();
  });
  it('puts a screen picture on screen cards, a quiet note when there is none, and nothing on other cards', async () => {
    mount(
      withBoard((board) => {
        board.previews = { browse: 'data:image/png;base64,AAAA' };
        board.document!.nodes!.find((n) => n.id === 'browse')!.previewAt = new Date().toISOString();
      }),
    );
    const card = await stepCard('상품 찾기');
    expect(card.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(within(card).getByText('실제 화면')).toBeTruthy();
    for (const title of ['장바구니', '비회원 주문'])
      expect(within(await stepCard(title)).getByText('아직 화면이 없어요')).toBeTruthy();
    expect(within(await stepCard('결제')).queryByText('아직 화면이 없어요')).toBeNull();
  });
  it('closes the step panel with Esc', async () => {
    mount();
    await openStep('상품 찾기');
    fireEvent.keyDown(globalThis.document.activeElement ?? globalThis.document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('hides the new-flow button until a map exists', async () => {
    mount({ results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing' } } });
    await screen.findByRole('button', { name: '지도 그리기' });
    expect(screen.queryByRole('button', { name: '새 흐름' })).toBeNull();
    expect(screen.queryByRole('button', { name: '지도 메뉴' })).toBeNull();
  });
});

describe('the top row', () => {
  it('lights what the search matches, counts results and clears with Escape', async () => {
    mount();
    await loaded();
    const box = screen.getByPlaceholderText('기능, 태그, 약속 검색') as HTMLInputElement;
    fireEvent.keyDown(globalThis.document.body, { key: '/' });
    expect(globalThis.document.activeElement).toBe(box);
    expect(allSteps().some(dimmed)).toBe(false);
    fireEvent.change(box, { target: { value: '장바구니' } });
    expect(dimmed(await stepCard('장바구니'))).toBe(false);
    // The steps that lead to a hit stay clear, so its journey still reads; the rest quiets down.
    expect(dimmed(await stepCard('상품 찾기'))).toBe(false);
    expect(dimmed(await stepCard('주문 요청'))).toBe(true);
    expect(screen.getByText('1개 찾음')).toBeTruthy();
    // One hit: no "다음".
    expect(screen.queryByRole('button', { name: '다음 검색 결과' })).toBeNull();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.value).toBe('');
    expect(allSteps().some(dimmed)).toBe(false);
    expect(screen.queryByText(/개 찾음$/)).toBeNull();
  });
  it('opens the next hit with Enter and "다음"', async () => {
    mount();
    await loaded();
    const box = screen.getByPlaceholderText('기능, 태그, 약속 검색');
    fireEvent.change(box, { target: { value: '주문' } });
    const count = Number(/\d+/.exec(screen.getByText(/개 찾음$/).textContent!)![0]);
    expect(count).toBeGreaterThan(1);
    const title = () => within(screen.getByRole('dialog')).getByRole('heading', { level: 2 }).textContent;
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByRole('dialog');
    const first = title();
    expect(first).toBe('장바구니');
    fireEvent.click(screen.getByRole('button', { name: '다음 검색 결과', hidden: true }));
    await waitFor(() => expect(title()).not.toBe(first));
    expect(title()).toBe('회원 주문');
  });
  it('checks every card the search found, tags included, in one run', async () => {
    const { request } = mount();
    await loaded();
    expect(screen.queryByRole('group', { name: '태그' })).toBeNull();
    expect(screen.queryByRole('button', { name: '찾은 기능 모두 확인' })).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('기능, 태그, 약속 검색'), { target: { value: '주문' } });
    for (const title of ['회원 주문', '비회원 주문']) expect(dimmed(await stepCard(title))).toBe(false);
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
    // Each feature once, however many journeys it is on.
    const ids = (lastPrepare(request) as { nodeIds: string[] }).nodeIds;
    expect(new Set(ids).size).toBe(ids.length);
    expect(request.mock.calls.filter(([method]) => method === 'flow/prepare')).toHaveLength(1);
  });
  it('finds cards by their tags in the search', async () => {
    mount();
    await loaded();
    fireEvent.change(screen.getByPlaceholderText('기능, 태그, 약속 검색'), { target: { value: '연동' } });
    expect(screen.getByText('2개 찾음')).toBeTruthy();
    expect(dimmed(await stepCard('주문 요청'))).toBe(false);
    expect(dimmed(await stepCard('주문 결과 받기'))).toBe(false);
    expect(dimmed(await stepCard('장바구니'))).toBe(true);
  });
  it('a status chip lights its cards and lets go when pressed again; one at a time', async () => {
    mount();
    await loaded();
    const again = screen.getByRole('button', { name: '다시 확인 1' });
    const failed = screen.getByRole('button', { name: '실패 1' });
    expect(screen.getByRole('button', { name: '바뀐 것 2' })).toBeTruthy();
    expect(again.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(again);
    expect(again.getAttribute('aria-pressed')).toBe('true');
    expect(dimmed(await stepCard('회원 주문'))).toBe(false);
    const quiet = await stepCard('주문 요청');
    expect(dimmed(quiet)).toBe(true);
    // Quieted cards stay focusable buttons.
    quiet.focus();
    expect(globalThis.document.activeElement).toBe(quiet);
    fireEvent.click(failed);
    expect(failed.getAttribute('aria-pressed')).toBe('true');
    expect(again.getAttribute('aria-pressed')).toBe('false');
    expect(stepCards('결제').every((card) => !dimmed(card))).toBe(true);
    expect(dimmed(await stepCard('주문 결과 받기'))).toBe(true);
    fireEvent.click(failed);
    expect(failed.getAttribute('aria-pressed')).toBe('false');
    expect(allSteps().some(dimmed)).toBe(false);
  });
  it('shows no status chip for a status nothing has', async () => {
    mount(
      withBoard((board) => {
        board.states = {};
      }),
    );
    await loaded();
    expect(screen.queryByRole('button', { name: /^실패 \d/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^다시 확인 \d/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^바뀐 것 \d/ })).toBeNull();
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
    // A change opens its card in the map.
    fireEvent.click(within(panel).getByRole('button', { name: /결제/ }));
    const step = await screen.findByRole('dialog');
    expect(within(step).getByRole('heading', { name: '결제', level: 2 })).toBeTruthy();
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
    expect(within(panel).queryByText(/planned/)).toBeNull();
    expect(within(panel).getByText(/결제 · 안 고치기로 함/)).toBeTruthy();
    expect(within(panel).getByText(/회원 주문 · 다시 돌려 봄 · 같은 결과/)).toBeTruthy();
  });
  it('words a stage change ("planned -> built") plainly', async () => {
    mount(
      withBoard((board) => {
        board.changes = [
          { at: '2026-10-10T03:00:00Z', nodeId: 'cart', title: '장바구니', kind: 'phase', detail: 'planned -> built' },
        ];
      }),
    );
    fireEvent.click(await menuItem(/^바뀐 기록/));
    const panel = await screen.findByRole('complementary', { name: '최근 변경' });
    expect(within(panel).getByText('예정 → 구현됨')).toBeTruthy();
  });
  it('shows the notice row only when something wants a look', async () => {
    mount();
    await loaded();
    expect(notices()).toBeNull();
    cleanup();
    mount(
      withBoard((board) => {
        board.coverage = { git: false, uncoveredCount: 3 };
      }),
    );
    await loaded();
    // Code changes without git are not counted.
    expect(notices()).toBeNull();
    expect(screen.queryByText('지도에 아직 없는 코드 변경')).toBeNull();
    cleanup();
    mount(
      withBoard((board) => {
        board.coverage = { git: true, uncovered: ['src/a.ts'], uncoveredCount: 1 };
        board.removedCards = [{ id: 'refund', title: '환불 받기' }];
      }),
    );
    await loaded();
    const row = notices()!;
    expect(within(row).getByRole('button', { name: /^지도에 아직 없는 코드 변경/ })).toBeTruthy();
    expect(within(row).getByRole('button', { name: /^AI가 지운 카드 1개/ })).toBeTruthy();
    expect(within(row).queryByText(/고친 약속/)).toBeNull();
    expect(within(row).queryByText('아직 그리지 않은 것')).toBeNull();
  });
});

describe('map upkeep', () => {
  const promiseCalls = (request: { mock: { calls: unknown[][] } }) =>
    request.mock.calls.filter(([method]) => method === 'flow/promise').map(([, params]) => params);
  const guessed = () =>
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
    });

  it('shows a rule the AI guessed and failed as a question, and confirming it makes it an open problem', async () => {
    const { request } = mount(guessed());
    const phone = await promiseView('비회원 주문', '연락처는 숫자만 받는다.');
    expect(within(phone).getAllByText('이게 맞는 규칙인가요?').length).toBeGreaterThan(0);
    expect(within(phone).queryByRole('button', { name: 'AI에게 고쳐 달라기' })).toBeNull();
    fireEvent.click(within(phone).getByRole('button', { name: '맞아요' }));
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'guest',
        conditionId: 'phone',
        action: 'confirm',
      }),
    );
    // Confirmed, it is an open problem like any other.
    expect(await within(screen.getByRole('dialog')).findByText(/^열림/)).toBeTruthy();
  });

  it('"이건 규칙이 아니에요" asks the AI to fix or remove the rule right away', async () => {
    const { request, onSession } = mount(guessed());
    const phone = await promiseView('비회원 주문', '연락처는 숫자만 받는다.');
    fireEvent.click(within(phone).getByRole('button', { name: '아니에요' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
    expect(lastPrepare(request)).toMatchObject({
      action: 'change',
      nodeId: 'guest',
      request: expect.stringContaining('"연락처는 숫자만 받는다." 규칙은 맞지 않아요'),
    });
    expect(screen.queryByLabelText('어떻게 바꿀까요?')).toBeNull();
    expect(promiseCalls(request)).toHaveLength(0);
  });

  it('shows each issue state with its date and the actions that fit it', async () => {
    const { request } = mount();
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(coupon).getByText(/^열림 · \d+월 \d+일부터$/)).toBeTruthy();
    expect(within(coupon).getAllByText('확정').length).toBeGreaterThan(0);
    fireEvent.click(within(coupon).getByRole('button', { name: '나중에 보기' }));
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'payment',
        conditionId: 'coupon',
        action: 'later',
      }),
    );
    const later = screen.getByRole('dialog');
    expect(await within(later).findByText(/^나중에 보기 · /)).toBeTruthy();
    fireEvent.click(within(later).getByRole('button', { name: '다시 열기' }));
    await waitFor(() => expect(promiseCalls(request).at(-1)).toMatchObject({ action: 'reopen' }));
  });

  it('asks for a one-line reason before marking a problem as will-not-fix', async () => {
    const { request } = mount();
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    fireEvent.click(within(coupon).getByRole('button', { name: '안 고침' }));
    const save = within(coupon).getByRole('button', { name: '저장' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(coupon).getByLabelText('안 고치는 이유를 한 줄로 적어 주세요'), {
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
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(coupon).getByText(text)).toBeTruthy();
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
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(coupon).getByText('고쳐졌을 수도')).toBeTruthy();
    expect(within(coupon).getByText('관련 파일이 바뀌었어요. 다시 확인할까요?')).toBeTruthy();
    fireEvent.click(within(coupon).getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', nodeId: 'payment' }));
  });

  it('lets the user confirm a rule the AI guessed, and take the confirmation back', async () => {
    const { request } = mount();
    const empty = await promiseView('장바구니', '비어 있으면 주문하기를 누를 수 없다.');
    expect(within(empty).getByText('AI 추정')).toBeTruthy();
    fireEvent.click(within(empty).getByRole('button', { name: '맞아요' }));
    await waitFor(() =>
      expect(promiseCalls(request)).toContainEqual({
        cwd,
        nodeId: 'cart',
        conditionId: 'empty',
        action: 'confirm',
      }),
    );
    fireEvent.click(await within(screen.getByRole('dialog')).findByRole('button', { name: '확정 취소' }));
    await waitFor(() =>
      expect(promiseCalls(request).at(-1)).toMatchObject({ conditionId: 'empty', action: 'unconfirm' }),
    );
  });

  it('says where each record came from: Alpine, first seen, another computer, changed since, no match', async () => {
    mount(
      withBoard((board) => {
        const coupon = board.states!.payment!.promises!.coupon!;
        coupon.stamp = { at: '2026-10-02T03:00:00Z', witness: 'mismatch', uncertain: true };
        board.states!.payment!.promises!.retry!.stamp = { at: '2026-10-02T03:00:00Z', witness: 'other' };
      }),
    );
    const stamp = (panel: HTMLElement) => within(panel).getByTestId('stamp').textContent;
    let panel = await promiseView('결제', '쿠폰이 없으면 주문 금액 그대로 결제한다.');
    expect(stamp(panel)).toMatch(/Alpine이 기록$/);
    panel = openPromise(backToStep(panel, '결제'), '결제를 다시 요청해도 중복 청구하지 않는다.');
    expect(stamp(panel)).toMatch(/다른 컴퓨터 기록 · 여기선 대조할 수 없어요$/);
    panel = openPromise(backToStep(panel, '결제'), '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(stamp(panel)).toMatch(/기록과 다름$/);
    expect(within(panel).getByText('확인 뒤 파일이 바뀌어 확실하지 않음')).toBeTruthy();
    cleanup();
    mount();
    const total = await promiseView('장바구니', '수량을 바꾸면 합계가 바로 바뀐다.');
    expect(stamp(total)).toMatch(/^Alpine이 처음 본 시각 · /);
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
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(coupon).getByText('다른 컴퓨터에서 확인한 기록 · 여기선 대조할 수 없어요')).toBeTruthy();
    expect(coupon.querySelector('[data-provenance="verified"]')).toBeNull();
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
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect(within(coupon).getByText('AI가 코드를 읽고 판단함')).toBeTruthy();
    expect(within(coupon).getAllByText('코드를 읽고 판단한 결과예요 · 실행해 보진 않았어요').length).toBeGreaterThan(0);
    expect(coupon.querySelector('[data-provenance="verified"]')).toBeNull();
  });

  it('asks before re-running a command by itself, and shows what a re-run found', async () => {
    const { request } = mount(
      seeded((board) => {
        board.states!.member!.promises!.address!.replay = { key: 'k1', approved: false };
      }),
    );
    const address = await promiseView('회원 주문', '저장된 기본 배송지가 미리 채워진다.');
    const ask = within(address).getByRole('button', { name: '자동으로 다시 돌려도 돼요' });
    expect(within(address).getByText('pnpm test order -- address', { exact: false }).closest('details')!.open).toBe(
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
    expect(
      await within(screen.getByRole('dialog')).findByRole('button', { name: '자동 다시 돌리기 끄기' }),
    ).toBeTruthy();
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
    let browse = await promiseView('상품 찾기', '품절 상품은 담을 수 없다고 표시한다.');
    expect(within(browse).getByText(/^다시 돌려 봄 · 같은 결과 · \d+월 \d+일$/)).toBeTruthy();
    browse = openPromise(backToStep(browse, '상품 찾기'), '판매 중인 상품만 가격과 함께 보인다.');
    expect(within(browse).getByText('다시 돌리는 중')).toBeTruthy();
    cleanup();
    mount(
      withBoard((board) => {
        board.states!.browse!.promises!['sold-out']!.replay = {
          approved: true,
          at: '2026-10-03T03:00:00Z',
          same: false,
          output: '1 failed',
        };
      }),
    );
    const differs = await promiseView('상품 찾기', '품절 상품은 담을 수 없다고 표시한다.');
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
    const address = await promiseView('회원 주문', '저장된 기본 배송지가 미리 채워진다.');
    expect(within(address).getByText('AI가 내가 정한 걸 바꿨어요')).toBeTruthy();
    expect(within(address).getByText('내가 쓴 문장: 배송지는 회원 정보에서 불러온다')).toBeTruthy();
    expect(within(address).getByText('다른 컴퓨터에서 정함')).toBeTruthy();
    fireEvent.click(within(address).getByRole('button', { name: '되돌리기' }));
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
    const address = await promiseView('회원 주문', '저장된 기본 배송지가 미리 채워진다.');
    fireEvent.click(within(address).getByRole('button', { name: '자동으로 다시 돌려도 돼요' }));
    expect((await within(address).findByRole('alert')).textContent).toBe(
      '다시 돌리는 명령이 바뀌었어요. 바뀐 명령을 확인해 주세요.',
    );
    expect(request.mock.calls.filter(([method]) => method === 'flow/get').length).toBeGreaterThan(1);
  });

  it('lists the changed files of a stale promise under the technical record', async () => {
    mount();
    const address = await promiseView('회원 주문', '저장된 기본 배송지가 미리 채워진다.');
    const record = within(address).getByText('기술 기록').closest('details')!;
    expect(record.open).toBe(false);
    expect(record.textContent).toContain('src/order.ts');
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
    const row = within(notices()!).getByRole('button', { name: /^지도에 아직 없는 코드 변경/ });
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
    // An entry of its own after the code changes, counting the parts.
    const buttons = within(notices()!).getAllByRole('button');
    const row = within(notices()!).getByRole('button', { name: /^아직 그리지 않은 것/ });
    expect(buttons.indexOf(row)).toBeGreaterThan(
      buttons.indexOf(within(notices()!).getByRole('button', { name: /^지도에 아직 없는 코드 변경/ })),
    );
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

  it('checks every card that needs a look from the map menu, in look-first order', async () => {
    const { request } = mount(
      withBoard((board) => {
        // A failed card whose files also changed is rechecked too; the must-have goes first.
        board.states!.cart!.changed = true;
        board.states!.cart!.status = 'recheck';
        board.document!.nodes!.find((n) => n.id === 'cart')!.priority = 'must';
      }),
    );
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
    expect(screen.getByRole('menuitemcheckbox', { name: '매일 자동으로 확인' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.queryByRole('menuitem', { name: '지도 삭제' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '바뀐 기능 1개 다시 확인' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(within(notices()!).getByRole('button', { name: /^지도에 아직 없는 코드 변경/ }));
    expect(((await screen.findByRole('button', { name: '지도 맞추기' })) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(globalThis.document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('button', { name: '지도 맞추기' })).toBeNull());
    const panel = await openStep('결제');
    expect((within(panel).getByRole('button', { name: '다시 확인' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(panel).getByLabelText('AI에게 부탁하기'), { target: { value: '고쳐 줘' } });
    expect((within(panel).getByRole('button', { name: '보내기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).queryByRole('button', { name: '이름 고치기' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: '적기' })).toBeNull();
    const coupon = openPromise(panel, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    expect((within(coupon).getByRole('button', { name: '나중에 보기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(coupon).queryByRole('button', { name: '문장 고치기' })).toBeNull();
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
    expect(await stepCard('상품 찾기')).toBeTruthy();
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
    expect(stepCards('상품 찾기')).toHaveLength(1);
    expect(client.getQueryData<{ document: unknown }>(['product-map', cwd])?.document).toBeTruthy();
  });

  it('loads check pictures when a promise opens and not before', async () => {
    const { request } = mount({
      results: { 'flow/node': { checkScreenshots: { coupon: 'data:image/png;base64,AAAA' }, observationImages: {} } },
    });
    const panel = await openStep('결제');
    expect(request.mock.calls.some(([method]) => method === 'flow/node')).toBe(false);
    const coupon = openPromise(panel, '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    await waitFor(() =>
      expect(request.mock.calls.find(([method]) => method === 'flow/node')?.[1]).toEqual({ cwd, nodeId: 'payment' }),
    );
    await waitFor(() => expect(coupon.querySelector('img[src="data:image/png;base64,AAAA"]')).toBeTruthy());
  });

  it('puts each map setting where it matters, with no settings window', async () => {
    const board = bookingBoard();
    board.include = ['apps/web'];
    board.exclude = ['**/*.lock', 'fixtures/**'];
    board.coverage = { git: true, uncovered: ['src/a.ts'], uncoveredCount: 1, outOfScope: 0, excluded: 4 };
    const { request } = mount(boardScript(board));
    await loaded();
    // The AI's exclusions sit under the changes they hide, not in the settings.
    fireEvent.click(within(notices()!).getByRole('button', { name: /^지도에 아직 없는 코드 변경/ }));
    const excluded = (await screen.findByText('제외된 변경 4개')).closest('details')!;
    expect(within(excluded).getByText('fixtures/**')).toBeTruthy();
    fireEvent.keyDown(globalThis.document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('제외된 변경 4개')).toBeNull());
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
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    const coupon = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    fireEvent.click(within(coupon).getByRole('button', { name: '안 고침' }));
    const field = within(coupon).getByLabelText('안 고치는 이유를 한 줄로 적어 주세요') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '곧 없앰' } });
    fireEvent.click(within(coupon).getByRole('button', { name: '저장' }));
    expect((await within(coupon).findAllByRole('alert')).length).toBeGreaterThan(0);
    expect((within(coupon).getByLabelText('안 고치는 이유를 한 줄로 적어 주세요') as HTMLInputElement).value).toBe(
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
    const payment = await promiseView('결제', '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.');
    await waitFor(() => expect(payment.querySelector('img[src="data:image/png;base64,PAY"]')).toBeTruthy());
    fireEvent.keyDown(globalThis.document.activeElement ?? globalThis.document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const browse = await promiseView('상품 찾기', '판매 중인 상품만 가격과 함께 보인다.');
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
  const open = async (title: string, promise: string) => {
    mount(flowScript(STUDIO_MAP));
    return promiseView(title, promise);
  };
  it('labels each observation with where Alpine got it', async () => {
    const approve = await open('카드 결제 승인', '카드 승인이 끝나면 이용권이 바로 발급된다.');
    expect(within(approve).getAllByText('Alpine이 확인함').length).toBeGreaterThan(0);
    expect(within(approve).getAllByText('해본 것', { selector: 'h4' }).length).toBeGreaterThan(0);
    expect(within(approve).getAllByText('관찰', { selector: 'h4' }).length).toBeGreaterThan(0);
    expect(within(approve).getAllByText('판단', { selector: 'h4' }).length).toBeGreaterThan(0);
    const amount = openPromise(
      backToStep(approve, '카드 결제 승인'),
      '화면에 보인 금액과 실제 승인 금액이 다르면 승인하지 않는다.',
    );
    expect(within(amount).getByText('AI 설명')).toBeTruthy();
  });
  it('puts the badge on the quoted excerpt and styles the AI words as the AI', async () => {
    const recheck = await open('결제 결과 받기', '결제 알림을 받으면 orderId로 결제를 다시 조회해');
    const excerpt = within(recheck).getByText(/webhook body status: CANCELED/);
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
  it('words the session and Alpine-record mismatch reasons plainly', () => {
    const t = messages.ko;
    expect(t.reasonOutsideSession).toBe('이 작업 중에 만든 파일이 아니에요.');
    expect(t.reasonAlpineRecord).toBe('Alpine 기록 파일을 근거로 쓸 수 없어요.');
    expect(messages.en.reasonOutsideSession).toBeTruthy();
    expect(messages.en.reasonAlpineRecord).toBeTruthy();
  });
  it('shows a mismatch with its reason and marks a check with no confirmed evidence', async () => {
    const amount = await open('카드 결제 승인', '화면에 보인 금액과 실제 승인 금액이 다르면 승인하지 않는다.');
    expect(within(amount).getAllByText('기록과 다름')).toHaveLength(1);
    expect(within(amount).getByText('기록에서 이 내용을 찾지 못했어요.')).toBeTruthy();
    // The amount check (only a mismatch and an agent note) and the older decline check rest on nothing confirmed.
    // The amount result is still shown as passed.
    expect(within(amount).getAllByText('근거 확인 안 됨').length).toBeGreaterThan(0);
    const verdict = within(amount).getByText('판단', { selector: 'h4' }).parentElement!;
    expect(within(verdict).getByText('통과')).toBeTruthy();
    const decline = openPromise(
      backToStep(amount, '카드 결제 승인'),
      '한도 초과로 거절되면 이용권은 발급되지 않고 다른 카드를 권한다.',
    );
    expect(within(decline).getAllByText('근거 확인 안 됨').length).toBeGreaterThan(0);
  });
  it('keeps what could not be checked outside the technical record', async () => {
    const partial = await open('이용권 환불', '일부 사용한 이용권은');
    const limit = within(partial).getByText('약관의 정확한 계산식은 확인하지 못했어요. 기대값은 예시 계산이에요.');
    expect(limit.closest('details')!.querySelector('summary')!.textContent).not.toContain('기술 기록');
    const expected = within(partial).getByText('180,000원 (사용분 90,000원과 위약금 30,000원을 뺀 금액)');
    expect(expected.closest('dl')!.textContent).toContain('210,000원');
    const record = within(partial).getByText('기술 기록').closest('details')!;
    expect(record.open).toBe(false);
    expect(record.textContent).toContain('call_f2');
    expect(within(partial).getAllByText(/로컬 개발 서버 · 토스 테스트 결제/).length).toBeGreaterThan(0);
  });
  it('renders captured screens inline and says so when the picture is not here', async () => {
    const full = await open('주간 시간표', '정원이 찬 수업은 대기 신청 버튼으로 바뀐다.');
    expect(
      (await within(full).findByAltText('마감된 수업 줄에 [예약] 대신 [대기 신청]이 보여요.')).getAttribute('src'),
    ).toMatch(/^data:image\/svg\+xml/);
    expect(within(full).getAllByText('Alpine이 직접 찍음').length).toBeGreaterThan(0);
    cleanup();
    const kakao = await open('카카오로 가입', '카카오로 처음 로그인하면 회원이 만들어지고 시간표로 이동한다.');
    expect(await within(kakao).findByText('다른 컴퓨터에서 찍은 화면이라 여기엔 없어요.')).toBeTruthy();
  });
  it('keeps the two-tier view for older checks and labels them as unconfirmed evidence', async () => {
    const code = await open('휴대폰 인증', '인증번호를 맞게 입력하면 휴대폰 번호가 확인된다.');
    expect(within(code).queryByText('관찰', { selector: 'h4' })).toBeNull();
    expect(within(code).getAllByText('근거 확인 안 됨').length).toBeGreaterThan(0);
    expect(within(code).getByText('맞는 인증번호로 확인을 요청하자 휴대폰 번호가 확인됨으로 바뀌었어요.')).toBeTruthy();
    expect(within(code).getByText('기술 기록').closest('details')!.textContent).toContain('pnpm test phone');
  });
  it('shows the corrected webhook promises', async () => {
    mount(flowScript(STUDIO_MAP));
    const hook = await openStep('결제 결과 받기');
    expect(
      within(hook).getByText('결제 알림을 받으면 orderId로 결제를 다시 조회해 확인된 상태만 반영한다.'),
    ).toBeTruthy();
    expect(within(hook).getByText('결제 알림에 10초 안에 응답한다.')).toBeTruthy();
    expect(within(hook).queryByText(/서명/)).toBeNull();
  });
});

describe('discovery and map settings', () => {
  it('shows the started work in the dock, with no status strip or conversation panel on the map', async () => {
    const { onShowConversation, onSession } = mount();
    const panel = await openStep('회원 주문');
    fireEvent.click(within(panel).getByRole('button', { name: '다시 확인' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
    expect(onShowConversation).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '작업 내용', hidden: true })).toBeNull();
    expect(screen.queryByText(/에이전트 작업이 끝났어요/)).toBeNull();
  });
  it('deletes the map from its settings after one confirmation', async () => {
    const { request } = mount();
    fireEvent.click(await menuItem('지도 삭제'));
    expect(request.mock.calls.some(([method]) => method === 'flow/delete')).toBe(false);
    const strip = await screen.findByRole('region', { name: '지도 삭제' });
    expect(within(strip).getByText(/되돌릴 수 없어요/)).toBeTruthy();
    fireEvent.click(within(strip).getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(request.mock.calls.find(([method]) => method === 'flow/delete')?.[1]).toEqual({ cwd }));
    expect(await screen.findByRole('button', { name: '지도 그리기' })).toBeTruthy();
  });

  it('shows the scope before the map is made', async () => {
    const { request } = mount({
      results: { 'flow/get': { document: { flows: [], nodes: [], edges: [] }, revision: 'missing', include: [] } },
    });
    fireEvent.click(await screen.findByText('살펴볼 폴더 고르기'));
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
    const address = await promiseView('회원 주문', '저장된 기본 배송지가 미리 채워진다.');
    fireEvent.click(within(address).getByRole('button', { name: '문장 고치기' }));
    const field = within(address).getByRole('textbox', { name: '문장 고치기' });
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
    const mine = screen.getByRole('dialog');
    expect(await within(mine).findByText('배송지는 매번 새로 입력한다.')).toBeTruthy();
    expect(within(mine).getByText('내가 정함')).toBeTruthy();
    expect(within(mine).getByRole('button', { name: 'AI에게 확인 맡기기' })).toBeTruthy();
    // Nothing ran on save; the notice row gathers edited promises into one check.
    expect(request.mock.calls.some(([method]) => method === 'flow/prepare')).toBe(false);
    fireEvent.keyDown(globalThis.document.activeElement ?? globalThis.document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const edited = within(notices()!).getByText('고친 약속 1개').closest('li')!;
    fireEvent.click(within(edited).getByRole('button', { name: '확인하기' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', nodeIds: ['member'] }));
  });

  it("adds a promise in the user's words, and cancels an add", async () => {
    const { request } = mount();
    const panel = await openStep('회원 주문');
    fireEvent.click(within(panel).getByRole('button', { name: '약속 추가' }));
    fireEvent.change(within(panel).getByLabelText(/^이럴 때/), { target: { value: '버릴 문장' } });
    fireEvent.click(within(panel).getByRole('button', { name: '취소' }));
    expect(within(panel).queryByLabelText(/^이럴 때/)).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: '약속 추가' }));
    fireEvent.change(within(panel).getByLabelText(/^이럴 때/), { target: { value: '비회원이면' } });
    fireEvent.change(within(panel).getByLabelText(/^이렇게 돼야 해요/), {
      target: { value: '주문 내역을 조회할 수 있다.' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: '추가' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/edit', {
        cwd,
        nodeId: 'member',
        field: 'promise',
        conditionId: null,
        value: '비회원이면, 주문 내역을 조회할 수 있다.',
      }),
    );
  });

  it('writes the title and "직접 해 보려면" in place', async () => {
    const { request } = mount();
    const panel = await openStep('회원 주문');
    fireEvent.click(within(panel).getByRole('button', { name: '적기' }));
    const field = within(panel).getByRole('textbox', { name: '직접 해 보려면' });
    fireEvent.change(field, { target: { value: '테스트 회원 계정으로 로그인' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await within(screen.getByRole('dialog')).findByText('테스트 회원 계정으로 로그인')).toBeTruthy();
    const step = screen.getByRole('dialog');
    fireEvent.click(within(step).getByRole('button', { name: '이름 고치기' }));
    const title = within(step).getByRole('textbox', { name: '이름 고치기' });
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
    await loaded();
    fireEvent.click(within(notices()!).getByRole('button', { name: /^AI가 지운 카드 1개/ }));
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

  it('lists promises of mine the AI removed in the step panel, to keep or put back', async () => {
    const { request } = mount(
      withBoard((board) => {
        board.states!.member!.removedPromises = [{ id: 'gift', text: '선물 포장을 고를 수 있다.' }];
      }),
    );
    const panel = await openStep('회원 주문');
    expect(within(panel).getByText('AI가 내가 정한 약속을 지웠어요')).toBeTruthy();
    expect(within(panel).getByText('내가 쓴 문장: 선물 포장을 고를 수 있다.')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: '되돌리기' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('flow/review', {
        cwd,
        target: 'promise',
        action: 'restore',
        nodeId: 'member',
        conditionId: 'gift',
      }),
    );
  });

  it('says a promise without any check was guessed from the code and not checked yet', async () => {
    mount(
      withBoard((board) => {
        const node = board.document!.nodes!.find((n) => n.id === 'member')!;
        node.checks = [];
        board.states!.member!.promises!.address = { status: 'unconfirmed', origin: 'inferred' };
      }),
    );
    const address = await promiseView('회원 주문', '저장된 기본 배송지가 미리 채워진다.');
    expect(within(address).getByText('AI 추정')).toBeTruthy();
    expect(within(address).getByText('아직 확인한 적이 없어요.')).toBeTruthy();
  });
});

describe('flows that call another flow (decision 19)', () => {
  it('draws the called flow as one card that leads to that flow', async () => {
    let calledTitle = '';
    mount(
      withBoard((board) => {
        const [first, second] = board.document!.flows!;
        calledTitle = second!.title;
        first!.nodeIds = [`flow:${second!.id}`, ...first!.nodeIds!];
      }),
    );
    await loaded();
    const link = screen.getByRole('button', { name: new RegExp(`^이 여정을 거쳐요${calledTitle}`) });
    fireEvent.click(link);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).getByRole('heading', { name: calledTitle })).toBeTruthy();
  });
});

describe('person-first view', () => {
  /** The map opens alone; the summary beside it lists the people, and picking one opens them over the map. */
  async function openFirstPerson() {
    fireEvent.click(await screen.findByRole('button', { name: '요약' }));
    const summary = screen.getByRole('complementary');
    fireEvent.click(within(summary).getAllByRole('button')[0]!);
    return screen.findByRole('dialog');
  }

  it('asking the AI to check sends one verify for the unchecked steps and opens its session', async () => {
    const { request, onSession } = mount();
    const panel = await openFirstPerson();
    fireEvent.click(await within(panel).findByRole('button', { name: 'AI에게 확인 맡기기' }));
    await waitFor(() => expect(lastPrepare(request)).toMatchObject({ action: 'verify', cwd }));
    expect((lastPrepare(request) as { nodeIds: string[] }).nodeIds.length).toBeGreaterThan(0);
    await waitFor(() => expect(onSession).toHaveBeenCalledWith('new-session'));
  });

  it('grouping journeys under who walks them writes their actor, and the band takes that name', async () => {
    const { request } = mount();
    const panel = await openFirstPerson();
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
    expect(await screen.findByRole('heading', { name: '회원', hidden: true })).toBeTruthy();
  });
});
