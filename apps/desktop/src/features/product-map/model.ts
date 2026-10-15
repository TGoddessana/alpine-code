import type {
  FlowGetResult,
  FlowNode,
  NodeState,
  ProductFlow,
  ProductMap,
  PromiseState,
  SessionInfo,
} from '@alpine/protocol';

/**
 * One uniform card for every step: a number/tag/kind line, the title, a status line and a picture area (a screen
 * thumbnail, or two lines of description). 224 x 156 gives the picture a 4:3-ish strip while the title stays about
 * 9px tall at the smallest automatic zoom (0.7), the same readable floor the old 200 x 72 card had.
 */
export const CARD_WIDTH = 224;
export const CARD_HEIGHT = 156;
const START_WIDTH = 168;
const START_HEIGHT = 44;
const LEFT = 24;
/**
 * Lines run only through the open space between cards: the gutter between two columns, the gap between two rows,
 * and the lanes above the first row that lines going back use. Lines sharing a gutter, a gap or a lane each get their
 * own track, and gutters and gaps widen to fit their tracks and labels, so no line crosses a card or runs on another.
 */
const MIN_GUTTER = 64;
const MIN_GAP = 32;
const TRACK = 10;
const LANE_GAP = 28;
const LANE_TOP = 16;
const LABEL_PAD = 12;
const PORT_SHIFT = 5;

/**
 * How far a feature's promises are known to hold, worst first. The server computes it: a finished chat or a build
 * never counts, only a current, linked check does, and an open issue always wins. `question` means only promises the
 * AI guessed at failed, so the user is asked whether they are rules at all.
 */
export type Verification = NodeState['status'];
export const VERIFICATIONS: Verification[] = ['failed', 'question', 'recheck', 'unconfirmed', 'passed', 'none'];
export type States = Record<string, NodeState> | undefined;

const EMPTY_MAP: ProductMap = {};
/** The map of a result; the server always sends one, an empty map stands in for a result that has none. */
export const mapOf = (board: FlowGetResult): ProductMap => board.document ?? EMPTY_MAP;

export function isWorking(node: FlowNode, sessions: SessionInfo[]) {
  const session = sessions.find((s) => s.id === node.sessionId);
  return session?.status === 'running' || session?.status === 'waiting' || node.phase === 'building';
}

/** The check a promise currently shows: the newest one written for it. */
export function currentCheck(node: FlowNode, conditionId: string) {
  const checks = (node.checks ?? []).filter((item) => item.conditionId === conditionId);
  return checks[checks.length - 1];
}

export type PromiseStatus = PromiseState['status'];

export function conditionResults(node: FlowNode, state?: NodeState) {
  return (node.conditions ?? []).map((condition) => {
    const promise = state?.promises?.[condition.id];
    const status: PromiseStatus = promise?.status ?? 'unconfirmed';
    return { condition, check: currentCheck(node, condition.id), status, promise };
  });
}

export function verification(node: FlowNode, state?: NodeState) {
  if (!state) {
    const total = node.conditions?.length ?? 0;
    return { status: (total ? 'unconfirmed' : 'none') as Verification, passed: 0, total };
  }
  return { status: state.status, passed: state.passed ?? 0, total: state.total ?? 0 };
}

/** Promise issue states that count as a problem to fix. */
export const PROBLEM_ISSUES: PromiseState['issue'][] = ['open', 'regressed', 'maybe_fixed'];

/**
 * Card numbers in the order the canvas shows them: flow by flow, each card once where it first appears, then the
 * cards no flow holds. They change when the map changes; node.id does not.
 */
export function numbers(document: ProductMap) {
  const order = new Map<string, string>();
  const known = new Set((document.nodes ?? []).map((n) => n.id));
  const add = (id: string) => known.has(id) && !order.has(id) && order.set(id, String(order.size + 1));
  for (const flow of document.flows ?? []) (flow.nodeIds ?? []).forEach(add);
  for (const node of document.nodes ?? []) add(node.id);
  return order;
}

/** Every tag the cards use, most used first: the map's own way of grouping, chosen by the AI. */
export function allTags(document: ProductMap) {
  const counts = new Map<string, number>();
  for (const node of document.nodes ?? [])
    for (const tag of node.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

/** Problem counts over every promise of every feature. */
export function issueCounts(states: States) {
  const counts = { open: 0, regressed: 0, maybe_fixed: 0, later: 0, question: 0 };
  for (const state of Object.values(states ?? {}))
    for (const promise of Object.values(state.promises ?? {}))
      if (promise.issue && promise.issue in counts) counts[promise.issue as keyof typeof counts] += 1;
  return counts;
}

/** Project-wide totals, counting a feature used by several flows once. */
export function summary(document: ProductMap, states: States, sessions: SessionInfo[]) {
  const counts: Record<Verification, number> = {
    failed: 0,
    question: 0,
    recheck: 0,
    unconfirmed: 0,
    passed: 0,
    none: 0,
  };
  let conditions = 0;
  let passedConditions = 0;
  let working = 0;
  for (const node of document.nodes ?? []) {
    const result = verification(node, states?.[node.id]);
    counts[result.status] += 1;
    conditions += result.total;
    passedConditions += result.passed;
    if (isWorking(node, sessions)) working += 1;
  }
  return { features: document.nodes?.length ?? 0, conditions, passedConditions, working, counts };
}

export interface PositionedNode {
  node: StepNode;
  x: number;
  y: number;
}
export interface PositionedEdge {
  source: string;
  target: string;
  label: string;
  path: string;
  /** Centre of the label pill, nudged clear of cards and other labels. */
  x: number;
  y: number;
  /** Estimated pill size, so the canvas and the collision pass agree. */
  w: number;
  h: number;
  planned: boolean;
  /** The corners of the line, start to end; every segment is horizontal or vertical. */
  points: [number, number][];
}

const LABEL_HEIGHT = 22;
/** Rough pill width for a label: wide glyphs (Korean) take more room than latin ones. */
export function labelWidth(label: string) {
  let width = 16;
  for (const char of label) width += char.charCodeAt(0) > 0x2e80 ? 12 : 7;
  return width;
}

/** A step that stands for another flow. */
export type StepNode = FlowNode & { call?: ProductFlow };

/** The flow a step id calls (`flow:<id>`), or null for a card. */
export const calledFlow = (id: string) => (id.startsWith('flow:') ? id.slice(5) : null);

/** Stable, bounded layout: branch/merge paths occupy ranks; back edges and cycles use return lanes. */
export function layoutFlow(flow: ProductFlow, document: ProductMap) {
  const byId = new Map((document.nodes ?? []).map((n) => [n.id, n]));
  const flows = new Map((document.flows ?? []).map((f) => [f.id, f]));
  // A step written `flow:<id>` calls another flow (the ways to one result, gathered there); it is laid out like a card.
  const nodes: StepNode[] = (flow.nodeIds ?? []).flatMap((id) => {
    if (byId.has(id)) return [byId.get(id)!];
    const called = calledFlow(id) && flows.get(calledFlow(id)!);
    return called && called.id !== flow.id ? [{ id, title: called.title, phase: 'built', call: called }] : [];
  });
  const ids = new Set(nodes.map((n) => n.id));
  // A flow carries its own transitions; the merged list is only for maps from servers that did not send them.
  const edges = (flow.edges ?? document.edges ?? []).filter((e) => ids.has(e.source) && ids.has(e.target));
  // Return edges close a cycle when walking forward from the journey's entry points, like "retry" or "promoted".
  const back = new Set<(typeof edges)[number]>();
  const walked = new Map<string, 'open' | 'done'>();
  const walk = (id: string) => {
    walked.set(id, 'open');
    for (const edge of edges.filter((e) => e.source === id)) {
      const state = walked.get(edge.target);
      if (state === 'open') back.add(edge);
      else if (!state) walk(edge.target);
    }
    walked.set(id, 'done');
  };
  const roots = nodes.filter((n) => !edges.some((e) => e.target === n.id));
  [...roots, ...nodes].forEach((n) => walked.has(n.id) || walk(n.id));
  const forward = edges.filter((e) => !back.has(e));
  const rank = new Map<string, number>();
  const level = (id: string): number => {
    if (!rank.has(id))
      rank.set(id, Math.max(0, ...forward.filter((e) => e.target === id).map((e) => level(e.source) + 1)));
    return rank.get(id)!;
  };
  // Within a column, place each step near the steps that lead to it to keep lines from crossing.
  const columns = new Map<number, FlowNode[]>();
  nodes.forEach((n) => columns.set(level(n.id), [...(columns.get(level(n.id)) ?? []), n]));
  const row = new Map<string, number>();
  [...columns.keys()]
    .sort((a, b) => a - b)
    .forEach((column) => {
      columns
        .get(column)!
        .map((node, index) => {
          const parents = forward.filter((e) => e.target === node.id).map((e) => row.get(e.source) ?? 0);
          return { node, key: parents.length ? parents.reduce((a, b) => a + b, 0) / parents.length : index };
        })
        .sort((a, b) => a.key - b.key)
        .forEach(({ node }, index) => row.set(node.id, index));
    });
  const col = (id: string) => level(id);
  const rowOf = (id: string) => row.get(id)!;
  const maxCol = Math.max(0, ...nodes.map((n) => col(n.id)));
  const maxRow = Math.max(0, ...nodes.map((n) => rowOf(n.id)));
  const ahead = edges.filter((e) => col(e.target) > col(e.source));
  const behind = edges.filter((e) => col(e.target) <= col(e.source));

  // Ports: lines going ahead leave a card's right side and enter the next card's left side; lines going back leave
  // and enter through the top. Each line gets its own spot on a side, ordered by where its other end lies.
  const sides = { right: new Map<string, Edge[]>(), left: new Map<string, Edge[]>(), top: new Map<string, Edge[]>() };
  const push = (side: Map<string, Edge[]>, id: string, edge: Edge) => side.set(id, [...(side.get(id) ?? []), edge]);
  ahead.forEach((e) => (push(sides.right, e.source, e), push(sides.left, e.target, e)));
  behind.forEach((e) => (push(sides.top, e.source, e), push(sides.top, e.target, e)));
  const other = (e: Edge, id: string) => (e.source === id ? e.target : e.source);
  sides.right.forEach((list, id) => list.sort((a, b) => rowOf(other(a, id)) - rowOf(other(b, id))));
  sides.left.forEach((list, id) => list.sort((a, b) => rowOf(other(a, id)) - rowOf(other(b, id))));
  sides.top.forEach((list, id) => list.sort((a, b) => col(other(a, id)) - col(other(b, id))));
  const spot = (side: Map<string, Edge[]>, id: string, edge: Edge, at: (e: Edge) => boolean) => {
    const list = side.get(id) ?? [];
    const index = list.findIndex((e) => e === edge && at(e));
    return (index + 1) / (list.length + 1);
  };

  // Tracks: which line runs where in each gutter (-1: left of the first column) and each gap (-1: above row 0).
  const gutterTracks = new Map<number, number>();
  const gapTracks = new Map<number, number>();
  const take = (tracks: Map<number, number>, key: number) => {
    const next = tracks.get(key) ?? 0;
    tracks.set(key, next + 1);
    return { key, index: next };
  };
  type Track = { key: number; index: number };
  const gutterLabel = new Map<number, number>();
  const plans = edges.map((edge) => {
    const cs = col(edge.source);
    const ct = col(edge.target);
    const rs = rowOf(edge.source);
    const rt = rowOf(edge.target);
    const label = edge.label ?? '';
    if (ct > cs) {
      const out = take(gutterTracks, cs);
      if (ct === cs + 1) {
        if (label) gutterLabel.set(cs, Math.max(gutterLabel.get(cs) ?? 0, labelWidth(label)));
        return { edge, label, kind: 'next' as const, out };
      }
      // Further ahead: along the gap next to the target's row, past the columns in between.
      const gap = take(gapTracks, rt >= rs ? (rt === rs ? rs - 1 : rt - 1) : rs - 1);
      return { edge, label, kind: 'far' as const, out, gap, into: take(gutterTracks, ct - 1) };
    }
    // Going back: up out of the source (through the gap above it and its right gutter), along a lane above the
    // first row, and down into the target (through its left gutter and the gap above it).
    const up = rs > 0 ? { gap: take(gapTracks, rs - 1), gutter: take(gutterTracks, cs) } : null;
    const down = rt > 0 ? { gutter: take(gutterTracks, ct - 1), gap: take(gapTracks, rt - 1) } : null;
    return { edge, label, kind: 'back' as const, up, down };
  });
  const entryNodes = nodes.filter((n) => !ahead.some((e) => e.target === n.id));
  const entryTracks = entryNodes.map(() => take(gutterTracks, -1));

  // Columns and gutters, left to right.
  // A gutter holds its tracks on the left and, when lines entering the next column carry labels, a label strip on
  // the right where each label sits on its own line's last stretch, away from every other vertical line.
  const trackArea = (key: number) => Math.max(MIN_GUTTER - 16, ((gutterTracks.get(key) ?? 0) + 1) * TRACK) + 8;
  const labelArea = (key: number) => (gutterLabel.has(key) ? gutterLabel.get(key)! + 2 * LABEL_PAD : 0);
  const gutterWidth = (key: number) => Math.max(MIN_GUTTER, trackArea(key) + labelArea(key));
  const colX: number[] = [LEFT + START_WIDTH + gutterWidth(-1)];
  for (let c = 0; c < maxCol; c++) colX.push(colX[c]! + CARD_WIDTH + gutterWidth(c));
  const gutterX = (key: number) => (key < 0 ? LEFT + START_WIDTH : colX[key]! + CARD_WIDTH);
  const trackX = (t: Track) =>
    gutterX(t.key) + ((trackArea(t.key) - 8) * (t.index + 1)) / ((gutterTracks.get(t.key) ?? 0) + 1);
  const portX = (id: string, edge: Edge, outgoing: boolean) =>
    colX[col(id)]! +
    CARD_WIDTH * spot(sides.top, id, edge, (e) => (e.source === id) === outgoing || e.source === e.target);

  // Lanes: each line going back gets the lowest lane whose span it does not overlap (its label included).
  const lanes: { from: number; to: number }[][] = [];
  const laneOf = new Map<Edge, number>();
  const spans = plans
    .filter((p) => p.kind === 'back')
    .map((p) => {
      const a = p.up ? trackX(p.up.gutter) : portX(p.edge.source, p.edge, true);
      const b = p.down ? trackX(p.down.gutter) : portX(p.edge.target, p.edge, false);
      const mid = (a + b) / 2;
      const half = p.label ? labelWidth(p.label) / 2 + 8 : 0;
      return { edge: p.edge, from: Math.min(a, b, mid - half) - 6, to: Math.max(a, b, mid + half) + 6 };
    })
    .sort((a, b) => a.from - b.from);
  for (const span of spans) {
    let lane = lanes.findIndex((taken) => taken.every((t) => span.to < t.from || span.from > t.to));
    if (lane < 0) lane = lanes.push([]) - 1;
    lanes[lane]!.push(span);
    laneOf.set(span.edge, lane);
  }
  const laneY = (lane: number) => LANE_TOP + lane * LANE_GAP + LANE_GAP / 2;
  const lanesBottom = lanes.length ? LANE_TOP + lanes.length * LANE_GAP : 0;

  // Rows and gaps, top to bottom.
  const gapHeight = (key: number) => Math.max(MIN_GAP, ((gapTracks.get(key) ?? 0) + 1) * TRACK);
  const rowY: number[] = [lanesBottom + gapHeight(-1)];
  for (let r = 0; r < maxRow; r++) rowY.push(rowY[r]! + CARD_HEIGHT + gapHeight(r));
  const gapY = (key: number) => (key < 0 ? lanesBottom : rowY[key]! + CARD_HEIGHT);
  const trackY = (t: Track) => gapY(t.key) + (gapHeight(t.key) * (t.index + 1)) / ((gapTracks.get(t.key) ?? 0) + 1);

  const placed = nodes.map((node) => ({ node, x: colX[col(node.id)]!, y: rowY[rowOf(node.id)]! }));
  const positions = new Map(placed.map((n) => [n.node.id, n]));
  const cards = placed.map((p) => ({ x: p.x, y: p.y, w: CARD_WIDTH, h: CARD_HEIGHT }));
  const taken: Box[] = [];
  const hits = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  // First every line's corners, then the labels, so a label can keep clear of lines as well as cards and labels.
  const routed = plans.map((plan) => {
    const { edge } = plan;
    const from = positions.get(edge.source)!;
    const to = positions.get(edge.target)!;
    let points: [number, number][];
    let anchor: { x: number; y: number; along: 'x' | 'y' };
    if (plan.kind === 'next' || plan.kind === 'far') {
      // Lines leaving a card sit a little above lines entering the card beside it, so in a shared gutter a stub
      // going out and a stub coming in at the same height never run on each other.
      const y1 = from.y + CARD_HEIGHT * spot(sides.right, edge.source, edge, () => true) - PORT_SHIFT;
      const y2 = to.y + CARD_HEIGHT * spot(sides.left, edge.target, edge, () => true) + PORT_SHIFT;
      const x1 = from.x + CARD_WIDTH;
      const gx = trackX(plan.out);
      if (plan.kind === 'next') {
        points = [
          [x1, y1],
          [gx, y1],
          [gx, y2],
          [to.x, y2],
        ];
        // On the line's last stretch, in the gutter's label strip.
        anchor = { x: to.x - labelArea(plan.out.key) / 2, y: y2, along: 'y' };
      } else {
        const gy = trackY(plan.gap);
        const ix = trackX(plan.into);
        points = [
          [x1, y1],
          [gx, y1],
          [gx, gy],
          [ix, gy],
          [ix, y2],
          [to.x, y2],
        ];
        anchor = { x: (gx + ix) / 2, y: gy, along: 'x' };
      }
    } else {
      const lane = laneY(laneOf.get(edge)!);
      const sx = portX(edge.source, edge, true);
      const tx = portX(edge.target, edge, false);
      const start: [number, number][] = plan.up
        ? [
            [sx, from.y],
            [sx, trackY(plan.up.gap)],
            [trackX(plan.up.gutter), trackY(plan.up.gap)],
            [trackX(plan.up.gutter), lane],
          ]
        : [
            [sx, from.y],
            [sx, lane],
          ];
      const end: [number, number][] = plan.down
        ? [
            [trackX(plan.down.gutter), lane],
            [trackX(plan.down.gutter), trackY(plan.down.gap)],
            [tx, trackY(plan.down.gap)],
            [tx, to.y],
          ]
        : [
            [tx, lane],
            [tx, to.y],
          ];
      points = [...start, ...end];
      anchor = { x: (start.at(-1)![0] + end[0]![0]) / 2, y: lane, along: 'x' };
    }
    return { plan, from, to, points, anchor };
  });
  const segments = routed.flatMap(({ points }, line) => points.slice(1).map((p, i) => ({ line, a: points[i]!, b: p })));
  const crossesLine = (box: Box, line: number) =>
    segments.some(({ line: other, a, b }) => {
      if (other === line) return false;
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      return x <= box.x + box.w && box.x <= Math.max(a[0], b[0]) && y <= box.y + box.h && box.y <= Math.max(a[1], b[1]);
    });
  // A label slides along its own line until it covers no card, no other label and no other line; failing that, it
  // takes the nearest spot that at least keeps clear of cards and labels.
  const place = (line: number, cx: number, cy: number, w: number, h: number, along: 'x' | 'y') => {
    const box = (d: number): Box =>
      along === 'x' ? { x: cx + d - w / 2, y: cy - h / 2, w, h } : { x: cx - w / 2, y: cy + d - h / 2, w, h };
    const offsets = [0];
    for (let d = 4; d <= 600; d += 4) offsets.push(d, -d);
    const solid = (d: number) => ![...cards, ...taken].some((o) => hits(box(d), o));
    const free = offsets.find((d) => solid(d) && !crossesLine(box(d), line)) ?? offsets.find(solid);
    const chosen = box(free ?? 0);
    taken.push(chosen);
    return { x: chosen.x + w / 2, y: chosen.y + h / 2 };
  };
  const lines = routed.map(({ plan, from, to, points, anchor }, line): PositionedEdge => {
    const { edge, label } = plan;
    const w = label ? labelWidth(label) : 0;
    const h = label ? LABEL_HEIGHT : 0;
    const pill = label ? place(line, anchor.x, anchor.y, w, h, anchor.along) : { x: 0, y: 0 };
    return {
      source: edge.source,
      target: edge.target,
      label,
      path: rounded(points),
      points,
      x: pill.x,
      y: pill.y,
      w,
      h,
      planned: from.node.phase === 'planned' || to.node.phase === 'planned',
    };
  });
  // The journey starts with whoever triggers it and enters every step that nothing earlier leads to.
  const startY = rowY[0]! + (CARD_HEIGHT - START_HEIGHT) / 2;
  const start = { x: LEFT, y: startY, width: START_WIDTH, height: START_HEIGHT };
  const entries = entryNodes.map((node, index) => {
    const at = positions.get(node.id)!;
    const x = trackX(entryTracks[index]!);
    const y1 = startY + (START_HEIGHT * (index + 1)) / (entryNodes.length + 1);
    const y2 = at.y + CARD_HEIGHT / 2;
    return rounded([
      [LEFT + START_WIDTH, y1],
      [x, y1],
      [x, y2],
      [at.x, y2],
    ]);
  });
  return {
    nodes: placed,
    edges: lines,
    start,
    entries,
    width: Math.max(colX[0]! + CARD_WIDTH + 32, ...placed.map((n) => n.x + CARD_WIDTH + 32)),
    height: Math.max(rowY[0]! + CARD_HEIGHT + 24, ...placed.map((n) => n.y + CARD_HEIGHT + 24)),
  };
}

type Edge = NonNullable<ProductMap['edges']>[number];
type Box = { x: number; y: number; w: number; h: number };

/** An orthogonal line with softly rounded corners. */
function rounded(points: [number, number][]) {
  const clean = points.filter((p, i) => i === 0 || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1]);
  let d = `M ${clean[0]![0]} ${clean[0]![1]}`;
  for (let i = 1; i < clean.length; i++) {
    const [x, y] = clean[i]!;
    const next = clean[i + 1];
    if (!next) {
      d += ` L ${x} ${y}`;
      break;
    }
    const [px, py] = clean[i - 1]!;
    const r = Math.min(6, Math.hypot(x - px, y - py) / 2, Math.hypot(next[0] - x, next[1] - y) / 2);
    const ax = x - Math.sign(x - px) * r;
    const ay = y - Math.sign(y - py) * r;
    const bx = x + Math.sign(next[0] - x) * r;
    const by = y + Math.sign(next[1] - y) * r;
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`;
  }
  return d;
}

const DAY = 86_400_000;
const OLD_AFTER_DAYS = 14;

/** When Alpine recorded the newest check of a feature (ms), or 0. */
export function newestCheckAt(state?: NodeState) {
  return Math.max(0, ...Object.values(state?.promises ?? {}).map((p) => (p.stamp?.at ? Date.parse(p.stamp.at) : 0)));
}

/** Age in whole days and whether the capture no longer reflects the screen (old, or older than its newest check). */
export function captureState(node: FlowNode, now: number, checkedAt = 0) {
  const at = node.previewAt ? Date.parse(node.previewAt) : NaN;
  if (Number.isNaN(at)) return null;
  const days = Math.max(0, Math.floor((now - at) / DAY));
  return { days, old: days > OLD_AFTER_DAYS || at < checkedAt };
}

/** Title, description, tags and promise wording, so a search finds a feature by what it is supposed to do. */
export function matchesQuery(node: FlowNode, needle: string) {
  if (!needle) return true;
  const texts = [
    node.title,
    node.description ?? '',
    ...(node.tags ?? []),
    ...(node.conditions ?? []).map((c) => c.expectation ?? ''),
  ];
  return texts.some((text) => text.toLowerCase().includes(needle));
}

export interface MapFilter {
  query: string;
  status: Verification | null;
  mustOnly: boolean;
  nowOnly: boolean;
  /** A tag, or null for every card. */
  tag: string | null;
}

/**
 * The features that pass every active filter, or null when nothing is filtered. The canvas dims everything else:
 * nodes are never removed, because removing a step would break the flow around it.
 */
export function matchingIds(document: ProductMap, states: States, filter: MapFilter) {
  const needle = filter.query.trim().toLowerCase();
  if (!needle && !filter.status && !filter.mustOnly && !filter.nowOnly && !filter.tag) return null;
  const ids = new Set<string>();
  for (const node of document.nodes ?? []) {
    if (
      (!filter.status || verification(node, states?.[node.id]).status === filter.status) &&
      (!filter.mustOnly || node.priority === 'must') &&
      (!filter.nowOnly || node.scope === 'now') &&
      (!filter.tag || !!node.tags?.includes(filter.tag)) &&
      matchesQuery(node, needle)
    )
      ids.add(node.id);
  }
  return ids;
}

/** Matching features in canvas order (flow by flow, then the unassigned group), each once, with the flow to show it in. */
export function searchOrder(document: ProductMap, ids: Set<string>) {
  const seen = new Set<string>();
  const order: { nodeId: string; flowId: string }[] = [];
  const visit = (flowId: string, nodeIds: string[]) => {
    for (const nodeId of nodeIds)
      if (ids.has(nodeId) && !seen.has(nodeId)) {
        seen.add(nodeId);
        order.push({ nodeId, flowId });
      }
  };
  const flows = document.flows ?? [];
  const nodes = document.nodes ?? [];
  for (const flow of flows)
    visit(
      flow.id,
      (flow.nodeIds ?? []).filter((id) => nodes.some((n) => n.id === id)),
    );
  visit(
    '__unassigned',
    nodes.map((n) => n.id),
  );
  return order;
}
