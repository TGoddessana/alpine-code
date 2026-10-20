/**
 * The product map read person first: who uses the product, the journeys each of them takes, the steps of a journey
 * (the map's cards) and, hanging off every step, its promises ("when this happens, this must happen") as branches.
 * A journey, a step and a person carry no status of their own: every status is counted from the promises below, so
 * nothing above a promise can drift from what was checked.
 */

/**
 * `recheck`: it passed, but a file its check depended on changed since, so the pass no longer counts until checked
 * again (the map keeps each check's file hashes).
 */
export type PromiseStatus = 'failed' | 'recheck' | 'checking' | 'blocked' | 'unconfirmed' | 'planned' | 'passed';

/** Worst first: a row shows the first of these that any promise under it has. */
export const STATUS_ORDER: PromiseStatus[] = [
  'failed',
  'recheck',
  'checking',
  'blocked',
  'unconfirmed',
  'planned',
  'passed',
];

export interface TreePromise {
  id: string;
  /** The situation, e.g. "연결 문자열에 값을 적지 않으면". Empty for a promise that holds always. */
  when: string;
  /** What must happen then, in plain words. */
  then: string;
  status: PromiseStatus;
  /** The last check's own sentence: what was seen, or why it could not be checked. */
  note: string;
  checkedAt: string | null;
  /** What the last check tried, in order (해본 것). */
  steps?: string[];
  /** What it saw while trying (본 것). */
  seen?: string[];
  /** What it could not check (확인 못 한 것). */
  limits?: string[];
  /** Where it was checked, e.g. "로컬 개발 서버". */
  environment?: string;
  /** Every result the map recorded for it, oldest first. */
  history?: { at: string; result: string }[];
  /** For `recheck`: the files that changed since the check. */
  changedFiles?: string[];
  /** The person's call (set only by a person): how much it matters, and whether it is for now. */
  priority?: 'must' | 'should' | 'later';
}

/** What a card is, read from the code: something a person sees, an API, a library call, or work done on its own. */
export type CardKind = 'screen' | 'api' | 'sdk' | 'process' | 'data';

export interface TreeCard {
  id: string;
  title: string;
  promises: TreePromise[];
  /** One or two plain sentences of what it does, written from the code. */
  description?: string;
  kind?: CardKind;
  tags?: string[];
  /** The files it lives in, most telling first. */
  sources?: string[];
  /** What a person needs to try it themselves. */
  howToTry?: string;
  example?: string;
  /** The person's own calls on the card, which only a person sets: how much it matters, and when. */
  priority?: 'must' | 'should' | 'later' | null;
  scope?: 'now' | 'next' | 'out' | null;
  /** A one-line note of what the person decided. */
  decision?: string;
  /** The conversation last started on this card. */
  sessionId?: string | null;
}

export interface Localized {
  ko: string;
  en: string;
}

export interface Journey {
  id: string;
  title: Localized;
  /** One sentence of what the journey lets the person do. */
  goal: Localized;
  /** Who starts the journey and what they do first. */
  trigger?: Localized;
  /**
   * Card ids in the order the map lists them, or `flow:<journey id>` for a step that goes through another journey.
   * A card may sit in several journeys.
   */
  steps: string[];
  /** How the steps lead to one another: branches (several ways on), merges and loops back, each with its condition. */
  edges?: { from: string; to: string; label: string }[];
}

export interface Person {
  id: string;
  name: Localized;
  role: Localized;
  /** How this person enters the product: the first thing they do. */
  start: Localized;
  /** Which avatar colour (1-5) the person wears. */
  tone: 1 | 2 | 3 | 4 | 5;
  journeys: Journey[];
}

export interface TreeChange {
  at: string;
  kind: string;
  cardId: string;
  detail: string;
}

export interface TreeMap {
  product: string;
  people: Person[];
  cards: Record<string, TreeCard>;
  recent: TreeChange[];
}

export type Tally = Record<PromiseStatus, number> & { total: number };

const emptyTally = (): Tally => ({
  failed: 0,
  recheck: 0,
  checking: 0,
  blocked: 0,
  unconfirmed: 0,
  planned: 0,
  passed: 0,
  total: 0,
});

export function tally(promises: TreePromise[]): Tally {
  const counts = emptyTally();
  for (const promise of promises) {
    counts[promise.status] += 1;
    counts.total += 1;
  }
  return counts;
}

export function addTallies(tallies: Tally[]): Tally {
  const sum = emptyTally();
  for (const one of tallies) for (const key of [...STATUS_ORDER, 'total'] as const) sum[key] += one[key];
  return sum;
}

/** The status a row shows: the worst under it, or none for a row with no promises yet. */
export function worst(counts: Tally): PromiseStatus | null {
  return STATUS_ORDER.find((status) => counts[status] > 0) ?? null;
}

export const isJourneyLink = (step: string) => step.startsWith('flow:');

export function cardTally(map: TreeMap, cardId: string): Tally {
  return tally(map.cards[cardId]?.promises ?? []);
}

/** A card shared by two journeys counts once in each journey, and once for the person. */
export function journeyTally(map: TreeMap, journey: Journey): Tally {
  return addTallies(journey.steps.filter((id) => !isJourneyLink(id)).map((id) => cardTally(map, id)));
}

export function personTally(map: TreeMap, person: Person): Tally {
  return addTallies([...personCards(person)].map((id) => cardTally(map, id)));
}

export function personCards(person: Person): Set<string> {
  return new Set(person.journeys.flatMap((journey) => journey.steps.filter((id) => !isJourneyLink(id))));
}

/** The other journeys (of anyone) a card also appears in, so editing it says who else it touches. */
export function otherJourneys(map: TreeMap, cardId: string, except: string) {
  return map.people.flatMap((person) =>
    person.journeys
      .filter((journey) => journey.id !== except && journey.steps.includes(cardId))
      .map((journey) => ({ person, journey })),
  );
}

export function promisesWith(map: TreeMap, person: Person, statuses: PromiseStatus[]) {
  return [...personCards(person)].flatMap((cardId) =>
    (map.cards[cardId]?.promises ?? [])
      .filter((promise) => statuses.includes(promise.status))
      .map((promise) => ({ cardId, promise })),
  );
}

export function updatePromises(
  map: TreeMap,
  change: (cardId: string, promise: TreePromise) => TreePromise | null,
): TreeMap {
  const cards: Record<string, TreeCard> = {};
  for (const [id, card] of Object.entries(map.cards))
    cards[id] = {
      ...card,
      promises: card.promises.flatMap((promise) => {
        const next = change(id, promise);
        return next ? [next] : [];
      }),
    };
  return { ...map, cards };
}
