import { defineMessages } from '@/shared/i18n';

export const messages = defineMessages({
  ko: {
    message: '메시지',
    placeholder: '무엇을 할까요?',
    send: '보내기',
    stop: '멈추기',
    working: '작업 중이에요. 끝나면 이어서 보낼 수 있어요',
    connectModel: '모델 연결',
    chooseModel: '모델 고르기',
    modelLabel: (model: string) => `새 세션 모델: ${model}`,
    running: '이미 작업 중이에요. 끝나면 다시 보내 주세요',
    failed: '보내지 못했어요. 잠시 뒤에 다시 시도해 주세요',
  },
  en: {
    message: 'Message',
    placeholder: 'What should Alpine do?',
    send: 'Send',
    stop: 'Stop',
    working: 'Working. You can send again when it finishes',
    connectModel: 'Connect a model',
    chooseModel: 'Choose a model',
    modelLabel: (model: string) => `New session model: ${model}`,
    running: 'Already working. Send again when it finishes',
    failed: "Couldn't send. Please try again in a moment",
  },
});
