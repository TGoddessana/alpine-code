import type { ToolCallItem } from '@alpine/protocol';

import type { Item } from '@/shared/server';
import { toolKind, toolTarget } from '@/shared/tool-calls';

/** Actual session-baseline-to-current change. A null diff is an old record or a non-text file. */
export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  diff: string[] | null;
}

/** A command the agent ran, or is running. */
export interface RanCommand {
  id: string;
  command: string;
  status: ToolCallItem['status'];
}

export interface WorkResult {
  files: ChangedFile[];
  commands: RanCommand[];
  legacyFiles?: ChangedFile[];
}

const NOT_RUN: ToolCallItem['status'][] = ['denied', 'cancelled'];

/** Approval previews describe intent, never applied changes. The latest actual snapshot wins,
 * including an empty snapshot when all changes have been reverted. Older sessions keep file names
 * but do not present approval previews as verified final diffs. */
export function workResult(items: Item[]): WorkResult {
  const legacy = new Map<string, ChangedFile>();
  let actual: ChangedFile[] | null = null;
  const commands: RanCommand[] = [];
  for (const item of items) {
    if (item.kind !== 'tool_call') continue;
    if (item.fileChanges != null) actual = item.fileChanges;
    const kind = toolKind(item.name);
    if (kind === 'edit' && item.status === 'done' && item.fileChanges == null) {
      const path = toolTarget(item);
      if (path) legacy.set(path, { path, added: 0, removed: 0, diff: null });
    } else if (kind === 'run' && !NOT_RUN.includes(item.status)) {
      commands.push({ id: item.id, command: toolTarget(item), status: item.status });
    }
  }
  return {
    files: actual ?? [],
    commands,
    ...(legacy.size ? { legacyFiles: [...legacy.values()] } : {}),
  };
}
