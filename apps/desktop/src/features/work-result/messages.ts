import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    title: '작업 결과',
    files: '바뀐 파일',
    commands: '실행한 명령',
    notConnected: '아직 연결된 작업이 없어요',
    nothingYet: '아직 바뀐 파일이나 실행한 명령이 없어요',
    showChanges: (file: string) => `${file} 바뀐 내용`,
    running: '실행 중',
    done: '끝남',
    failed: '실패',
    interrupted: '중단됨',
  },
  en: {
    title: 'Work result',
    files: 'Changed files',
    commands: 'Commands run',
    notConnected: 'No work is connected yet',
    nothingYet: 'No files changed and no commands run yet',
    showChanges: (file: string) => `Changes to ${file}`,
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    interrupted: 'Stopped',
  },
});
