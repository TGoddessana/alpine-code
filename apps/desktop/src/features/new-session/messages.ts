import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    start: '시작하기',
    whichProject: '어떤 프로젝트로 시작할까요?',
    dropHint: '폴더를 이 창에 끌어다 놓아도 돼요.',

    newSession: '새 세션',
    heading: '무엇을 바꿔 볼까요?',
    placeholder: '첫 화면 버튼을 더 크게 해 줘',
    suggestion1: '이 프로젝트가 뭔지 쉽게 설명해 줘',
    suggestion2: '화면을 휴대폰에서 보기 좋게 바꿔 줘',
    suggestion3: '지금 잘 돌아가는지 확인해 줘',
    importFrom: (apps: string | null) => `${apps ?? '다른 앱'}에서 하던 대화`,
    importLink: (apps: string | null, count: string) => `${apps ?? '다른 앱'}에서 하던 대화 ${count}개 이어 하기`,
    importApps: (apps: string[]) => apps.join('·'),
    importing: '가져오는 중…',
    importFailed: (message: string) => `대화를 가져오지 못했어요 · ${message}`,
    close: '닫기',
  },
  en: {
    start: 'Get started',
    whichProject: 'Which project do you want to start with?',
    dropHint: 'You can also drop a folder on this window.',

    newSession: 'New session',
    heading: 'What shall we change?',
    placeholder: 'Make the buttons on the first screen bigger',
    suggestion1: 'Explain what this project is, simply',
    suggestion2: 'Make the screen look good on a phone',
    suggestion3: 'Check that it runs right now',
    importFrom: (apps: string | null) => `Conversations from ${apps ?? 'other apps'}`,
    importLink: (apps: string | null, count: string) => `Continue ${count} conversations from ${apps ?? 'other apps'}`,
    importApps: (apps: string[]) => apps.join(' and '),
    importing: 'Bringing it over…',
    importFailed: (message: string) => `Couldn't bring the conversation over · ${message}`,
    close: 'Close',
  },
});
