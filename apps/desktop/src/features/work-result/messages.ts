import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    title: '작업 결과',
    open: '작업 결과 열기',
    openWithFiles: (n: string) => `작업 결과 열기, 바뀐 파일 ${n}개`,
    close: '작업 결과 닫기',
    resize: '작업 결과 너비',
    files: '바뀐 파일',
    commands: '실행한 명령',
    nothingYet: '아직 바뀐 파일이나 실행한 명령이 없어요',
    showChanges: (file: string) => `${file} 바뀐 내용`,
    running: '실행 중',
    done: '끝남',
    failed: '실패',
    interrupted: '중단됨',
  },
  en: {
    title: 'Work result',
    open: 'Open work result',
    openWithFiles: (n: string) => `Open work result, ${n} files changed`,
    close: 'Close work result',
    resize: 'Work result width',
    files: 'Changed files',
    commands: 'Commands run',
    nothingYet: 'No files changed and no commands run yet',
    showChanges: (file: string) => `Changes to ${file}`,
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    interrupted: 'Stopped',
  },
});
