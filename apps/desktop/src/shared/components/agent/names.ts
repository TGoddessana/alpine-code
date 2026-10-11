import type { OfferedTool } from '@alpine/protocol';

import type { useMessages } from '@/shared/i18n';

import type { agentMessages } from './messages';

export const BUILTIN_TOOLS = ['read', 'glob', 'grep', 'write', 'edit', 'bash'] as const;
type Builtin = (typeof BUILTIN_TOOLS)[number];

/** The tools Alpine says in plain words: the built-ins and the memory's, which every agent has. */
const LABELED = [...BUILTIN_TOOLS, 'propose_memory'] as const;
type Labeled = (typeof LABELED)[number];

/** A tool that comes with Alpine, and whether an agent can turn it off. */
export interface AlpineTool {
  name: string;
  optional: boolean;
}

type Messages = ReturnType<typeof useMessages<typeof agentMessages.ko>>;

export function isBuiltin(name: string): name is Builtin {
  return (BUILTIN_TOOLS as readonly string[]).includes(name);
}

/** The agent's name; one never renamed (the default) has none stored and reads as 기본 에이전트. */
export function agentName(agent: { id: string; name: string }, t: Messages): string {
  return agent.name || t.defaultAgent;
}

function isLabeled(name: string): name is Labeled {
  return (LABELED as readonly string[]).includes(name);
}

/**
 * The tools that come with Alpine, as `tools/list` offers them: the built-ins and the memory's (which no agent can
 * turn off), not the user's. Until the list is there, the built-ins.
 */
export function alpineTools(offered: readonly OfferedTool[] | undefined): AlpineTool[] {
  if (!offered) return BUILTIN_TOOLS.map((name) => ({ name, optional: true }));
  return offered.filter((o) => o.origin !== 'user').map((o) => ({ name: o.tool.name, optional: o.optional }));
}

/** A tool that comes with Alpine in plain words; a user's tool shows as its own name. */
export function toolLabel(name: string, t: Messages): string {
  return isLabeled(name) ? t[name] : name;
}

/** A model without its connection: 'anthropic/claude-sonnet-5' reads as 'claude-sonnet-5'. */
export const shortModel = (model: string) => model.slice(model.indexOf('/') + 1);

/** What the tools let an agent do, in a line: '파일 보기 · 바꾸기 · 명령 · 도구 2개 더'. */
export function abilities(tools: readonly string[], t: Messages): string {
  const has = (...names: string[]) => names.some((name) => tools.includes(name));
  const canRead = has('read', 'glob', 'grep');
  const parts: string[] = [];
  if (canRead) parts.push(t.canRead);
  if (has('write', 'edit')) parts.push(t.canChange);
  else if (canRead) parts.push(t.cannotChange);
  if (has('bash')) parts.push(t.canRun);
  const more = tools.filter((name) => !isLabeled(name)).length;
  if (more > 0) parts.push(t.moreTools(more));
  return parts.join(' · ');
}
