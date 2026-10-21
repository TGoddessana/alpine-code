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
    mapSummaryEmpty: '지도에서 확인이나 수정을 시작하면 AI와 나누는 이야기가 여기 보여요.',
    more: '더보기',
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
    mapSummaryEmpty: 'When you start a check or a change on the map, the conversation with the AI shows here.',
    more: 'More',
  },
});
