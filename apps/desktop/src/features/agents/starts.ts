import { BUILTIN_TOOLS } from '@/shared/components/agent';

import type { AgentsWords } from './messages';

export type StartId = 'blank' | 'maker' | 'review' | 'writer';

/**
 * The four ways a new agent can begin (docs/agents.md decision 15): a character and which built-in tools are on. User
 * tools, skills, MCP and subagents differ per user or don't exist yet, so a start never includes them.
 */
export const STARTS: readonly { id: StartId; look: string; color: number; tools: readonly string[] }[] = [
  { id: 'blank', look: 'antenna', color: 7, tools: BUILTIN_TOOLS },
  { id: 'maker', look: 'hardhat', color: 1, tools: BUILTIN_TOOLS },
  { id: 'review', look: 'glasses', color: 3, tools: ['read', 'glob', 'grep'] },
  { id: 'writer', look: 'beret', color: 4, tools: BUILTIN_TOOLS.filter((tool) => tool !== 'bash') },
];

export const DEFAULT_START: StartId = 'maker';

/**
 * A start's words: the card's title and intro, and what fills the new agent: its name, description (the intro, empty
 * for the blank one) and 지침.
 */
export function startText(id: StartId, t: AgentsWords) {
  const card = (title: string, intro: string, instructions: string) => ({
    title,
    intro,
    name: title,
    description: intro,
    instructions,
  });
  switch (id) {
    case 'blank':
      return { ...card(t.blankName, t.blankIntro, t.blankInstructions), name: t.newAgent, description: '' };
    case 'maker':
      return card(t.makerName, t.makerIntro, t.makerInstructions);
    case 'review':
      return card(t.reviewName, t.reviewIntro, t.reviewInstructions);
    case 'writer':
      return card(t.writerName, t.writerIntro, t.writerInstructions);
  }
}
