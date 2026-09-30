import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    label: '주 메뉴',
    newSession: '새 세션',
    projects: '프로젝트',
    openFolder: '폴더 열기',
    settings: '설정',
    projectMenu: (name: string) => `${name} 메뉴`,
    revealInFinder: 'Finder에서 열기',
    hide: '레일에서 숨기기',
    resize: '주 메뉴 너비',
  },
  en: {
    label: 'Main menu',
    newSession: 'New session',
    projects: 'Projects',
    openFolder: 'Open folder',
    settings: 'Settings',
    projectMenu: (name: string) => `${name} menu`,
    revealInFinder: 'Show in Finder',
    hide: 'Hide from the rail',
    resize: 'Main menu width',
  },
});
