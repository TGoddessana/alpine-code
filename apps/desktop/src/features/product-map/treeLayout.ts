import { tally, worst, type PromiseStatus, type TreeMap } from './flowTreeModel';

/**
 * The person-first map as a quiet flow diagram. Each person gets a band across the canvas. Inside it, the person's
 * way in (the start) branches to their journeys, and each journey runs left to right through its steps. A step's
 * promises open below it as small leaves. Nodes are as wide as their words; the fill says the level (start, journey,
 * step, promise), so the whole map stays one even, readable sheet.
 */

export type NodeKind = 'band' | 'start' | 'journey' | 'step' | 'addJourney' | 'addPerson';

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

/** A card's top line (its label) sits this far down; lines join cards there, so a row reads as one straight line. */
export const ANCHOR_Y = 22;
/** Promises a closed step card lists; an open one lists them all. */
export const CHECKLIST_ROWS = 4;
const CHECK_ROW = 20;
const CARD_H = 124 + CHECKLIST_ROWS * CHECK_ROW;
const START_W = 216;
const JOURNEY_W = 264;
const STEP_W = 288;
const ROW_GAP = 20;
const BAND_TOP = 48;
const BAND_BOTTOM = 32;
const LEFT = 28;
const START_REACH = 48;
const STEP_REACH = 40;

/** A step card is as tall as its checklist: four promises while closed, all of them once opened. */
export function stepHeight(promises: number, open: boolean) {
  return open ? CARD_H + Math.max(0, promises - CHECKLIST_ROWS) * CHECK_ROW : CARD_H;
}

export function layoutTree(map: TreeMap, openSteps: Set<string>): LaidNode[] {
  const nodes: LaidNode[] = [];
  const xJourney = LEFT + START_W + START_REACH;
  const xSteps = xJourney + JOURNEY_W + STEP_REACH;
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
      let previous = journeyNode;
      let rowH = CARD_H;
      journey.steps.forEach((cardId, stepIndex) => {
        const card = map.cards[cardId];
        if (!card) return;
        const id = stepId(journey.id, cardId);
        const h = stepHeight(card.promises.length, openSteps.has(id));
        const x = xSteps + stepIndex * (STEP_W + STEP_REACH);
        nodes.push({
          id,
          kind: 'step',
          parent: previous,
          x,
          y: rowY,
          w: STEP_W,
          h,
          personId: person.id,
          journeyId: journey.id,
          cardId,
          index: stepIndex,
          status: worst(tally(card.promises)),
        });
        rowH = Math.max(rowH, h);
        previous = id;
        right = Math.max(right, x + STEP_W + STEP_REACH);
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
      h: 28,
      personId: person.id,
      index: person.journeys.length,
    });
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
  return nodes;
}

export function bounds(nodes: { x: number; y: number; w: number; h: number }[]) {
  if (!nodes.length) return { x: 0, y: 0, w: 0, h: 0 };
  const left = Math.min(...nodes.map((node) => node.x));
  const top = Math.min(...nodes.map((node) => node.y));
  const right = Math.max(...nodes.map((node) => node.x + node.w));
  const bottom = Math.max(...nodes.map((node) => node.y + node.h));
  return { x: left, y: top, w: right - left, h: bottom - top };
}
