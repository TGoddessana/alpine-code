import { tally, worst, type PromiseStatus, type TreeMap } from './flowTreeModel';

/**
 * Where every node of the person-first tree sits on the canvas, left to right: the product, the people who use it,
 * each person's journeys, and each journey's steps in a row (the way the person walks it). A step's promises hang
 * below it as branches. Only what is open is laid out; a closed node shows its summary instead of its children.
 */

export type NodeKind =
  'product' | 'person' | 'journey' | 'step' | 'promise' | 'addPromise' | 'addJourney' | 'addPerson';

export interface LaidNode {
  id: string;
  kind: NodeKind;
  /** The node it grows out of: a step's parent is the step before it, so a journey reads as one line. */
  parent: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  personId?: string;
  journeyId?: string;
  cardId?: string;
  promiseId?: string;
  /** 0-based position among its siblings (step number, promise order). */
  index: number;
  /** For a promise: its status, which also colours the branch line into it. */
  status?: PromiseStatus | null;
}

export const SIZES: Record<NodeKind, { w: number; h: number }> = {
  product: { w: 184, h: 72 },
  person: { w: 256, h: 104 },
  journey: { w: 248, h: 104 },
  step: { w: 224, h: 104 },
  promise: { w: 280, h: 44 },
  addPromise: { w: 132, h: 32 },
  addJourney: { w: 248, h: 40 },
  addPerson: { w: 256, h: 40 },
};

const COLUMN_GAP = 88;
const STEP_GAP = 56;
const ROW_GAP = 32;
const PEOPLE_GAP = 20;
const LEAF_TOP = 18;
const LEAF_GAP = 8;
/** How far right of its step a promise starts; the branch line runs down this gutter. */
export const LEAF_INDENT = 32;
export const BRANCH_X = 14;

export interface Openness {
  people: Set<string>;
  journeys: Set<string>;
  steps: Set<string>;
}

export const stepId = (journeyId: string, cardId: string) => `step:${journeyId}/${cardId}`;
export const promiseNodeId = (journeyId: string, cardId: string, promiseId: string) =>
  `promise:${journeyId}/${cardId}/${promiseId}`;

export function layoutTree(map: TreeMap, open: Openness): LaidNode[] {
  const nodes: LaidNode[] = [];
  const xPerson = SIZES.product.w + COLUMN_GAP;
  const xJourney = xPerson + SIZES.person.w + COLUMN_GAP;
  const xStep = xJourney + SIZES.journey.w + COLUMN_GAP;
  const product: LaidNode = { id: 'product', kind: 'product', parent: null, x: 0, y: 0, ...SIZES.product, index: 0 };
  nodes.push(product);

  // The people stay one compact column, so everyone who uses the product is always in sight. An open person's
  // journeys start level with them in the next column, below the journeys of anyone opened above.
  let peopleY = 0;
  let y = 0;
  map.people.forEach((person, personIndex) => {
    const personNode = `person:${person.id}`;
    const personY = peopleY;
    peopleY += SIZES.person.h + PEOPLE_GAP;
    nodes.push({
      id: personNode,
      kind: 'person',
      parent: 'product',
      x: xPerson,
      y: personY,
      ...SIZES.person,
      personId: person.id,
      index: personIndex,
    });
    if (!open.people.has(person.id)) return;
    y = Math.max(y, personY);
    person.journeys.forEach((journey, journeyIndex) => {
      const journeyNode = `journey:${journey.id}`;
      nodes.push({
        id: journeyNode,
        kind: 'journey',
        parent: personNode,
        x: xJourney,
        y,
        ...SIZES.journey,
        personId: person.id,
        journeyId: journey.id,
        index: journeyIndex,
      });
      let rowHeight = SIZES.journey.h;
      if (open.journeys.has(journey.id)) {
        let previous = journeyNode;
        journey.steps.forEach((cardId, stepIndex) => {
          const card = map.cards[cardId];
          if (!card) return;
          const id = stepId(journey.id, cardId);
          const x = xStep + stepIndex * (SIZES.step.w + STEP_GAP);
          nodes.push({
            id,
            kind: 'step',
            parent: previous,
            x,
            y,
            ...SIZES.step,
            personId: person.id,
            journeyId: journey.id,
            cardId,
            index: stepIndex,
            status: worst(tally(card.promises)),
          });
          previous = id;
          if (!open.steps.has(id)) return;
          let leafY = y + SIZES.step.h + LEAF_TOP;
          card.promises.forEach((promise, promiseIndex) => {
            nodes.push({
              id: promiseNodeId(journey.id, cardId, promise.id),
              kind: 'promise',
              parent: id,
              x: x + LEAF_INDENT,
              y: leafY,
              ...SIZES.promise,
              personId: person.id,
              journeyId: journey.id,
              cardId,
              promiseId: promise.id,
              index: promiseIndex,
              status: promise.status,
            });
            leafY += SIZES.promise.h + LEAF_GAP;
          });
          nodes.push({
            id: `add-promise:${journey.id}/${cardId}`,
            kind: 'addPromise',
            parent: id,
            x: x + LEAF_INDENT,
            y: leafY,
            ...SIZES.addPromise,
            personId: person.id,
            journeyId: journey.id,
            cardId,
            index: card.promises.length,
          });
          rowHeight = Math.max(rowHeight, leafY + SIZES.addPromise.h - y);
        });
      }
      y += rowHeight + ROW_GAP;
    });
    nodes.push({
      id: `add-journey:${person.id}`,
      kind: 'addJourney',
      parent: personNode,
      x: xJourney,
      y,
      ...SIZES.addJourney,
      personId: person.id,
      index: person.journeys.length,
    });
    y += SIZES.addJourney.h + ROW_GAP + PEOPLE_GAP;
  });
  nodes.push({
    id: 'add-person',
    kind: 'addPerson',
    parent: 'product',
    x: xPerson,
    y: peopleY,
    ...SIZES.addPerson,
    index: map.people.length,
  });
  // The product sits level with the middle of its people, so the lines fan out evenly.
  product.y = Math.max(0, (peopleY - PEOPLE_GAP - SIZES.product.h) / 2);
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
