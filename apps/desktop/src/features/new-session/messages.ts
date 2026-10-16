import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    start: '시작하기',
    whichProject: '어떤 프로젝트로 시작할까요?',
    dropHint: '폴더를 이 창에 끌어다 놓아도 돼요.',

    newSession: '새 세션',
    heading: '무엇을 만들어 볼까요?',
    lead: (project: string) =>
      `${project} 폴더에서 일해요. 무엇을 바꿨는지, 잘 돌아가는지 확인했는지도 함께 알려 드려요.`,
    example1Title: '이 프로젝트가 뭔지 쉽게 설명해 줘',
    example1Hint: '어떤 화면이 있고 어디를 고치면 되는지',
    example2Title: '화면을 휴대폰에서 보기 좋게 바꿔 줘',
    example2Hint: '글자 크기, 버튼 크기, 사진 배치',
    example3Title: '지금 잘 돌아가는지 확인해 줘',
    example3Hint: '바꾸지는 않고 실행해 보고 알려 줘요',
    example4Title: '고치고 싶은 걸 말하면 어디를 바꾸면 되는지 알려 줘',
    example4Hint: '파일을 바꾸기 전에 계획부터',
    importHeading: 'Claude Code나 Codex에서 하던 대화 이어 하기',
    importShowAll: (count: string) => `${count}개 모두 보기`,
    importing: '가져오는 중…',
    importFailed: (message: string) => `대화를 가져오지 못했어요 · ${message}`,
    project: '프로젝트',
  },
  en: {
    start: 'Get started',
    whichProject: 'Which project do you want to start with?',
    dropHint: 'You can also drop a folder on this window.',

    newSession: 'New session',
    heading: 'What shall we build?',
    lead: (project: string) =>
      `Working in the ${project} folder. I'll also tell you what changed and whether I checked that it runs.`,
    example1Title: 'Explain what this project is, simply',
    example1Hint: 'What screens it has and where to change them',
    example2Title: 'Make the screen look good on a phone',
    example2Hint: 'Text size, button size, photo layout',
    example3Title: 'Check that it runs right now',
    example3Hint: "Nothing gets changed, I'll run it and report back",
    example4Title: 'Tell me where to change what I want fixed',
    example4Hint: 'A plan first, before any file changes',
    importHeading: 'Continue a conversation from Claude Code or Codex',
    importShowAll: (count: string) => `Show all ${count}`,
    importing: 'Bringing it over…',
    importFailed: (message: string) => `Couldn't bring the conversation over · ${message}`,
    project: 'Project',
  },
});
