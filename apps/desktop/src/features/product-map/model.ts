import type { FlowNode, ProductFlow, ProductMap, SessionInfo } from '@alpine/protocol';

export const CARD_WIDTH = 232;
export const CARD_HEIGHT = 190;
const COLUMN = 310;
const ROW = 250;

export type NodeState = 'issue' | 'working' | 'planned' | 'built';

/** A chat finishing does not certify the product, nor does a repair hide an unresolved issue. */
export function nodeState(node: FlowNode, sessions: SessionInfo[]): NodeState {
  if (node.issue || node.checks?.some((c) => c.result === 'failed')) return 'issue';
  const session = sessions.find((s) => s.id === node.sessionId);
  if (session?.status === 'running' || session?.status === 'waiting' || node.phase === 'building') return 'working';
  return node.phase === 'built' ? 'built' : 'planned';
}

export interface PositionedNode {
  node: FlowNode;
  x: number;
  y: number;
}
export interface PositionedEdge {
  source: string;
  target: string;
  label: string;
  path: string;
  x: number;
  y: number;
  planned: boolean;
}

/** Stable, bounded layout: branch/merge paths occupy ranks; back edges and cycles use return lanes. */
export function layoutFlow(flow: ProductFlow, document: ProductMap) {
  const byId = new Map((document.nodes ?? []).map((n) => [n.id, n]));
  const nodes = (flow.nodeIds ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (document.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const done = new Set<string>();
  function visit(id: string): number {
    if (visiting.has(id)) return -1; // a return edge, not another forward rank
    if (done.has(id)) return rank.get(id)!;
    visiting.add(id);
    let level = 0;
    for (const edge of edges.filter((e) => e.target === id)) {
      if (!visiting.has(edge.source)) level = Math.max(level, visit(edge.source) + 1);
    }
    visiting.delete(id);
    done.add(id);
    rank.set(id, level);
    return level;
  }
  nodes.forEach((n) => visit(n.id));
  const rows = new Map<number, number>();
  const placed = nodes.map((node) => {
    const col = rank.get(node.id) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    return { node, x: 30 + col * COLUMN, y: 75 + row * ROW };
  });
  const positions = new Map(placed.map((n) => [n.node.id, n]));
  const lines = edges.map((edge, index): PositionedEdge => {
    const from = positions.get(edge.source)!;
    const to = positions.get(edge.target)!;
    const x1 = from.x + CARD_WIDTH;
    const y1 = from.y + CARD_HEIGHT / 2;
    const x2 = to.x;
    const y2 = to.y + CARD_HEIGHT / 2;
    const forward = x2 > x1;
    const bend = (x1 + x2) / 2;
    const lane = 22 + (index % 4) * 10;
    return {
      source: edge.source,
      target: edge.target,
      label: edge.label ?? '',
      path: forward
        ? `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}`
        : `M ${from.x + CARD_WIDTH / 2} ${from.y} V ${lane} H ${to.x + CARD_WIDTH / 2} V ${to.y}`,
      x: forward ? bend : (from.x + to.x + CARD_WIDTH) / 2,
      y: forward ? (y1 + y2) / 2 - 12 : lane - 5,
      planned: from.node.phase === 'planned' || to.node.phase === 'planned',
    };
  });
  return {
    nodes: placed,
    edges: lines,
    width: Math.max(600, ...placed.map((n) => n.x + CARD_WIDTH + 35)),
    height: Math.max(300, ...placed.map((n) => n.y + CARD_HEIGHT + 35)),
  };
}
