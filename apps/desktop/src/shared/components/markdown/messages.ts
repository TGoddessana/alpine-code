import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    copy: '복사',
    copied: '복사했어요',
    copyCode: (language: string) => (language ? `${language} 코드 복사` : '코드 복사'),
    image: (label: string) => `이미지: ${label}`,
  },
  en: {
    copy: 'Copy',
    copied: 'Copied',
    copyCode: (language: string) => (language ? `Copy ${language} code` : 'Copy code'),
    image: (label: string) => `Image: ${label}`,
  },
});
