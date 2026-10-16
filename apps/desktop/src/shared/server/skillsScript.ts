import type { SkillCandidate, SkillHit, SkillInfo, SkillsAddResult } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

const HOME = '/Users/me/.alpine-code/skills';

const skill = (name: string, description: string, more: Partial<SkillInfo> = {}): SkillInfo => ({
  name,
  description,
  origin: 'alpine',
  source: null,
  folder: `${HOME}/${name}`,
  hasScripts: false,
  notes: [],
  ...more,
});

/** The skills a scripted server starts with: one added from a link, one written in Alpine, one from Claude Code. */
export const SKILLS: SkillInfo[] = [
  skill(
    'frontend-design',
    'Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one.',
    { source: 'anthropics/skills/frontend-design' },
  ),
  skill('weekly-report', '주간 보고서를 쓸 때. 지난주에 바뀐 내용을 정리해 표와 세 줄 요약으로 만들어요.'),
  skill('commit-messages', 'Write clear git commit messages from the staged diff. Use when committing.', {
    origin: 'claude',
    folder: '/Users/me/.claude/skills/commit-messages',
  }),
];

/** What a skill's SKILL.md says, for the opened skill. */
const TEXT: Record<string, string> = {
  'weekly-report': `---
name: weekly-report
description: "주간 보고서를 쓸 때. 지난주에 바뀐 내용을 정리해 표와 세 줄 요약으로 만들어요."
---

# 주간 보고서

1. \`git log --since="7 days ago"\`로 지난 7일 동안 바뀐 내용을 모아요.
2. **기능**, **고친 문제**, **할 일**로 나눠요.
3. 표 하나와 세 줄 요약으로 써요. 어려운 말은 쉽게 풀어 써요.
`,
  'frontend-design': `---
name: frontend-design
description: Guidance for distinctive, intentional visual design when building new UI.
license: Complete terms in LICENSE.txt
---

# Frontend design

Before writing any code, pick a clear aesthetic direction and commit to it.

## Typography
- Choose fonts with character; avoid the defaults every AI reaches for.
- Pair one display face with one text face.

## Colour and layout
- Use a dominant colour with sharp accents rather than an even palette.
- Let the layout break the grid where it helps the story.
`,
};

/** A repository with several skills, as `anthropics/skills` is. */
const REPO: SkillCandidate[] = [
  ['algorithmic-art', 'Creating algorithmic art using p5.js with seeded randomness.', true],
  ['brand-guidelines', "Applies a brand's official colors and typography to any artifact.", false],
  ['canvas-design', 'Create beautiful visual art in .png and .pdf documents using design philosophy.', true],
  ['frontend-design', 'Guidance for distinctive, intentional visual design when building new UI.', false],
  ['skill-creator', 'Create new skills, modify and improve existing skills, and measure skill performance.', true],
  ['theme-factory', 'Toolkit for styling artifacts with a theme: slides, docs, landing pages.', false],
  ['webapp-testing', 'Toolkit for interacting with and testing local web applications using Playwright.', true],
].map(([name, description, hasScripts]) => ({
  name: name as string,
  description: description as string,
  hasScripts: hasScripts as boolean,
  installed: false,
}));

/** What skills.sh finds, by word. */
const HITS: SkillHit[] = [
  ['pdf', 'anthropics/skills', 210_769],
  ['pdf', 'openai/skills', 13_172],
  ['pdftk-server', 'github/awesome-copilot', 9_971],
  ['pdf-converter', 'tanis90/pdf-converter-mineru', 9_496],
  ['pdf-extraction', 'claude-office-skills/skills', 8_998],
  ['vercel-react-best-practices', 'vercel-labs/agent-skills', 803_394],
  ['web-design-guidelines', 'vercel-labs/agent-skills', 412_350],
  ['deploy-to-vercel', 'vercel-labs/agent-skills', 98_120],
].map(([name, source, installs]) => ({
  name: name as string,
  source: source as string,
  id: `${source as string}/${name as string}`,
  installs: installs as number,
}));

export interface SkillsScriptOptions {
  /** Start with no skills. */
  empty?: boolean;
  /** How long fetching takes, to see '가져오는 중…'. */
  delayMs?: number;
}

/**
 * Skills, remembered while the script runs. `skills/add` gets one skill from `owner/repo/name`, a skills.sh or
 * GitHub folder link, or a `.zip`; `anthropics/skills` (or its GitHub link) has several and asks which; anything
 * else that is not a link fails as Alpine would.
 */
export function skillsScript({ empty = false, delayMs = 0 }: SkillsScriptOptions = {}): Script {
  let skills = empty ? [] : SKILLS.map((s) => ({ ...s }));
  const later = <T>(value: T): T =>
    (delayMs ? new Promise((resolve) => setTimeout(() => resolve(value), delayMs)) : value) as T;
  const install = (name: string, source: string, description?: string) => {
    const added = skill(name, description ?? REPO.find((r) => r.name === name)?.description ?? `The ${name} skill.`, {
      source,
      hasScripts: REPO.find((r) => r.name === name)?.hasScripts ?? false,
    });
    skills = [added, ...skills.filter((s) => s.name !== name)];
    return added;
  };

  const add = ({ source, names }: { source: string; names?: string[] | null }): SkillsAddResult => {
    const text = source.trim();
    if (/^(https:\/\/github\.com\/)?anthropics\/skills\/?$/.test(text)) {
      const choices = REPO.map((c) => ({ ...c, installed: skills.some((s) => s.name === c.name) }));
      if (!names) return { source: 'anthropics/skills', added: [], choices };
      return {
        source: 'anthropics/skills',
        added: names.map((n) => install(n, `anthropics/skills/${n}`)),
        choices: [],
      };
    }
    const name = text.match(/--skill\s+([\w.-]+)/)?.[1] ?? text.match(/\/([\w.-]+?)(?:\.zip|\.skill)?\/?$/)?.[1];
    if (!name || !/[/\\]/.test(text)) throw new ServerError(-32000, 'unknown source', { reason: 'unknown_source' });
    if (name === 'missing') throw new ServerError(-32000, 'no skills', { reason: 'no_skills' });
    return { source: text, added: [install(name, text)], choices: [] };
  };

  return {
    results: {
      'skills/list': () => ({ skills, folder: HOME }),
      'skills/get': ({ name }) => {
        const found = skills.find((s) => s.name === name);
        if (!found) throw new ServerError(-32602, 'no skill', { reason: 'not_found' });
        const text =
          TEXT[name] ??
          `---\nname: ${name}\ndescription: ${found.description}\n---\n\n# ${name}\n\n${found.description}\n`;
        return { skill: found, text, files: found.hasScripts ? ['scripts/run.py', 'reference.md'] : [] };
      },
      'skills/add': (params) => later(add(params)),
      'skills/save': ({ name, text, new: isNew }) => {
        const description = text.match(/description:\s*"?(.+?)"?\s*$/m)?.[1] ?? '';
        if (isNew && skills.some((s) => s.name === name)) throw new ServerError(-32000, 'exists', { reason: 'exists' });
        TEXT[name] = text;
        const saved = skill(name, description);
        skills = isNew ? [saved, ...skills] : skills.map((s) => (s.name === name ? { ...s, description } : s));
        return { skill: skills.find((s) => s.name === name)! };
      },
      'skills/remove': ({ name }) => {
        const found = skills.find((s) => s.name === name);
        if (found && found.origin !== 'alpine') throw new ServerError(-32000, 'not owned', { reason: 'not_owned' });
        skills = skills.filter((s) => s.name !== name);
        return {};
      },
      'skills/search': ({ query }) => {
        const q = query.toLowerCase();
        const hits = HITS.filter(
          (h) => h.name.includes(q) || h.source.includes(q) || (q === 'react' && h.source.startsWith('vercel')),
        );
        return { hits: hits.sort((a, b) => b.installs - a.installs) };
      },
    },
  };
}
