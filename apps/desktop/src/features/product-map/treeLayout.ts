import { isJourneyLink, tally, worst, type Journey, type PromiseStatus, type TreeMap } from './flowTreeModel';

/**
 * The person-first map as a quiet flow diagram. Each person gets a band across the canvas. Inside it, the person's
 * way in (the start) leads to their journeys. A journey's main way runs left to right on one line; where it branches
 * (several ways on, each with its condition) the other ways start lines of their own below, so a branch reads as a
 * branch, not as the next step. A step reached again from further on (a loop back) is not drawn twice: the card that
 * goes back says so. Steps share columns down the whole sheet, so it stays one even grid.
 */

export type NodeKind = 'band' | 'start' | 'journey' | 'step' | 'link' | 'addJourney' | 'addPerson';

export interface LaidNode {
  id: string;
  kind: NodeKind;
  /** The node it grew from on its line or branch (motion starts there; the lit path follows it). */
  parent: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn behind and lets the canvas be dragged through it (a band); only its label takes clicks. */
  passive?: boolean;
  personId?: string;
  journeyId?: string;
  cardId?: string;
  /** For a link: the journey it goes through. */
  linkTo?: string;
  index: number;
  status?: PromiseStatus | null;
  /** The condition of the branch that arrives here, when it is not the main way. */
  arrival?: string;
  /** Steps further back this one leads to again (loops), by title, with their condition. */
  loops?: { title: string; label: string }[];
}

export interface LaidEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  /** A second way into a step that already has its place (a merge): drawn lighter. */
  merge?: boolean;
}

export const stepId = (journeyId: string, cardId: string) => `step:${journeyId}/${cardId}`;
export const linkId = (journeyId: string, flowId: string) => `link:${journeyId}/${flowId}`;

/** A card's top line (its label) sits this far down; lines join cards there, so a row reads as one straight line. */
export const ANCHOR_Y = 22;
/** Promises a closed step card lists; an open one lists them all. */
export const CHECKLIST_ROWS = 4;
const CHECK_ROW = 20;
const CARD_H = 132 + CHECKLIST_ROWS * CHECK_ROW;
const LINK_H = 72;
const START_W = 216;
const JOURNEY_W = 264;
const STEP_W = 288;
/** Between the lines of one journey: room for a branch's condition above its first card. */
const LANE_GAP = 34;
const JOURNEY_GAP = 28;
const BAND_TOP = 56;
const BAND_BOTTOM = 32;
const LEFT = 28;
const START_REACH = 48;
const STEP_REACH = 48;

/** A step card is as tall as its checklist: four promises while closed, all of them once opened. */
export function stepHeight(promises: number, open: boolean) {
  return open ? CARD_H + Math.max(0, promises - CHECKLIST_ROWS) * CHECK_ROW : CARD_H;
}

interface Place {
  column: number;
  lane: number;
  parent: string | null;
  arrival?: string;
}

/**
 * Where each step of a journey goes: its column (how far along) and its lane (0 is the main way). Walks from the
 * first step; the first way on from a step continues its lane, every other way opens the next free lane. Steps the
 * walk cannot reach start a lane after the furthest step that leads to them.
 */
function placeSteps(journey: Journey) {
  const steps = journey.steps;
  const order = new Map(steps.map((id, index) => [id, index]));
  const edges =
    journey.edges && journey.edges.length
      ? journey.edges
      : steps.slice(1).map((to, index) => ({ from: steps[index]!, to, label: '' }));
  const out = new Map<string, { to: string; label: string }[]>();
  for (const edge of edges) {
    if (!order.has(edge.from) || !order.has(edge.to) || edge.from === edge.to) continue;
    const list = out.get(edge.from) ?? [];
    list.push({ to: edge.to, label: edge.label });
    out.set(edge.from, list);
  }
  for (const list of out.values()) list.sort((a, b) => order.get(a.to)! - order.get(b.to)!);

  const places = new Map<string, Place>();
  let lanes = 0;
  const walk = (id: string, column: number, lane: number, parent: string | null, arrival?: string) => {
    places.set(id, { column, lane, parent, arrival });
    let first = true;
    for (const next of out.get(id) ?? []) {
      if (places.has(next.to)) continue;
      if (first) {
        first = false;
        walk(next.to, column + 1, lane, id);
      } else walk(next.to, column + 1, lanes++, id, next.label);
    }
  };
  if (steps[0]) walk(steps[0], 0, lanes++, null);
  for (const id of steps) {
    if (places.has(id)) continue;
    const before = edges.filter((edge) => edge.to === id && places.has(edge.from));
    const from = before.sort((a, b) => places.get(b.from)!.column - places.get(a.from)!.column)[0];
    walk(id, from ? places.get(from.from)!.column + 1 : 0, lanes++, from?.from ?? null, from?.label);
  }

  // Every other edge is either a merge (into a step further along) or a loop back (to one already passed).
  const merges: { from: string; to: string; label: string }[] = [];
  const loops = new Map<string, { to: string; label: string }[]>();
  for (const [from, list] of out)
    for (const { to, label } of list) {
      if (places.get(to)!.parent === from) continue;
      if (places.get(to)!.column > places.get(from)!.column) merges.push({ from, to, label });
      else loops.set(from, [...(loops.get(from) ?? []), { to, label }]);
    }
  return { places, lanes, merges, loops };
}

export function layoutTree(map: TreeMap, openSteps: Set<string>): { nodes: LaidNode[]; edges: LaidEdge[] } {
  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];
  const xJourney = LEFT + START_W + START_REACH;
  const xSteps = xJourney + JOURNEY_W + STEP_REACH;
  const columnX = (column: number) => xSteps + column * (STEP_W + STEP_REACH);
  const journeyTitles = new Map(
    map.people.flatMap((person) => person.journeys.map((journey) => [journey.id, journey.title.ko] as const)),
  );
  let y = 0;
  let right = xSteps;

  map.people.forEach((person, personIndex) => {
    const band = `band:${person.id}`;
    const bandIndex = nodes.length;
    const top = y;
    let rowY = y + BAND_TOP;
    const startNode = `start:${person.id}`;
    nodes.push({
      id: startNode,
      kind: 'start',
      parent: band,
      x: LEFT,
      y: rowY,
      w: START_W,
      h: CARD_H,
      personId: person.id,
      index: 0,
    });

    person.journeys.forEach((journey, journeyIndex) => {
      const journeyNode = `journey:${journey.id}`;
      nodes.push({
        id: journeyNode,
        kind: 'journey',
        parent: startNode,
        x: xJourney,
        y: rowY,
        w: JOURNEY_W,
        h: CARD_H,
        personId: person.id,
        journeyId: journey.id,
        index: journeyIndex,
      });
      edges.push({ id: `${startNode}>${journeyNode}`, from: startNode, to: journeyNode, label: '' });

      const { places, lanes, merges, loops } = placeSteps(journey);
      const idOf = (step: string) =>
        isJourneyLink(step) ? linkId(journey.id, step.slice(5)) : stepId(journey.id, step);
      const heightOf = (step: string) => {
        if (isJourneyLink(step)) return LINK_H;
        const card = map.cards[step];
        return card ? stepHeight(card.promises.length, openSteps.has(idOf(step))) : CARD_H;
      };
      // Each lane is as tall as its tallest card; the journey's lines stack under one another.
      const laneHeights = Array.from({ length: Math.max(1, lanes) }, () => 0);
      for (const [step, place] of places) laneHeights[place.lane] = Math.max(laneHeights[place.lane]!, heightOf(step));
      laneHeights[0] = Math.max(laneHeights[0]!, CARD_H);
      const laneY = laneHeights.map((_, lane) =>
        laneHeights.slice(0, lane).reduce((sum, h) => sum + h + LANE_GAP, rowY),
      );

      for (const [step, place] of places) {
        const id = idOf(step);
        const parent = place.parent ? idOf(place.parent) : journeyNode;
        const x = columnX(place.column);
        const common = {
          id,
          parent,
          x,
          y: laneY[place.lane]!,
          w: STEP_W,
          personId: person.id,
          journeyId: journey.id,
          index: place.column,
          arrival: place.arrival || undefined,
          loops: (loops.get(step) ?? []).map(({ to, label }) => ({
            title: isJourneyLink(to) ? (journeyTitles.get(to.slice(5)) ?? to) : (map.cards[to]?.title ?? to),
            label,
          })),
        };
        if (isJourneyLink(step)) nodes.push({ ...common, kind: 'link', h: LINK_H, linkTo: step.slice(5) });
        else {
          const card = map.cards[step];
          nodes.push({
            ...common,
            kind: 'step',
            h: heightOf(step),
            cardId: step,
            status: card ? worst(tally(card.promises)) : null,
          });
        }
        edges.push({
          id: `${parent}>${id}`,
          from: parent,
          to: id,
          label: place.arrival ?? '',
        });
        right = Math.max(right, x + STEP_W + STEP_REACH);
      }
      for (const merge of merges)
        edges.push({
          id: `${idOf(merge.from)}>${idOf(merge.to)}`,
          from: idOf(merge.from),
          to: idOf(merge.to),
          label: merge.label,
          merge: true,
        });
      rowY = laneY[laneY.length - 1]! + laneHeights[laneHeights.length - 1]! + JOURNEY_GAP;
    });

    const add = `add-journey:${person.id}`;
    nodes.push({
      id: add,
      kind: 'addJourney',
      parent: startNode,
      x: xJourney,
      y: rowY,
      w: 120,
      h: 28,
      personId: person.id,
      index: person.journeys.length,
    });
    edges.push({ id: `${startNode}>${add}`, from: startNode, to: add, label: '' });
    rowY += 28;
    y = rowY + BAND_BOTTOM;
    nodes.splice(bandIndex, 0, {
      id: band,
      kind: 'band',
      parent: null,
      x: 0,
      y: top,
      w: 0,
      h: y - top,
      passive: true,
      personId: person.id,
      index: personIndex,
    });
  });
  for (const node of nodes) if (node.kind === 'band') node.w = right + LEFT;
  nodes.push({
    id: 'add-person',
    kind: 'addPerson',
    parent: null,
    x: LEFT,
    y: y + 16,
    w: 150,
    h: 30,
    index: map.people.length,
  });
  return { nodes, edges };
}

export function bounds(nodes: { x: number; y: number; w: number; h: number }[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.w));
  const bottom = Math.max(...nodes.map((node) => node.y + node.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
