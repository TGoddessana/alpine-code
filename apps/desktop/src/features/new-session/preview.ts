/**
 * Stand-ins for what the agent and Alpine Cloud will answer (docs/alpine-cloud.md, decisions 13 and 23). They let the
 * screen be seen in Storybook before either exists.
 */

export type TemplateId = 'blank' | 'web-lite' | 'web-pro' | 'mobile';

export interface Recommendation {
  template: TemplateId;
  /** One sentence the AI writes, in the user's language. */
  reason: string;
}

/** What the agent made of a message sent from the new-session screen. */
export type Judgement = { kind: 'change' } | ({ kind: 'new' } & Recommendation);

export type CreateStep = 'folder' | 'address' | 'agent';

export interface NewProjectApi {
  /** Is this work on the current project, or a new app? For a new app, the setup that fits and why. */
  judge: (text: string, locale: string, proReady: boolean) => Promise<Judgement>;
  /** Calls `onStep` as each step finishes and resolves with the project's name. */
  create: (
    input: { idea: string; template: TemplateId; online: boolean },
    onStep: (step: CreateStep) => void,
  ) => Promise<string>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NEW = /만들|페이지|사이트|앱|서비스|프로그램|자동화|build|make|app|site|page/i;
const CHANGE = /고쳐|바꿔|수정|크게|작게|설명해|확인해|fix|change|explain|check/i;
const PRO = /채팅|실시간|함께|같이 편집|사진|영상|기록|로그|chat|realtime|live|photo|video|log/i;
const BLANK = /자동화|스크립트|엑셀|크롤|파이썬|automat|script|excel|python/i;

export const previewNewProject: NewProjectApi = {
  judge: async (text, locale, proReady) => {
    await wait(1800);
    // When unsure, it is work on the project I am in, so a new project is never made by mistake.
    if (CHANGE.test(text) || !NEW.test(text)) return { kind: 'change' };
    const ko = locale.startsWith('ko');
    if (BLANK.test(text))
      return {
        kind: 'new',
        template: 'blank',
        reason: ko
          ? '웹 화면 없이 도는 자동화라서 빈 프로젝트가 맞아요.'
          : 'It runs without a web page, so an empty project fits.',
      };
    if (proReady && PRO.test(text))
      return {
        kind: 'new',
        template: 'web-pro',
        reason: ko
          ? '여럿이 바로바로 주고받는 기능이 있어서 Pro를 추천해요.'
          : 'People exchange things live in this idea, so Pro fits.',
      };
    return {
      kind: 'new',
      template: 'web-lite',
      reason: ko ? '로그인과 예약 저장이면 Lite로 충분해요.' : 'Sign-in and saved bookings are well within Lite.',
    };
  },
  create: async ({ online }, onStep) => {
    await wait(700);
    onStep('folder');
    if (online) {
      await wait(1600);
      onStep('address');
    }
    await wait(900);
    onStep('agent');
    return 'craft-booking';
  },
};
