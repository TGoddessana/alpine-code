import type { AgentInfo, ToolFileInfo, ToolsListResult } from '@alpine/protocol';

/** One tool of the user's, or a file that cannot load yet, as a card in the library. */
export interface Card {
  /** The tool's name; for a file that did not load, the file's name. */
  tool: string;
  /** The file the tool lives in. */
  file: string;
  label: string;
  does: string;
  status: ToolFileInfo['status'];
  changedAt: string | null;
  error: string | null;
  /** Whether the agent being edited has it. */
  added: boolean;
  /** The other agents that have it. */
  usedBy: string[];
}

/**
 * The user's tools as cards, one per tool of each file. A file that is not ready has no tools to show, so it is one
 * card keyed by the file's name. `nameOf` words an agent's name; the default agent has none stored.
 */
export function cards(
  tools: ToolsListResult,
  agent: AgentInfo,
  agents: AgentInfo[],
  nameOf: (agent: AgentInfo) => string = (a) => a.name,
): Card[] {
  const others = agents.filter((a) => a.id !== agent.id);
  const card = (file: ToolFileInfo, tool: string, does: string): Card => ({
    tool,
    file: file.name,
    label: tool,
    does,
    status: file.status,
    changedAt: file.changedAt,
    error: file.error,
    added: agent.tools.includes(tool),
    usedBy: others.filter((a) => a.tools.includes(tool)).map(nameOf),
  });
  return tools.files.flatMap((file) => {
    if (file.tools.length > 0) return file.tools.map((tool) => card(file, tool.name, firstLine(tool.description)));
    return file.status === 'ready' ? [] : [card(file, file.name, '')];
  });
}

export function firstLine(text: string) {
  return text.split('\n')[0] ?? '';
}
