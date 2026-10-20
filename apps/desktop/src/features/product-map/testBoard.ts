import type { FlowCheck, FlowGetResult, FlowNode, FlowPromiseParams, NodeState, PromiseState } from '@alpine/protocol';

import { ServerError, type Script } from '@/shared/server';

/** Test-only map of a small shop, in the shape the server sends, so these tests do not depend on the demo data. */

const STAMP = { at: '2026-10-02T03:00:00Z', witness: 'mine' as const };

const passed = (conditionId: string, expectation: string, extra: Partial<FlowCheck> = {}): FlowCheck => ({
  id: `check-${conditionId}`,
  conditionId,
  expectation,
  summary: '예제 실행 기록',
  command: `pnpm test ${conditionId}`,
  result: 'passed',
  output: '1 passed',
  dependsOn: ['src/example.ts'],
  ...extra,
});

const ok = (extra: Partial<PromiseState> = {}): PromiseState => ({
  status: 'passed',
  issue: '',
  origin: 'confirmed',
  stamp: STAMP,
  ...extra,
});

export const ORDER_FLOW = {
  id: 'order',
  title: '상품을 고르고 주문하기',
  description: '손님이 상품을 고르면, 회원이든 비회원이든 결제까지 마칠 수 있어야 한다.',
  trigger: '손님이 가게 앱을 연다',
  nodeIds: ['browse', 'cart', 'member', 'guest', 'payment'],
};
export const SDK_FLOW = {
  id: 'sdk',
  title: '다른 서비스에서 주문 만들기',
  description: '다른 서비스가 주문을 보내면, 결제 결과와 영수증 주소를 받을 수 있어야 한다.',
  trigger: '다른 서비스가 주문을 보낸다',
  nodeIds: ['sdk-call', 'payment', 'receipt'],
};

const nodes: FlowNode[] = [
  {
    id: 'browse',
    title: '상품 찾기',
    kind: 'screen',
    phase: 'built',
    tags: ['상품 탐색'],
    description: '상품 목록에서 원하는 상품을 고릅니다.',
    example: '오늘의 빵\n소금빵 3,000원',
    sources: ['src/products.tsx'],
    conditions: [
      { id: 'list', expectation: '판매 중인 상품만 가격과 함께 보인다.' },
      { id: 'sold-out', expectation: '품절 상품은 담을 수 없다고 표시한다.' },
    ],
    checks: [
      passed('list', '판매 중인 상품만 가격과 함께 보인다.'),
      passed('sold-out', '품절 상품은 담을 수 없다고 표시한다.', {
        replay: { command: 'pnpm test products -- sold-out', cwd: '' },
      }),
    ],
  },
  {
    id: 'cart',
    title: '장바구니',
    kind: 'screen',
    phase: 'built',
    tags: ['상품 탐색'],
    description: '수량을 바꾸고 주문을 시작합니다.',
    conditions: [
      { id: 'total', expectation: '수량을 바꾸면 합계가 바로 바뀐다.' },
      { id: 'empty', expectation: '비어 있으면 주문하기를 누를 수 없다.' },
    ],
    checks: [passed('total', '수량을 바꾸면 합계가 바로 바뀐다.')],
  },
  {
    id: 'member',
    title: '회원 주문',
    kind: 'process',
    phase: 'built',
    tags: ['주문'],
    description: '저장된 배송지를 사용합니다.',
    conditions: [{ id: 'address', expectation: '저장된 기본 배송지가 미리 채워진다.' }],
    checks: [
      passed('address', '저장된 기본 배송지가 미리 채워진다.', {
        replay: { command: 'pnpm test order -- address', cwd: '' },
      }),
    ],
  },
  {
    id: 'guest',
    title: '비회원 주문',
    kind: 'screen',
    phase: 'building',
    tags: ['주문'],
    description: '가입 없이 배송지를 입력하고 주문합니다.',
  },
  {
    id: 'payment',
    title: '결제',
    kind: 'api',
    phase: 'built',
    tags: ['결제'],
    description: '주문 금액을 결제합니다.',
    example: 'POST /payments\n{ orderId, amount, coupon }',
    conditions: [
      { id: 'normal', expectation: '쿠폰이 없으면 주문 금액 그대로 결제한다.' },
      { id: 'coupon', expectation: '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.' },
      { id: 'expired', expectation: '만료된 쿠폰은 거절하고 원래 금액을 유지한다.' },
      { id: 'retry', expectation: '결제를 다시 요청해도 중복 청구하지 않는다.' },
    ],
    checks: [
      passed('normal', '쿠폰이 없으면 주문 금액 그대로 결제한다.'),
      passed('expired', '만료된 쿠폰은 거절하고 원래 금액을 유지한다.'),
      passed('retry', '결제를 다시 요청해도 중복 청구하지 않는다.'),
      {
        id: 'check-coupon',
        conditionId: 'coupon',
        expectation: '10% 쿠폰을 적용하면 할인된 금액으로 결제한다.',
        summary: '10% 쿠폰 주문',
        plain: '쿠폰을 적용하면 결제 금액이 갱신되지 않아요.',
        command: 'pnpm test coupon',
        result: 'failed',
        output: 'Expected 8100, received 9000',
        dependsOn: ['src/payments.ts'],
      },
    ],
  },
  {
    id: 'sdk-call',
    title: '주문 요청',
    kind: 'sdk',
    phase: 'built',
    tags: ['다른 서비스 연동'],
    description: '다른 서비스에서 주문을 만듭니다.',
  },
  {
    id: 'receipt',
    title: '주문 결과 받기',
    kind: 'data',
    phase: 'planned',
    tags: ['다른 서비스 연동'],
    description: '주문 번호와 영수증 주소를 반환합니다.',
  },
];

const states: Record<string, NodeState> = {
  browse: {
    status: 'passed',
    passed: 2,
    total: 2,
    promises: { list: ok(), 'sold-out': ok({ origin: 'plan', stamp: { ...STAMP, witness: 'other' } }) },
  },
  cart: {
    status: 'unconfirmed',
    passed: 1,
    total: 2,
    promises: {
      total: ok({ origin: 'inferred', stamp: { ...STAMP, firstSeen: true } }),
      empty: { status: 'unconfirmed', issue: '', origin: 'inferred' },
    },
  },
  member: {
    status: 'recheck',
    passed: 0,
    total: 1,
    changed: true,
    promises: {
      address: {
        status: 'recheck',
        issue: '',
        origin: 'inferred',
        stamp: STAMP,
        changed: ['src/order.ts'],
      },
    },
  },
  guest: { status: 'none' },
  payment: {
    status: 'failed',
    passed: 3,
    total: 4,
    promises: {
      normal: ok(),
      coupon: {
        status: 'failed',
        issue: 'open',
        origin: 'confirmed',
        since: '2026-10-01T03:00:00Z',
        stamp: STAMP,
      },
      expired: ok(),
      retry: ok(),
    },
  },
  'sdk-call': { status: 'none' },
  receipt: { status: 'none' },
};

/** A fresh copy of the shop map as the server would return it. */
export function bookingBoard(): FlowGetResult {
  return structuredClone({
    revision: 'rev-0',
    etag: 'etag-0',
    exists: true,
    document: {
      flows: [ORDER_FLOW, SDK_FLOW],
      nodes,
      edges: [
        { source: 'browse', target: 'cart' },
        { source: 'cart', target: 'member', label: '로그인됨' },
        { source: 'cart', target: 'guest', label: '비회원' },
        { source: 'member', target: 'payment' },
        { source: 'guest', target: 'payment' },
        { source: 'sdk-call', target: 'payment' },
        { source: 'payment', target: 'receipt' },
      ],
    },
    states,
    coverage: { git: true, uncovered: [], uncoveredCount: 0, outOfScope: 0, excluded: 0 },
    include: [],
    exclude: [],
    problems: [],
    schedule: { enabled: false, limit: 20, lastRun: null },
    changes: [],
    previews: {},
    provenance: {},
  });
}

/** Changes the shop map in place for one test, then freezes it as the answer to flow/get. */
export function withBoard(change: (board: FlowGetResult) => void): Script {
  const board = bookingBoard();
  change(board);
  return { results: { 'flow/get': board } };
}

/** Like `withBoard`, but the server keeps answering and changing this board, so the user's actions show. */
export function seeded(change: (board: FlowGetResult) => void): Script {
  const board = bookingBoard();
  change(board);
  return boardScript(board);
}

/**
 * A server for the shop map that keeps its own copy: it answers flow/get with `unchanged` when the app already has
 * the current etag, and applies the user's decisions the way the real one does.
 */
export function boardScript(initial: FlowGetResult = bookingBoard()): Script {
  let board = initial;
  let serial = 0;
  const bump = (next: FlowGetResult) => {
    board = { ...next, revision: `rev-${++serial}`, etag: `etag-${serial}` };
    return board;
  };
  const promise = (params: FlowPromiseParams) => {
    const next = structuredClone(board);
    const state = next.states?.[params.nodeId]?.promises?.[params.conditionId];
    if (!state) throw new ServerError(-32000, 'Unknown promise', { reason: 'invalid_flow' });
    if (params.action === 'confirm') {
      state.origin = 'confirmed';
      if (state.issue === 'question') {
        state.issue = 'open';
        next.states![params.nodeId]!.status = 'failed';
      }
    } else if (params.action === 'unconfirm') state.origin = 'inferred';
    else if (params.action === 'later') state.issue = 'later';
    else if (params.action === 'wontfix') {
      state.issue = 'wontfix';
      state.reason = params.reason ?? '';
    } else if (params.action === 'reopen') state.issue = 'open';
    else
      state.replay = {
        ...(state.replay ?? {}),
        approved: params.action === 'approve_replay',
      };
    return bump(next);
  };
  return {
    results: {
      'flow/get': (params) =>
        params.since && params.since === board.etag
          ? { revision: board.revision, etag: board.etag, unchanged: true }
          : board,
      'flow/node': () => ({ checkScreenshots: {}, observationImages: {} }),
      'flow/set': (params) => {
        const next = structuredClone(board);
        const node = next.document?.nodes?.find((n) => n.id === params.nodeId);
        if (!node) throw new ServerError(-32000, 'Unknown map node', { reason: 'invalid_flow' });
        if (params.field === 'decision') node.decision = params.value ?? '';
        else if (params.field === 'priority') node.priority = params.value as FlowNode['priority'];
        else node.scope = params.value as FlowNode['scope'];
        return bump(next);
      },
      'flow/actor': (params) => {
        const next = structuredClone(board);
        for (const flow of next.document?.flows ?? [])
          if (params.flowIds.includes(flow.id)) flow.actor = params.actor?.trim() ?? '';
        return bump(next);
      },
      'flow/promise': promise,
      'flow/edit': (params) => {
        const next = structuredClone(board);
        const node = next.document?.nodes?.find((n) => n.id === params.nodeId);
        if (!node) throw new ServerError(-32000, 'Unknown map node', { reason: 'invalid_flow' });
        if (params.field === 'title') node.title = params.value ?? '';
        else if (params.field === 'how_to_try') node.howToTry = params.value ?? '';
        else {
          const id = params.conditionId ?? `user-${++serial}`;
          const condition = node.conditions?.find((c) => c.id === id);
          if (condition) condition.expectation = params.value ?? '';
          else node.conditions = [...(node.conditions ?? []), { id, expectation: params.value ?? '' }];
          const promises = (next.states![node.id]!.promises ??= {});
          const had = !!node.checks?.some((c) => c.conditionId === id);
          promises[id] = {
            ...promises[id],
            status: had ? 'recheck' : 'unconfirmed',
            origin: 'confirmed',
            written: true,
          };
        }
        return bump(next);
      },
      'flow/review': (params) => {
        const next = structuredClone(board);
        if (params.target === 'map') next.review = null;
        else if (params.target === 'card') next.removedCards = next.removedCards?.filter((c) => c.id !== params.nodeId);
        return bump(next);
      },
      'flow/delete': () => bump({ revision: 'missing', exists: false, include: board.include ?? [] }),
      'flow/scope': (params) => bump({ ...structuredClone(board), include: params.include ?? [] }),
      'flow/schedule': (params) =>
        bump({
          ...structuredClone(board),
          schedule: {
            enabled: params.enabled,
            limit: params.limit ?? board.schedule?.limit ?? 20,
            lastRun: params.ran ? new Date().toISOString() : (board.schedule?.lastRun ?? null),
          },
        }),
      'flow/prepare': (params) => {
        if (params.revision !== board.revision)
          throw new ServerError(-32000, 'The map changed.', { reason: 'flow_conflict' });
        const next = structuredClone(board);
        let nodeId = params.nodeId ?? null;
        if (params.action === 'extend') {
          nodeId = `branch-${++serial}`;
          const from = next.document?.nodes?.find((n) => n.id === params.nodeId);
          next.document!.nodes!.push({
            id: nodeId,
            title: params.request ?? '',
            phase: 'planned',
            kind: 'process',
            tags: from?.tags,
            sessionId: params.sessionId,
          });
          const flow = next.document!.flows!.find((f) => f.id === params.flowId);
          flow?.nodeIds?.push(nodeId);
          next.states![nodeId] = { status: 'none' };
        } else if (nodeId) {
          const node = next.document?.nodes?.find((n) => n.id === nodeId);
          if (node) node.sessionId = params.sessionId;
        }
        return { board: bump(next), nodeId, prompt: `[map] ${params.action}: ${params.request ?? ''}` };
      },
    },
  };
}
