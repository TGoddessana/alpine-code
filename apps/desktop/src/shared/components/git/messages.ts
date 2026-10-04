import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    label: 'git 상태',
    local: '로컬',
    noGit: 'git 없음',
    noChanges: '변경 없음',
    changes: (added: string, deleted: string) => `추가 ${added}줄, 삭제 ${deleted}줄`,
    openPr: (n: number) => `PR #${n} 브라우저에서 열기`,
    passing: '자동 검사 통과',
    failing: '자동 검사 실패',
    pending: '자동 검사 중',
  },
  en: {
    label: 'Git status',
    local: 'Local',
    noGit: 'No git',
    noChanges: 'No changes',
    changes: (added: string, deleted: string) => `${added} lines added, ${deleted} removed`,
    openPr: (n: number) => `Open PR #${n} in the browser`,
    passing: 'Checks passing',
    failing: 'Checks failing',
    pending: 'Checks running',
  },
});
