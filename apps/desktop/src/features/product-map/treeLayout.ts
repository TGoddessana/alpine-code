import { tally, worst, type PromiseStatus, type TreeMap } from './flowTreeModel';

/**
 * The person-first map as an even grid. Each journey is one row read left to right: its card, then its steps in the
 * order they are walked. The rows of one person sit together beside a band that names the person and how they come
 * in. Every card of a kind has the same size and says what it is on its own (a step card carries its own promises in
 * short), so the map stays even however much of it there is.
 */

export type NodeKind = 'product' | 'person' | 'journey' | 'step' | 'addJourney' | 'addPerson';

export interface LaidNode {
  id: string;
  kind: NodeKind;
  /** What a line runs from: a step's parent is the card before it in its row; a journey's is its person. */
  parent: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  personId?: string;
  journeyId?: string;
  cardId?: string;
  /** 0-based place in its row or column (step number, journey number). */
  index: number;
  status?: PromiseStatus | null;
}

export const CARD_H = 168;
export const PERSON_W = 236;
export const JOURNEY_W = 252;
export const STEP_W = 240;
/** Room between cards in a row; the arrow from one step to the next runs in it. */
export const COLUMN_GAP = 44;
const ROW_GAP = 16;
const PERSON_GAP = 40;
const ADD_H = 44;
const PRODUCT_H = 64;
const PRODUCT_GAP = 32;

export const stepId = (journeyId: string, cardId: string) => `step:${journeyId}/${cardId}`;

export function layoutTree(map: TreeMap): LaidNode[] {
  const nodes: LaidNode[] = [];
  const xJourney = PERSON_W + COLUMN_GAP;
  const xStep = xJourney + JOURNEY_W + COLUMN_GAP;
  const widest = Math.max(1, ...map.people.flatMap((person) => person.journeys.map((journey) => journey.steps.length)));
  nodes.push({
    id: 'product',
    kind: 'product',
    parent: null,
    x: 0,
    y: 0,
    w: xStep + widest * (STEP_W + COLUMN_GAP) - COLUMN_GAP,
    h: PRODUCT_H,
    index: 0,
  });

  let y = PRODUCT_H + PRODUCT_GAP;
  map.people.forEach((person, personIndex) => {
    const top = y;
    const personNode = `person:${person.id}`;
    person.journeys.forEach((journey, journeyIndex) => {
      const journeyNode = `journey:${journey.id}`;
      nodes.push({
        id: journeyNode,
        kind: 'journey',
        parent: personNode,
        x: xJourney,
        y,
        w: JOURNEY_W,
        h: CARD_H,
        personId: person.id,
        journeyId: journey.id,
        index: journeyIndex,
      });
      let previous = journeyNode;
      journey.steps.forEach((cardId, stepIndex) => {
        const card = map.cards[cardId];
        if (!card) return;
        const id = stepId(journey.id, cardId);
        nodes.push({
          id,
          kind: 'step',
          parent: previous,
          x: xStep + stepIndex * (STEP_W + COLUMN_GAP),
          y,
          w: STEP_W,
          h: CARD_H,
          personId: person.id,
          journeyId: journey.id,
          cardId,
          index: stepIndex,
          status: worst(tally(card.promises)),
        });
        previous = id;
      });
      y += CARD_H + ROW_GAP;
    });
    nodes.push({
      id: `add-journey:${person.id}`,
      kind: 'addJourney',
      parent: personNode,
      x: xJourney,
      y,
      w: JOURNEY_W,
      h: ADD_H,
      personId: person.id,
      index: person.journeys.length,
    });
    y += ADD_H;
    // The band spans every row of the person, down to their "+" row.
    nodes.push({
      id: personNode,
      kind: 'person',
      parent: 'product',
      x: 0,
      y: top,
      w: PERSON_W,
      h: Math.max(CARD_H, y - top),
      personId: person.id,
      index: personIndex,
    });
    y += PERSON_GAP;
  });
  nodes.push({
    id: 'add-person',
    kind: 'addPerson',
    parent: 'product',
    x: 0,
    y,
    w: PERSON_W,
    h: ADD_H + 12,
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
