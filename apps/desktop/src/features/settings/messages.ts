import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    title: '설정',
    general: '일반',
    connection: '모델 연결',
    usage: '사용량',
    harness: '모델과 하네스',
    language: '언어',
    server: '서버',
    serverVersion: (name: string, version: string, protocol: number) => `${name} ${version} · 프로토콜 ${protocol}`,
    serverUnavailable: '서버에 연결하지 못했어요',
  },
  en: {
    title: 'Settings',
    general: 'General',
    connection: 'Model connection',
    usage: 'Usage',
    harness: 'Models and harness',
    language: 'Language',
    server: 'Server',
    serverVersion: (name: string, version: string, protocol: number) => `${name} ${version} · protocol ${protocol}`,
    serverUnavailable: "Couldn't reach the server",
  },
});
