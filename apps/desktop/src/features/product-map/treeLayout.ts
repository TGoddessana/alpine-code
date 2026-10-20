import { tally, worst, type PromiseStatus, type TreeMap } from './flowTreeModel';

/**
 * The person-first map as a quiet flow diagram. Each person gets a band across the canvas. Inside it, the person's
 * way in (the start) branches to their journeys, and each journey runs left to right through its steps. A step's
 * promises open below it as small leaves. Nodes are as wide as their words; the fill says the level (start, journey,
 * step, promise), so the whole map stays one even, readable sheet.
 */

export type NodeKind = 'band' | 'start' | 'journey' | 'step' | 'promise' | 'addJourney' | 'addPerson';

export interface LaidNode {
  id: string;
  kind: NodeKind;
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
  promiseId?: string;
  index: number;
  status?: PromiseStatus | null;
}

export const stepId = (journeyId: string, cardId: string) => `step:${journeyId}/${cardId}`;
export const promiseNodeId = (journeyId: string, cardId: string, promiseId: string) =>
  `promise:${journeyId}/${cardId}/${promiseId}`;

const NODE_H = 32;
const LEAF_H = 26;
const LEAF_GAP = 6;
const LEAF_TOP = 12;
/** How far right of its step a promise starts; the branch runs down this gutter. */
export const LEAF_INDENT = 28;
export const BRANCH_X = 12;
const ROW_GAP = 14;
const BAND_TOP = 44;
const BAND_BOTTOM = 28;
const LEFT = 28;
const START_REACH = 56;
const STEP_REACH = 40;
const MAX = { start: 240, journey: 240, step: 300, promise: 320 } as const;

export type Measure = (text: string, size: 'body' | 'meta') => number;

export function layoutTree(map: TreeMap, openSteps: Set<string>, measure: Measure = measureText): LaidNode[] {
  const nodes: LaidNode[] = [];
  const width = (max: number, ...parts: number[]) => Math.min(max, Math.ceil(parts.reduce((sum, n) => sum + n, 0)));
  // One column for every band, so starts, journeys and first steps line up down the whole sheet.
  const startW = Math.max(
    120,
    ...map.people.map((person) => width(MAX.start, 28, measure(person.start.ko || person.name.ko, 'body'))),
  );
  const journeyW = Math.max(
    140,
    ...map.people.flatMap((person) =>
      person.journeys.map((journey) => width(MAX.journey, 64, measure(journey.title.ko, 'body'))),
    ),
  );
  const xJourney = LEFT + startW + START_REACH;
  const xSteps = xJourney + journeyW + STEP_REACH;
  // Steps line up in columns down the whole sheet: the n-th step of every journey shares one width and one x.
  const columns: number[] = [];
  for (const person of map.people)
    for (const journey of person.journeys)
      journey.steps.forEach((cardId, index) => {
        const card = map.cards[cardId];
        if (!card) return;
        columns[index] = Math.max(columns[index] ?? 160, width(MAX.step, 40, measure(card.title, 'body'), 64));
      });
  const columnX = columns.map((_, index) => columns.slice(0, index).reduce((sum, w) => sum + w + STEP_REACH, xSteps));

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
      w: startW,
      h: NODE_H,
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
        w: journeyW,
        h: NODE_H,
        personId: person.id,
        journeyId: journey.id,
        index: journeyIndex,
      });
      let previous = journeyNode;
      let rowH = NODE_H;
      journey.steps.forEach((cardId, stepIndex) => {
        const card = map.cards[cardId];
        if (!card) return;
        const id = stepId(journey.id, cardId);
        const w = columns[stepIndex]!;
        const x = columnX[stepIndex]!;
        nodes.push({
          id,
          kind: 'step',
          parent: previous,
          x,
          y: rowY,
          w,
          h: NODE_H,
          personId: person.id,
          journeyId: journey.id,
          cardId,
          index: stepIndex,
          status: worst(tally(card.promises)),
        });
        if (openSteps.has(id)) {
          let leafY = rowY + NODE_H + LEAF_TOP;
          card.promises.forEach((promise, promiseIndex) => {
            nodes.push({
              id: promiseNodeId(journey.id, cardId, promise.id),
              kind: 'promise',
              parent: id,
              x: x + LEAF_INDENT,
              y: leafY,
              w: width(MAX.promise, 38, measure(promise.when || promise.then, 'meta'), 64),
              h: LEAF_H,
              personId: person.id,
              journeyId: journey.id,
              cardId,
              promiseId: promise.id,
              index: promiseIndex,
              status: promise.status,
            });
            leafY += LEAF_H + LEAF_GAP;
          });
          rowH = Math.max(rowH, leafY - LEAF_GAP - rowY);
        }
        previous = id;
        right = Math.max(right, x + w + STEP_REACH);
      });
      rowY += rowH + ROW_GAP;
    });
    nodes.push({
      id: `add-journey:${person.id}`,
      kind: 'addJourney',
      parent: startNode,
      x: xJourney,
      y: rowY,
      w: 120,
      h: 26,
      personId: person.id,
      index: person.journeys.length,
    });
    rowY += 26;
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
  return nodes;
}

/** A rough width without a browser to measure in (tests): Hangul and capitals count fuller. */
function estimate(text: string, size: 'body' | 'meta') {
  const em = size === 'body' ? 13 : 12;
  let total = 0;
  for (const char of text) total += /[ㄱ-힝]/.test(char) ? em : /[A-Z0-9]/.test(char) ? em * 0.64 : em * 0.54;
  return total;
}

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

/** The width of a label in the app's font, measured once in a canvas; the estimate where there is no canvas. */
export const measureText: Measure = (text, size) => {
  const key = `${size}|${text}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  if (context === undefined) {
    try {
      context = document.createElement('canvas').getContext('2d');
    } catch {
      context = null;
    }
  }
  let result = estimate(text, size);
  if (context) {
    context.font = `${size === 'body' ? 13 : 12}px 'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif`;
    result = context.measureText(text).width;
  }
  widths.set(key, result);
  return result;
};

export function bounds(nodes: { x: number; y: number; w: number; h: number }[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.w));
  const bottom = Math.max(...nodes.map((node) => node.y + node.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
