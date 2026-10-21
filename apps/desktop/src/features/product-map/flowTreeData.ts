import type { FlowGetResult, FlowNode, ProductFlow, SessionInfo } from '@alpine/protocol';

import type { Journey, Person, PromiseStatus, TreeCard, TreeMap, TreePromise } from './flowTreeModel';

/**
 * The person-first tree from what the server sends for the map (`flow/get`): cards with their promises and the state
 * Alpine computed for each (passed, broken, recheck because files changed…), journeys with their edges, and the
 * recent changes. Who walks which journey comes from each journey's `actor`; journeys without one are grouped
 * together until the map names them.
 */
export function toTreeMap(
  result: FlowGetResult,
  sessions: SessionInfo[],
  product: string,
  words: { unnamed: Person['name']; unnamedRole: Person['role'] },
): TreeMap {
  const document = result.document ?? {};
  const cards: Record<string, TreeCard> = {};
  for (const node of document.nodes ?? []) cards[node.id] = toCard(node, result, sessions);

  const groups = new Map<string, ProductFlow[]>();
  for (const flow of document.flows ?? []) {
    const actor = flow.actor?.trim() ?? '';
    groups.set(actor, [...(groups.get(actor) ?? []), flow]);
  }
  const people: Person[] = [...groups].map(([actor, flows], index) => ({
    id: actor ? `actor:${actor}` : 'actor:',
    name: actor ? { ko: actor, en: actor } : words.unnamed,
    role: actor ? { ko: '', en: '' } : words.unnamedRole,
    start: { ko: flows[0]?.trigger ?? '', en: flows[0]?.trigger ?? '' },
    tone: ((index % 5) + 1) as Person['tone'],
    journeys: flows.map(toJourney),
  }));

  return {
    product,
    people,
    cards,
    recent: (result.changes ?? []).map((change) => ({
      at: change.at,
      kind: change.kind,
      cardId: change.nodeId,
      detail: change.detail ?? '',
    })),
  };
}

function toJourney(flow: ProductFlow): Journey {
  const text = (value: string | undefined) => ({ ko: value ?? '', en: value ?? '' });
  return {
    id: flow.id,
    title: text(flow.title),
    goal: text(flow.description),
    trigger: text(flow.trigger),
    steps: flow.nodeIds ?? [],
    edges: (flow.edges ?? []).map((edge) => ({ from: edge.source, to: edge.target, label: edge.label ?? '' })),
  };
}

function toCard(node: FlowNode, result: FlowGetResult, sessions: SessionInfo[]): TreeCard {
  const state = result.states?.[node.id];
  const session = sessions.find((candidate) => candidate.id === node.sessionId);
  const working = session?.status === 'running' || session?.status === 'waiting';
  const promises: TreePromise[] = (node.conditions ?? []).map((condition) => {
    const promise = state?.promises?.[condition.id];
    const check = [...(node.checks ?? [])].reverse().find((item) => item.conditionId === condition.id);
    const status: PromiseStatus =
      working && promise?.status !== 'passed' ? 'checking' : (promise?.status ?? 'unconfirmed');
    return {
      id: condition.id,
      when: '',
      then: condition.expectation,
      status,
      note: check?.plain || check?.summary || '',
      checkedAt: promise?.stamp?.at ?? null,
      steps: check?.steps ?? [],
      seen: (check?.observations ?? []).map((observation) => observation.label ?? ''),
      limits: check?.limits ?? [],
      environment: check?.environment ?? '',
      changedFiles: promise?.changed ?? [],
    };
  });
  return {
    id: node.id,
    title: node.title,
    promises,
    description: node.description ?? '',
    kind: node.kind ?? 'process',
    tags: node.tags ?? [],
    sources: node.sources ?? [],
    howToTry: node.howToTry ?? '',
    example: node.example ?? '',
    priority: node.priority ?? null,
    scope: node.scope ?? null,
    decision: node.decision ?? '',
    sessionId: node.sessionId ?? null,
    screen: result.previews?.[node.id]
      ? { src: result.previews[node.id]!, kind: 'shot', at: node.previewAt ?? null }
      : undefined,
  };
}
