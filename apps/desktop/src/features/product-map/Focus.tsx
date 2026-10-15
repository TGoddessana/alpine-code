import type { FlowGetResult } from '@alpine/protocol';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { conditionResults, mapOf, PROBLEM_ISSUES, verification } from './model';

export type FocusKind = 'regressed' | 'failed' | 'question' | 'recheck' | 'must' | 'noPromises';

/**
 * The features that most need a look, in the order to take them: broke again, failed must-haves, failed, rules to
 * confirm, outdated must-haves, outdated, must-have but unchecked, built but unpromised.
 */
export function focusItems(board: FlowGetResult) {
  const ranked: { rank: number; kind: FocusKind; nodeId: string }[] = [];
  for (const node of mapOf(board).nodes ?? []) {
    const state = board.states?.[node.id];
    const { status } = verification(node, state);
    const must = node.priority === 'must';
    const promises = Object.values(state?.promises ?? {});
    const add = (rank: number, kind: FocusKind) => ranked.push({ rank, kind, nodeId: node.id });
    if (promises.some((p) => p.issue === 'regressed')) add(0, 'regressed');
    else if (status === 'failed') add(must ? 1 : 2, 'failed');
    else if (status === 'question') add(3, 'question');
    else if (status === 'recheck' || state?.changed) add(must ? 4 : 5, 'recheck');
    else if (status === 'unconfirmed' && must) add(6, 'must');
    else if (status === 'none' && node.phase === 'built') add(7, 'noPromises');
  }
  return ranked.sort((a, b) => a.rank - b.rank).map(({ kind, nodeId }) => ({ kind, nodeId }));
}

/** The features whose files changed or that need another look, in the order of the look-first list. */
export function recheckIds(board: FlowGetResult) {
  const order = focusItems(board).map((item) => item.nodeId);
  const ids = (mapOf(board).nodes ?? [])
    .filter((node) => {
      const state = board.states?.[node.id];
      return state?.status === 'recheck' || !!state?.changed;
    })
    .map((node) => node.id);
  const place = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
  return ids.sort((a, b) => place(a) - place(b));
}

/** Short tag and full reason per listed feature, for the card tag (a failing feature's full reason says what is wrong). */
export function useFocusReasons() {
  const t = useMessages(messages);
  const short: Record<FocusKind, string> = {
    regressed: t.focusRegressedShort,
    failed: t.focusFailedShort,
    question: t.focusQuestionShort,
    recheck: t.focusRecheckShort,
    must: t.focusMustShort,
    noPromises: t.focusNoPromisesShort,
  };
  const full: Record<FocusKind, string> = {
    regressed: t.focusRegressed,
    failed: t.focusFailed,
    question: t.focusQuestion,
    recheck: t.focusRecheck,
    must: t.focusMust,
    noPromises: t.focusNoPromises,
  };
  return (board: FlowGetResult, kind: FocusKind, nodeId: string) => {
    const node = mapOf(board).nodes?.find((n) => n.id === nodeId);
    const failed =
      node && conditionResults(node, board.states?.[node.id]).find((r) => PROBLEM_ISSUES.includes(r.promise?.issue));
    return {
      short: short[kind],
      full: kind === 'failed' ? failed?.condition.expectation || full.failed : full[kind],
    };
  };
}

/** One row of the panel's lists (flows, code changes): what, how many, 보기. */
export const lookRow =
  'flex min-h-8 w-full cursor-pointer items-center gap-3 border-t border-line-subtle px-2 text-left text-body hover:bg-hover';
