import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    label: 'git 상태',
    detached: '브랜치 없음',
    noChanges: '변경 없음',
    changes: (added: string, deleted: string) => `추가 ${added}줄, 삭제 ${deleted}줄`,
    openPr: (n: number) => `PR #${n} 브라우저에서 열기`,
    passing: 'CI 통과',
    failing: 'CI 실패',
    pending: 'CI 진행 중',
  },
  en: {
    label: 'Git status',
    detached: 'No branch',
    noChanges: 'No changes',
    changes: (added: string, deleted: string) => `${added} lines added, ${deleted} removed`,
    openPr: (n: number) => `Open PR #${n} in the browser`,
    passing: 'CI passing',
    failing: 'CI failing',
    pending: 'CI running',
  },
});
