import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    idle: '기다리는 중',
    running: '작업 중',
    waiting: '확인이 필요해요',
    failed: '멈췄어요',
  },
  en: {
    idle: 'Idle',
    running: 'Working',
    waiting: 'Needs your OK',
    failed: 'Stopped',
  },
});
