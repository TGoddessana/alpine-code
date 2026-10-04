import type { ApprovalItem, ToolCallItem } from '@alpine/protocol';

import type { Item } from '@/shared/server';
import { editDiff, toolKind, toolTarget } from '@/shared/tool-calls';

/**
 * A file the agent changed, once however often it was changed. The diff and the counts come from the edits that
 * showed one when they asked; an edit that did not ask adds none, so `diff` is null when no edit of the file showed one.
 */
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

/** What the work changed and ran, in the order it first happened. */
export interface WorkResult {
  files: ChangedFile[];
  commands: RanCommand[];
}

/** Calls that never ran: the command list leaves them out. */
const NOT_RUN: ToolCallItem['status'][] = ['denied', 'cancelled'];

/** What a conversation's tool calls changed and ran. Only edits that finished count as a change. */
export function workResult(items: Item[]): WorkResult {
  const approvals = new Map<string, ApprovalItem>();
  for (const item of items) if (item.kind === 'approval') approvals.set(item.callId, item);

  const files = new Map<string, ChangedFile>();
  const commands: RanCommand[] = [];
  for (const item of items) {
    if (item.kind !== 'tool_call') continue;
    const kind = toolKind(item.name);
    if (kind === 'edit' && item.status === 'done') {
      const path = toolTarget(item);
      if (!path) continue;
      const file = files.get(path) ?? { path, added: 0, removed: 0, diff: null };
      const diff = editDiff(approvals.get(item.id) ?? null);
      if (diff) {
        file.added += diff.added;
        file.removed += diff.removed;
        file.diff = [...(file.diff ?? []), ...diff.lines];
      }
      files.set(path, file);
    } else if (kind === 'run' && !NOT_RUN.includes(item.status)) {
      commands.push({ id: item.id, command: toolTarget(item), status: item.status });
    }
  }
  return { files: [...files.values()], commands };
}
