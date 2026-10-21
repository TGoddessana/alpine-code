import type { FlowGetResult, FlowNode, NodeState, ProductMap, PromiseState } from '@alpine/protocol';

/**
 * How far a feature's promises are known to hold, worst first. The server computes it: a finished chat or a build
 * never counts, only a current, linked check does, and an open issue always wins. `question` means only promises the
 * AI guessed at failed, so the user is asked whether they are rules at all.
 */
export type Verification = NodeState['status'];

const EMPTY_MAP: ProductMap = {};
/** The map of a result; the server always sends one, an empty map stands in for a result that has none. */
export const mapOf = (board: FlowGetResult): ProductMap => board.document ?? EMPTY_MAP;

/** The check a promise currently shows: the newest one written for it. */
function currentCheck(node: FlowNode, conditionId: string) {
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

/** Title, description, tags and promise wording, so a search finds a feature by what it is supposed to do. */
function matchesQuery(node: FlowNode, needle: string) {
  if (!needle) return true;
  const texts = [
    node.title,
    node.description ?? '',
    ...(node.tags ?? []),
    ...(node.conditions ?? []).map((c) => c.expectation ?? ''),
  ];
  return texts.some((text) => text.toLowerCase().includes(needle));
}

/**
 * The cards a search finds (by title, description, tags or promise wording), or null when nothing is searched. The
 * map lights them and quiets the rest: cards are never removed, because removing a step would break its journey.
 */
export function matchingIds(document: ProductMap, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;
  return new Set((document.nodes ?? []).filter((node) => matchesQuery(node, needle)).map((node) => node.id));
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
