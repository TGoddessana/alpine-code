import type { FlowNode, NodeState, ProductMap } from '@alpine/protocol';
import { expect, it } from 'vitest';

import { STUDIO_MAP } from '@/shared/server';

import { focusItems } from './Focus';
import { conditionResults, matchingIds, searchOrder, verification } from './model';

it('never equates a finished conversation or a build with a passed feature', () => {
  const node: FlowNode = { id: 'n', title: 'Feature', phase: 'built', sessionId: 's' };
  expect(verification(node).status).toBe('none');
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

it('finds cards by their words, tags or promises, and orders them flow by flow', () => {
  const map: ProductMap = {
    nodes: [
      { id: 'x', title: '로그인', tags: ['회원'] },
      { id: 'y', title: '로그아웃' },
      {
        id: 'z',
        title: '결제',
        tags: ['회원', '주문'],
        conditions: [{ id: 'a', expectation: '로그인한 사람만 결제한다' }],
      },
    ],
    flows: [
      { id: 'one', title: 'One', nodeIds: ['z', 'x'] },
      { id: 'two', title: 'Two', nodeIds: ['x'] },
    ],
    edges: [],
  };
  expect(matchingIds(map, '  ')).toBeNull();
  expect([...matchingIds(map, ' 로그인 ')!]).toEqual(['x', 'z']);
  expect([...matchingIds(map, '주문')!]).toEqual(['z']);
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
