import type { ToolCallItem } from '@alpine/protocol';

import type { Item } from '@/shared/server';

/** What the chat draws: an item as it is, or the tool calls that came in a row as one activity line. */
export type Block =
  { type: 'item'; item: Exclude<Item, ToolCallItem> } | { type: 'tools'; id: string; calls: ToolCallItem[] };

/**
 * The items in the order they started, as blocks. Tool calls in a row become one block, and an approval that is
 * still waiting is left out (the dock above the input shows it) without breaking the row.
 */
export function toBlocks(items: Item[], activeIds: readonly string[]): Block[] {
  const active = new Set(activeIds);
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === 'approval' && active.has(item.id)) continue;
    if (item.kind === 'tool_call') {
      const last = blocks.at(-1);
      if (last?.type === 'tools') last.calls.push(item);
      else blocks.push({ type: 'tools', id: item.id, calls: [item] });
    } else blocks.push({ type: 'item', item });
  }
  return blocks;
}

export type ToolKind = 'edit' | 'run' | 'read' | 'other';

/** What a tool call does, from its name: the core's tools (`edit`, `bash`, `read`...) and the scripted `*_file` ones. */
export function toolKind(name: string): ToolKind {
  if (/^(edit|write)(_file)?$/.test(name)) return 'edit';
  if (name === 'bash') return 'run';
  if (/^(read|grep|glob)(_file)?$/.test(name)) return 'read';
  return 'other';
}

/** The part of a call's arguments worth showing on its line: a path, a command or a pattern. */
export function toolTarget(call: ToolCallItem): string {
  for (const key of ['path', 'file_path', 'command', 'pattern']) {
    const value = call.args[key];
    if (typeof value === 'string') return value;
  }
  return '';
}
