import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    title: 'AI를 어떻게 쓸까요?',
    lead: '처음이라면 Alpine으로 시작하세요. 이미 쓰는 ChatGPT 구독이나 API 키가 있다면 그걸 연결해도 돼요. 설정 › 모델 연결에서 언제든 바꿀 수 있어요.',
    methods: 'AI를 쓰는 방법',
    alpine: 'Alpine으로 시작',
    alpineNote: '무료 크레딧 포함 · 설정할 것 없어요',
    continueWithAlpine: 'Alpine으로 시작하기',
    // Without Alpine Cloud the sheet only connects a model.
    connectTitle: '모델 연결',
    connectLead:
      'Alpine Code가 일할 모델을 하나 연결해 주세요. 설정 › 모델 연결에서 언제든 더 추가하거나 바꿀 수 있어요.',
    connectMethods: '연결 방식',
    later: '나중에',
    next: '다음',
  },
  en: {
    title: 'How should Alpine use AI?',
    lead: 'New here? Start with Alpine. If you already pay for ChatGPT or have an API key, connect that instead. You can change it any time in Settings › Model connection.',
    methods: 'Ways to use AI',
    alpine: 'Start with Alpine',
    alpineNote: 'Free credits included · nothing to set up',
    continueWithAlpine: 'Start with Alpine',
    connectTitle: 'Connect a model',
    connectLead:
      'Connect one model for Alpine Code to work with. You can add more or change it any time in Settings › Model connection.',
    connectMethods: 'How to connect',
    later: 'Later',
    next: 'Next',
  },
});
