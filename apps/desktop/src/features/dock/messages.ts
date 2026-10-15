import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    title: '오른쪽 창',
    open: '오른쪽 창 열기',
    openWithFiles: (n: string) => `오른쪽 창 열기, 바뀐 파일 ${n}개`,
    close: '오른쪽 창 닫기',
    resize: '오른쪽 창 너비',
    expand: '크게 보기',
    shrink: '작게 보기',
    conversation: '작업 내용',
  },
  en: {
    title: 'Side panel',
    open: 'Open side panel',
    openWithFiles: (n: string) => `Open side panel, ${n} files changed`,
    close: 'Close side panel',
    resize: 'Side panel width',
    expand: 'Enlarge',
    shrink: 'Shrink',
    conversation: 'Work details',
  },
});
