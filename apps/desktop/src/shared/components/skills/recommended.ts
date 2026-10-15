import type { SkillInfo } from '@alpine/protocol';

import { ServerError } from '@/shared/server';

import type { skillMessages } from './messages';

type Words = { title: string; does: string };

/**
 * Skills Alpine suggests, said in plain words. Each is fetched from its own repository when added (`source` is what
 * `skills/add` takes); all are Apache-2.0 or MIT. Anthropic's pdf/docx/xlsx/pptx skills are left out on purpose:
 * their licence allows them only inside Anthropic's own products.
 */
export const RECOMMENDED: { name: string; source: string; ko: Words; en: Words }[] = [
  {
    name: 'frontend-design',
    source: 'anthropics/skills/frontend-design',
    ko: { title: '화면 디자인 감각', does: '흔한 AI 느낌 없이, 개성 있고 완성도 높은 화면을 만들어요' },
    en: { title: 'Design sense', does: "Builds screens with a distinct look that doesn't feel AI-made" },
  },
  {
    name: 'webapp-testing',
    source: 'anthropics/skills/webapp-testing',
    ko: { title: '웹앱 직접 눌러 보기', does: '만든 웹앱을 브라우저로 열어 눌러 보고, 화면을 찍어 확인해요' },
    en: { title: 'Try the web app', does: 'Opens the app in a browser, clicks through it and takes screenshots' },
  },
  {
    name: 'vercel-deploy',
    source: 'openai/skills/vercel-deploy',
    ko: { title: '인터넷에 올리기', does: '만든 사이트를 Vercel에 올리고 누구나 열 수 있는 주소를 받아요' },
    en: { title: 'Put it online', does: 'Deploys the site to Vercel and gets a link anyone can open' },
  },
  {
    name: 'pdf',
    source: 'openai/skills/pdf',
    ko: { title: 'PDF 다루기', does: 'PDF를 읽고 만들어요. 페이지를 그려 보며 모양까지 확인해요' },
    en: { title: 'PDF files', does: 'Reads and makes PDFs, checking the pages as they look' },
  },
  {
    name: 'security-best-practices',
    source: 'openai/skills/security-best-practices',
    ko: { title: '보안 점검', does: '코드에 흔한 보안 구멍이 없는지 살피고 고칠 점을 알려 줘요' },
    en: { title: 'Security check', does: 'Looks for common security holes in the code and says what to fix' },
  },
  {
    name: 'theme-factory',
    source: 'anthropics/skills/theme-factory',
    ko: { title: '테마 입히기', does: '문서·슬라이드·페이지에 어울리는 색과 글꼴 테마를 골라 입혀요' },
    en: { title: 'Themes', does: 'Gives documents, slides and pages a matching set of colours and fonts' },
  },
  {
    name: 'skill-creator',
    source: 'anthropics/skills/skill-creator',
    ko: { title: '스킬 만들기 도우미', does: '대화하면서 나만의 스킬을 만들고 다듬어요' },
    en: { title: 'Skill maker', does: 'Makes and improves your own skills with you, in conversation' },
  },
];

/** The plain-words title Alpine gives a skill it recommends, else the skill's own name. */
export function skillTitle(name: string, locale: 'ko' | 'en'): string {
  return RECOMMENDED.find((r) => r.name === name)?.[locale].title ?? name;
}

/**
 * What a skill does: Alpine's words for one it recommends, else the first sentence of its own description (all of it
 * with `whole`).
 */
export function skillDoes(skill: Pick<SkillInfo, 'name' | 'description'>, locale: 'ko' | 'en', whole = false): string {
  const known = RECOMMENDED.find((r) => r.name === skill.name);
  if (known) return known[locale].does;
  if (whole) return skill.description;
  const first = skill.description.match(/^.+?[.!?。](\s|$)/)?.[0] ?? skill.description;
  return first.trim();
}

/** Whether text pasted or typed is a place to get skills from rather than words to search for. */
export function looksLikeSource(text: string): boolean {
  const t = text.trim();
  return (
    /^(https?:\/\/|www\.|github\.com\/|skills\.sh\/|file:\/\/|~\/|\/)/.test(t) ||
    /^(npx|pnpx|bunx)\s+skills\s+add\s/.test(t) ||
    /^[\w.-]+\/[\w.-]+(\/[\w.-]+)?$/.test(t)
  );
}

type Words2 = (typeof skillMessages)['ko'];

/** Why adding or changing a skill failed, in the app's words. */
export function skillError(error: unknown, t: Words2): string {
  const reason = error instanceof ServerError ? error.data?.reason : undefined;
  const key = `error_${reason ?? 'other'}` as keyof Words2;
  const text = t[key];
  return typeof text === 'string' ? text : t.error_other;
}

/** The other app a skill belongs to, or `null` for Alpine's own and the project's. */
export function skillAppName(skill: Pick<SkillInfo, 'origin'>, t: Words2): string | null {
  if (skill.origin === 'claude') return t.claude;
  if (skill.origin === 'codex') return t.codex;
  if (skill.origin === 'agents') return t.agents;
  return null;
}

/** Where a skill I did not add in Alpine came from ('Claude Code에 있던 스킬'), or `null` for Alpine's own. */
export function skillApp(skill: Pick<SkillInfo, 'origin'>, t: Words2): string | null {
  if (skill.origin === 'project') return t.fromProject;
  const app = skillAppName(skill, t);
  return app ? t.fromApp(app) : null;
}
