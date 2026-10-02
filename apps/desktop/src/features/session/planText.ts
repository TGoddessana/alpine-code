import type { PlanUpdateDetail } from '@alpine/protocol';

import type { messages } from './messages';

type Messages = (typeof messages)['en'];

/**
 * What a plan call changed, in one line: the first plan's size ("5단계 세움 · 확인 3개"), then only what moved
 * ("'원인 찾기' 끝냄 · '고치기' 시작", "'재현 테스트 먼저' 뺌"). The right panel has the whole list.
 */
export function planChangeText(t: Messages, detail: PlanUpdateDetail, number: (n: number) => string): string {
  if (detail.created) {
    const parts = [t.planCreated(number(detail.steps))];
    if (detail.checks > 0) parts.push(t.planChecks(number(detail.checks)));
    return parts.join(' · ');
  }
  const parts = [
    ...detail.finished.map(t.planFinished),
    ...detail.started.map(t.planStarted),
    ...detail.reopened.map(t.planReopened),
    ...detail.added.filter((step) => !detail.started.includes(step)).map(t.planAdded),
    ...detail.renamed.map(({ before, after }) => t.planRenamed(before, after)),
    ...detail.dropped.map(t.planDropped),
  ];
  if (detail.checksChanged) parts.push(t.planChecksChanged(number(detail.checks)));
  return parts.length ? parts.join(' · ') : t.planSame;
}
