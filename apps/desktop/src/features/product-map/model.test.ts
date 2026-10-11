import type { FlowNode, ProductMap } from '@alpine/protocol';
import { describe, expect, it } from 'vitest';

import { sessionInfo } from '@/shared/server';

import { CARD_HEIGHT, CARD_WIDTH, layoutFlow, nodeState } from './model';

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

it('never equates a finished conversation with a passed feature', () => {
  const node: FlowNode = { id: 'n', title: 'Feature', phase: 'built', sessionId: 's' };
  expect(nodeState(node, [sessionInfo({ id: 's', status: 'idle' })])).toBe('built');
  expect(nodeState({ ...node, issue: 'broken' }, [sessionInfo({ id: 's', status: 'running' })])).toBe('issue');
  expect(
    nodeState({ ...node, checks: [{ command: 'test', output: 'failed', result: 'failed', summary: 'order' }] }, []),
  ).toBe('issue');
  expect(nodeState({ ...node, phase: 'planned' }, [])).toBe('planned');
});
