import type { FlowNode, NodeState, ProductMap } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { sessionInfo, STUDIO_MAP } from '@/shared/server';

import { focusItems } from './Focus';

import {
  allTags,
  CARD_HEIGHT,
  CARD_WIDTH,
  captureState,
  conditionResults,
  isWorking,
  issueCounts,
  layoutFlow,
  matchingIds,
  numbers,
  searchOrder,
  summary,
  verification,
} from './model';

const nodes: FlowNode[] = ['start', 'member', 'guest', 'pay'].map((id) => ({ id, title: id, phase: 'built' }));
const flow = { id: 'order', title: 'Order', nodeIds: nodes.map((n) => n.id) };
const document: ProductMap = {
  nodes,
  flows: [flow],
  edges: [
    { source: 'start', target: 'member' },
    { source: 'start', target: 'guest' },
    { source: 'member', target: 'pay' },
    { source: 'guest', target: 'pay' },
  ],
};

describe('product layout', () => {
  it('keeps alternate branches distinct and merges them before the next step', () => {
    const layout = layoutFlow(flow, document);
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.node.id, n]));
    expect(byId.member!.x).toBe(byId.guest!.x);
    expect(byId.member!.y).not.toBe(byId.guest!.y);
    expect(byId.pay!.x).toBeGreaterThan(byId.guest!.x + CARD_WIDTH);
    for (const a of layout.nodes)
      for (const b of layout.nodes) {
        if (a === b) continue;
        expect(Math.abs(a.x - b.x) >= CARD_WIDTH || Math.abs(a.y - b.y) >= CARD_HEIGHT).toBe(true);
      }
  });
  it('handles cycles, self-loops, disconnected nodes and dangling external edges without hanging', () => {
    const result = layoutFlow(flow, {
      ...document,
      edges: [
        ...document.edges!,
        { source: 'pay', target: 'start' },
        { source: 'pay', target: 'pay' },
        { source: 'outside', target: 'start' },
      ],
    });
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(6);
    expect(result.edges.every((e) => !e.path.includes('NaN'))).toBe(true);
    expect(layoutFlow(flow, { ...document, edges: [] }).nodes).toHaveLength(4);
  });
  it('is stable across polling of equivalent data', () => {
    expect(layoutFlow(flow, document)).toEqual(layoutFlow(structuredClone(flow), structuredClone(document)));
  });
});

it('never equates a finished conversation or a build with a passed feature', () => {
  const node: FlowNode = { id: 'n', title: 'Feature', phase: 'built', sessionId: 's' };
  expect(verification(node).status).toBe('none');
  expect(isWorking(node, [sessionInfo({ id: 's', status: 'idle' })])).toBe(false);
  expect(isWorking(node, [sessionInfo({ id: 's', status: 'running' })])).toBe(true);
  // Without what the server computed, a feature with promises is simply not confirmed.
  const promised: FlowNode = { ...node, conditions: [{ id: 'a', expectation: 'Works' }] };
  expect(verification(promised).status).toBe('unconfirmed');
});

it('takes the status, the counts and every promise state from the server, never from the check itself', () => {
  const node: FlowNode = {
    id: 'n',
    title: 'Feature',
    conditions: [{ id: 'a', expectation: 'Works' }],
    checks: [{ conditionId: 'a', summary: '', command: 't', output: '', result: 'passed' }],
  };
  const state: NodeState = {
    status: 'question',
    passed: 0,
    total: 1,
    promises: { a: { status: 'failed', issue: 'question', origin: 'inferred' } },
  };
  expect(verification(node, state)).toEqual({ status: 'question', passed: 0, total: 1 });
  expect(conditionResults(node, state)[0]).toMatchObject({ status: 'failed', promise: { issue: 'question' } });
});

it('counts a feature shared by several flows once', () => {
  const map: ProductMap = {
    nodes: [
      { id: 'cart', title: 'Cart' },
      { id: 'loose', title: 'Loose' },
      { id: 'pay', title: 'Pay' },
    ],
    flows: [
      { id: 'web', title: 'Web', nodeIds: ['cart', 'pay'] },
      { id: 'sdk', title: 'SDK', nodeIds: ['pay'] },
    ],
  };
  const totals = summary(map, { pay: { status: 'failed' } }, []);
  expect(totals.features).toBe(3);
  expect(totals.counts).toMatchObject({ failed: 1, none: 2 });
});

it('numbers cards in canvas order: flow by flow, each card where it first appears, then cards in no flow', () => {
  const map: ProductMap = {
    nodes: ['loose', 'pay', 'cart', 'receipt', 'call'].map((id) => ({ id, title: id })),
    flows: [
      { id: 'web', title: 'Web', nodeIds: ['cart', 'pay'] },
      // A shared card keeps its first number; an id with no card gets none.
      { id: 'sdk', title: 'SDK', nodeIds: ['call', 'pay', 'ghost', 'receipt'] },
    ],
  };
  expect(Object.fromEntries(numbers(map))).toEqual({ cart: '1', pay: '2', call: '3', receipt: '4', loose: '5' });
  expect([...numbers(map).keys()]).toEqual(['cart', 'pay', 'call', 'receipt', 'loose']);
  expect(numbers({ nodes: [{ id: 'a', title: 'A' }] })).toEqual(new Map([['a', '1']]));
  expect(numbers({})).toEqual(new Map());
});

it('lists every tag with how many cards use it, most used first', () => {
  const map: ProductMap = {
    nodes: [
      { id: 'a', title: 'A', tags: ['주문', '결제'] },
      { id: 'b', title: 'B', tags: ['결제'] },
      { id: 'c', title: 'C' },
      { id: 'd', title: 'D', tags: ['결제', '회원'] },
    ],
  };
  expect(allTags(map)).toEqual([
    { tag: '결제', count: 3 },
    { tag: '주문', count: 1 },
    { tag: '회원', count: 1 },
  ]);
  expect(allTags({})).toEqual([]);
});

it('starts every flow from its trigger into the steps nothing earlier leads to', () => {
  const layout = layoutFlow(flow, document);
  expect(layout.entries).toHaveLength(1);
  expect(layoutFlow(flow, { ...document, edges: [] }).entries).toHaveLength(4);
});

it('reads each promise from the server state and the check written for it', () => {
  const node: FlowNode = {
    id: 'sdk',
    title: 'Upload',
    conditions: [
      { id: 'ok', expectation: 'Returns an ID' },
      { id: 'cancel', expectation: 'Stops transmission' },
      { id: 'offline', expectation: 'Reports offline' },
    ],
    checks: [
      { id: 'one', conditionId: 'ok', summary: '', command: 'test', output: '', result: 'failed' },
      { id: 'two', conditionId: 'ok', summary: '', command: 'test', output: '', result: 'passed' },
      { conditionId: 'offline', summary: '', command: 'test', output: '', result: 'blocked' },
      { summary: 'build', command: 'build', output: '', result: 'passed' },
    ],
  };
  const state: NodeState = {
    status: 'unconfirmed',
    promises: {
      ok: { status: 'passed' },
      offline: { status: 'blocked' },
    },
  };
  const results = conditionResults(node, state);
  expect(results.map((item) => item.status)).toEqual(['passed', 'unconfirmed', 'blocked']);
  // The newest check written for a promise is the one shown; one with no promise is never a promise.
  expect(results[0]!.check?.id).toBe('two');
  expect(results[1]!.check).toBeUndefined();
  expect(
    conditionResults({ id: 'legacy', title: 'Legacy', checks: node.checks?.filter((c) => !c.conditionId) }),
  ).toEqual([]);
});

it('keeps the realistic example map internally consistent', () => {
  const ids = new Set(STUDIO_MAP.nodes!.map((n) => n.id));
  expect(ids.size).toBe(STUDIO_MAP.nodes!.length);
  expect(STUDIO_MAP.flows!.every((f) => f.nodeIds!.every((id) => ids.has(id)))).toBe(true);
  expect(STUDIO_MAP.edges!.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  expect(new Set(STUDIO_MAP.edges!.map((e) => `${e.source}>${e.target}`)).size).toBe(STUDIO_MAP.edges!.length);
  expect(STUDIO_MAP.nodes!.every((n) => (n.tags ?? []).every((tag) => tag.trim() !== ''))).toBe(true);
});

it('breaks a loop at the edge that returns, keeping the loop after its entry', () => {
  const loop: ProductMap = {
    nodes: ['detail', 'book', 'wait', 'notify'].map((id) => ({ id, title: id })),
    edges: [
      { source: 'detail', target: 'book' },
      { source: 'book', target: 'wait' },
      { source: 'wait', target: 'notify' },
      { source: 'notify', target: 'book' },
    ],
  };
  const layout = layoutFlow({ id: 'f', title: 'F', nodeIds: ['detail', 'book', 'wait', 'notify'] }, loop);
  const x = Object.fromEntries(layout.nodes.map((n) => [n.node.id, n.x]));
  expect(x.detail! < x.book! && x.book! < x.wait! && x.wait! < x.notify!).toBe(true);
  expect(layout.entries).toHaveLength(1);
});

it('keeps edge labels clear of cards and of each other', () => {
  const flow = { id: 'f', title: 'F', nodeIds: ['a', 'b', 'c'] };
  const node = (id: string) => ({ id, title: id, kind: 'screen' as const });
  const document = {
    ...STUDIO_MAP,
    nodes: [node('a'), node('b'), node('c')],
    edges: [
      { source: 'a', target: 'b', label: '결제를 완료하면' },
      { source: 'a', target: 'c', label: '결제를 완료하지 않으면' },
    ],
  };
  const layout = layoutFlow(flow, document);
  const boxes = layout.edges.map((e) => ({ x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h }));
  const hit = (a: (typeof boxes)[number], b: (typeof boxes)[number]) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  expect(hit(boxes[0]!, boxes[1]!)).toBe(false);
  for (const box of boxes)
    for (const n of layout.nodes) expect(hit(box, { x: n.x, y: n.y, w: CARD_WIDTH, h: CARD_HEIGHT })).toBe(false);
});

it('matches by every active filter without ever dropping a feature, and orders results flow by flow', () => {
  const map: ProductMap = {
    nodes: [
      { id: 'x', title: '로그인', tags: ['회원'], priority: 'must' },
      { id: 'y', title: '로그아웃' },
      { id: 'z', title: '결제', tags: ['회원', '주문'], description: '로그인한 사람만' },
    ],
    flows: [
      { id: 'one', title: 'One', nodeIds: ['z', 'x'] },
      { id: 'two', title: 'Two', nodeIds: ['x'] },
    ],
    edges: [],
  };
  const none = { query: '', status: null, mustOnly: false, nowOnly: false, tag: null };
  expect(matchingIds(map, {}, none)).toBeNull();
  expect([...matchingIds(map, {}, { ...none, query: ' 로그인 ' })!]).toEqual(['x', 'z']);
  expect([...matchingIds(map, {}, { ...none, query: '로그', mustOnly: true })!]).toEqual(['x']);
  expect([...matchingIds(map, {}, { ...none, tag: '회원' })!]).toEqual(['x', 'z']);
  expect([...matchingIds(map, {}, { ...none, tag: '주문' })!]).toEqual(['z']);
  expect([...matchingIds(map, {}, { ...none, tag: '없는 태그' })!]).toEqual([]);
  expect([...matchingIds(map, {}, { ...none, tag: '회원', mustOnly: true })!]).toEqual(['x']);
  // Search finds a card by its tags too.
  expect([...matchingIds(map, {}, { ...none, query: '주문' })!]).toEqual(['z']);
  // Flow order first, a shared feature once (in its first flow), features in no flow last.
  expect(searchOrder(map, new Set(['x', 'y', 'z']))).toEqual([
    { nodeId: 'z', flowId: 'one' },
    { nodeId: 'x', flowId: 'one' },
    { nodeId: 'y', flowId: '__unassigned' },
  ]);
});

it('orders what to look at: broke again, failed must-haves, failed, rules to confirm, then outdated ones', () => {
  const node = (id: string, extra: Partial<FlowNode> = {}): FlowNode => ({ id, title: id, phase: 'built', ...extra });
  const document: ProductMap = {
    nodes: [
      node('calm'),
      node('bare'),
      node('stale'),
      node('stale-must', { priority: 'must' }),
      node('guess'),
      node('failed'),
      node('failed-must', { priority: 'must' }),
      node('again'),
      node('unchecked-must', { priority: 'must' }),
    ],
  };
  const states: Record<string, NodeState> = {
    calm: { status: 'passed' },
    stale: { status: 'recheck' },
    'stale-must': { status: 'recheck' },
    guess: { status: 'question' },
    failed: { status: 'failed' },
    'failed-must': { status: 'failed' },
    again: { status: 'failed', promises: { p: { status: 'failed', issue: 'regressed' } } },
    'unchecked-must': { status: 'unconfirmed' },
  };
  expect(focusItems({ revision: 'r', document, states }).map((item) => `${item.nodeId}:${item.kind}`)).toEqual([
    'again:regressed',
    'failed-must:failed',
    'failed:failed',
    'guess:question',
    'stale-must:recheck',
    'stale:recheck',
    'unchecked-must:must',
    'bare:noPromises',
  ]);
});

it('counts problems by kind over every promise, and tells an old capture from a stale one', () => {
  expect(
    issueCounts({
      a: {
        status: 'failed',
        promises: { x: { status: 'failed', issue: 'open' }, y: { status: 'failed', issue: 'later' } },
      },
      b: {
        status: 'failed',
        promises: { z: { status: 'failed', issue: 'open' }, w: { status: 'passed', issue: 'resolved' } },
      },
    }),
  ).toEqual({ open: 2, regressed: 0, maybe_fixed: 0, later: 1, question: 0 });
  const day = 86_400_000;
  const now = Date.parse('2026-10-20T00:00:00Z');
  const node: FlowNode = { id: 's', title: 'S', previewAt: '2026-10-18T00:00:00Z' };
  expect(captureState(node, now)).toEqual({ days: 2, old: false });
  expect(captureState(node, now, Date.parse('2026-10-19T00:00:00Z'))?.old).toBe(true);
  expect(captureState({ ...node, previewAt: new Date(now - 20 * day).toISOString() }, now)?.old).toBe(true);
});

it("draws a flow with its own transitions, not another flow's", () => {
  const nodes = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ];
  const own = { id: 'desk', title: 'Desk', nodeIds: ['a', 'b'], edges: [{ source: 'a', target: 'b', label: 'click' }] };
  const merged = [
    { source: 'a', target: 'b', label: '/pay' },
    { source: 'b', target: 'a', label: '/back' },
  ];
  const layout = layoutFlow(own, { nodes, flows: [own], edges: merged });
  expect(layout.edges.map((e) => e.label)).toEqual(['click']);
});

it('lays out a step that calls another flow, and ignores calls to itself or to unknown flows', () => {
  const nodes = [
    { id: 'gpt', title: 'ChatGPT' },
    { id: 'ask', title: 'Ask' },
  ];
  const connect = { id: 'connect', title: 'Connect a model', nodeIds: ['gpt'] };
  const work = {
    id: 'work',
    title: 'Work',
    nodeIds: ['flow:connect', 'ask', 'flow:work', 'flow:nope'],
    edges: [{ source: 'flow:connect', target: 'ask' }],
  };
  const layout = layoutFlow(work, { nodes, flows: [connect, work] });
  expect(layout.nodes.map((n) => [n.node.id, n.node.call?.id ?? null])).toEqual([
    ['flow:connect', 'connect'],
    ['ask', null],
  ]);
  expect(layout.edges).toHaveLength(1);
});

/** The desktop flow alpine-code's map drew on 2026-10-15: 12 steps, 20 lines, 9 of them going back. */
const BUSY = {
  nodes: [
    'open-project',
    'clone-project',
    'request-work',
    'approve-action',
    'stop-work',
    'work-results',
    'conversation-usage',
    'resume-conversation',
    'delete-conversation',
    'archive-project',
    'remove-project',
  ],
  edges: [
    { source: 'open-project', target: 'request-work', label: '선택한 폴더에서 요청' },
    { source: 'clone-project', target: 'request-work', label: '복제된 폴더에서 요청' },
    { source: 'request-work', target: 'clone-project', label: '새 대화 프로젝트 메뉴에서 복제' },
    { source: 'request-work', target: 'flow:connect-model', label: '연결이 없으면 첫 요청에서 안내' },
    { source: 'flow:connect-model', target: 'request-work', label: '연결 후 요청' },
    { source: 'request-work', target: 'approve-action', label: '허용이 필요한 호출' },
    { source: 'approve-action', target: 'request-work', label: '허용 또는 건너뛰고 계속' },
    { source: 'request-work', target: 'stop-work', label: '실행 중 중지' },
    { source: 'approve-action', target: 'stop-work', label: '승인 대기 중 중지' },
    { source: 'stop-work', target: 'request-work', label: '추가 요청' },
    { source: 'request-work', target: 'work-results', label: '상단에서 작업 결과 열기' },
    { source: 'work-results', target: 'request-work', label: '결과 보고 추가 요청' },
    { source: 'request-work', target: 'conversation-usage', label: '입력창의 사용량 열기' },
    { source: 'open-project', target: 'resume-conversation', label: '프로젝트의 지난 대화 선택' },
    { source: 'resume-conversation', target: 'request-work', label: '같은 대화로 이어서 요청' },
    { source: 'resume-conversation', target: 'delete-conversation', label: '대화 메뉴에서 삭제' },
    { source: 'delete-conversation', target: 'request-work', label: '현재 대화 삭제 성공 후 새 대화' },
    { source: 'open-project', target: 'archive-project', label: '프로젝트 메뉴에서 보관' },
    { source: 'archive-project', target: 'open-project', label: '같은 폴더 다시 열기' },
    { source: 'open-project', target: 'remove-project', label: '프로젝트 메뉴에서 삭제' },
  ],
  nodeIds: [
    'open-project',
    'clone-project',
    'flow:connect-model',
    'request-work',
    'approve-action',
    'stop-work',
    'work-results',
    'conversation-usage',
    'resume-conversation',
    'delete-conversation',
    'archive-project',
    'remove-project',
  ],
};

it('routes a busy flow without lines through cards, lines on lines, or labels on labels or cards', () => {
  const connect = { id: 'connect-model', title: '사용할 모델 연결하기', nodeIds: [] };
  const flow = { id: 'work', title: 'Work', nodeIds: BUSY.nodeIds, edges: BUSY.edges };
  const layout = layoutFlow(flow, {
    nodes: BUSY.nodes.map((id) => ({ id, title: id })),
    flows: [connect, flow],
  });
  expect(layout.edges).toHaveLength(20);
  const boxes = layout.nodes.map((n) => ({ x: n.x, y: n.y, w: CARD_WIDTH, h: CARD_HEIGHT }));
  type Box = (typeof boxes)[number];
  const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  // Every segment stays out of every card (ports sit on a card's edge, so the inside is shrunk by a pixel).
  const segments = layout.edges.flatMap((e, line) =>
    e.points.slice(1).map((p, i) => ({ line, a: e.points[i]!, b: p })),
  );
  for (const { a, b } of segments)
    for (const card of boxes) {
      const seg = {
        x: Math.min(a[0], b[0]),
        y: Math.min(a[1], b[1]),
        w: Math.abs(a[0] - b[0]),
        h: Math.abs(a[1] - b[1]),
      };
      const inside = { x: card.x + 1, y: card.y + 1, w: card.w - 2, h: card.h - 2 };
      const crosses =
        seg.x <= inside.x + inside.w &&
        inside.x <= seg.x + seg.w &&
        seg.y <= inside.y + inside.h &&
        inside.y <= seg.y + seg.h;
      expect(crosses).toBe(false);
    }
  // No two lines run along the same stretch.
  for (const s of segments)
    for (const t of segments) {
      if (s.line >= t.line) continue;
      const horizontal = (u: typeof s) => u.a[1] === u.b[1];
      if (horizontal(s) !== horizontal(t)) continue;
      // A horizontal segment is fixed in y and spans x; a vertical one the other way round.
      const fixed = horizontal(s) ? 1 : 0;
      const along = horizontal(s) ? 0 : 1;
      if (Math.abs(s.a[fixed] - t.a[fixed]) > 0.5) continue;
      const span = (u: typeof s) => [Math.min(u.a[along], u.b[along]), Math.max(u.a[along], u.b[along])] as const;
      const [s1, s2] = span(s);
      const [t1, t2] = span(t);
      expect(Math.min(s2, t2) - Math.max(s1, t1)).toBeLessThanOrEqual(1);
    }
  // Labels clear each other and every card.
  const pills = layout.edges
    .filter((e) => e.label)
    .map((e) => ({ x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h }));
  pills.forEach((p, i) => {
    pills.slice(i + 1).forEach((q) => expect(overlap(p, q)).toBe(false));
    boxes.forEach((card) => expect(overlap(p, card)).toBe(false));
  });
  // And no label covers another line.
  layout.edges.forEach((edge, own) => {
    if (!edge.label) return;
    const pill = { x: edge.x - edge.w / 2, y: edge.y - edge.h / 2, w: edge.w, h: edge.h };
    for (const { line, a, b } of segments) {
      if (line === own) continue;
      const covered =
        Math.min(a[0], b[0]) <= pill.x + pill.w &&
        pill.x <= Math.max(a[0], b[0]) &&
        Math.min(a[1], b[1]) <= pill.y + pill.h &&
        pill.y <= Math.max(a[1], b[1]);
      expect(covered).toBe(false);
    }
  });
  expect(layout.edges.every((e) => !e.path.includes('NaN'))).toBe(true);
});
