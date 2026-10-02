import type { ApprovalItem, CheckDetail, PlanUpdateDetail, ToolCallItem } from '@alpine/protocol';

import type { Item } from '@/shared/server';

/** A tool call with the answer I gave when it asked, if it asked. */
export interface ToolRow {
  call: ToolCallItem;
  approval: ApprovalItem | null;
}

/**
 * What the chat draws: an item as it is, the tool calls that came in a row as one list, or a call that waits for my
 * answer.
 */
export type Block =
  | { type: 'item'; item: Exclude<Item, ToolCallItem | ApprovalItem> }
  | { type: 'tools'; id: string; rows: ToolRow[] }
  | { type: 'approval'; item: ApprovalItem };

/**
 * The items in the order they started, as blocks. Tool calls in a row become one block. A waiting approval is its
 * own block where the call will be; a finished one is not drawn on its own but goes with its call (a denied call
 * shows what I said).
 */
export function toBlocks(items: Item[], activeIds: readonly string[]): Block[] {
  const active = new Set(activeIds);
  const approvals = new Map<string, ApprovalItem>();
  for (const item of items) if (item.kind === 'approval') approvals.set(item.callId, item);
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === 'approval') {
      if (active.has(item.id)) blocks.push({ type: 'approval', item });
    } else if (item.kind === 'tool_call') {
      const row = { call: item, approval: approvals.get(item.id) ?? null };
      const last = blocks.at(-1);
      if (last?.type === 'tools') last.rows.push(row);
      else blocks.push({ type: 'tools', id: item.id, rows: [row] });
    } else blocks.push({ type: 'item', item });
  }
  return blocks;
}

export type ToolKind = 'edit' | 'run' | 'read' | 'search' | 'check' | 'plan' | 'other';

/**
 * What a tool call does, from its name: the core's tools (`edit`, `bash`, `read`..., the plan's `update_plan` and
 * `check`) and the scripted `*_file` ones.
 */
export function toolKind(name: string): ToolKind {
  if (/^(edit|write)(_file)?$/.test(name)) return 'edit';
  if (name === 'bash') return 'run';
  if (/^read(_file)?$/.test(name)) return 'read';
  if (/^(grep|glob)(_file)?$/.test(name)) return 'search';
  if (name === 'check') return 'check';
  if (name === 'update_plan') return 'plan';
  return 'other';
}

/**
 * The part of a call's arguments worth showing on its line: a path, a command, a pattern (and where it looks) or a
 * check's label. Takes a call or an approval, which carries its call's arguments. The plan has none: its row is
 * `계획` alone.
 */
export function toolTarget({ args }: { args: Record<string, unknown> }): string {
  const { path, file_path, command, pattern, label } = args;
  if (typeof pattern === 'string') return typeof path === 'string' && path ? `${pattern}  ${path}` : pattern;
  for (const value of [path, file_path, command, label]) if (typeof value === 'string') return value;
  return '';
}

/** What the indented line under a call says. */
export type ToolSummary =
  /** Not finished, did not run, or failed without a message: the state in words (a denied call adds what I said). */
  | { type: 'state' }
  /** Read or searched: how much it found; what it found opens on a click. `count` 0 is "nothing found". */
  | { type: 'count'; unit: 'lines' | 'entries' | 'files' | 'matches'; count: number; text: string }
  /** Ran a command, changed a file or failed: the output itself, its first lines shown. */
  | { type: 'output'; text: string; kind: 'diff' | 'text'; failed: boolean; added: number; removed: number }
  /** Changed the plan: only what changed ("'원인 찾기' 끝냄 · '고치기' 시작"); the panel has the whole list. */
  | { type: 'plan'; detail: PlanUpdateDetail }
  /** A harness check that passed: "통과". (A failed one is its output.) */
  | { type: 'passed' }
  /** An agent's check: its judgement and how many calls it cited. */
  | { type: 'judged'; detail: CheckDetail }
  /** Finished without anything to show. */
  | { type: 'done' };

/** Lines of output shown before "show more": a diff says more per line than a command's output. */
export const PREVIEW_LINES = { text: 4, diff: 10 } as const;

const NUMBERED = /^\s*\d+\t/;
/** The tools' own "[N more files...]" notes at the end of a cut list. */
const MORE = /^\[(\d+) more /;

/** How many things a list result names, counting the ones its "[N more ...]" note left out. */
function countListed(lines: string[]): number {
  return lines.reduce((sum, line) => sum + (MORE.test(line) ? Number(MORE.exec(line)![1]) : 1), 0);
}

/** A call that failed: it errored, or it was a check that did not pass. Counted and drawn in red. */
export function isFailed(call: ToolCallItem): boolean {
  if (['error', 'input_error', 'aborted'].includes(call.status)) return true;
  return call.detail?.kind === 'check' && !call.detail.passed;
}

/** The core's note at the end of a check's output, which the line under the call says in words instead. */
const CHECK_NOTE = /\n?\[(check passed|exit code \d+: check failed)\]$/;

/** What the line under a call says, from its state, its kind and what it returned. */
export function toolSummary({ call, approval }: ToolRow): ToolSummary {
  if (['running', 'denied', 'cancelled', 'interrupted'].includes(call.status)) return { type: 'state' };
  const detail = call.status === 'done' ? call.detail : null;
  if (detail?.kind === 'plan') return { type: 'plan', detail };
  if (detail?.kind === 'check' && detail.judge !== 'harness') return { type: 'judged', detail };
  if (detail?.kind === 'check' && detail.passed) return { type: 'passed' };
  const text = call.result?.replace(/\n+$/, '').replace(CHECK_NOTE, '') ?? '';
  const failed = call.status !== 'done' || detail?.kind === 'check';
  const kind = toolKind(call.name);
  if (!failed && kind === 'read' && text) {
    const lines = text.split('\n');
    const numbered = lines.filter((line) => NUMBERED.test(line)).length;
    if (numbered || text === '(empty file)') return { type: 'count', unit: 'lines', count: numbered, text };
    const entries = text === '(empty directory)' ? 0 : countListed(lines);
    return { type: 'count', unit: 'entries', count: entries, text };
  }
  if (!failed && kind === 'search' && text) {
    const none = /^No (files match|matches for) /.test(text);
    const unit = /^glob/.test(call.name) ? 'files' : 'matches';
    return { type: 'count', unit, count: none ? 0 : countListed(text.split('\n')), text };
  }
  if (!failed && kind === 'edit' && approval?.previewKind === 'diff' && approval.preview) {
    // The file names at the top repeat the call's own line.
    const diff = approval.preview.split('\n').filter((line) => !/^(---|\+\+\+) /.test(line));
    return {
      type: 'output',
      text: diff.join('\n').replace(/\n+$/, ''),
      kind: 'diff',
      failed,
      added: diff.filter((line) => line.startsWith('+')).length,
      removed: diff.filter((line) => line.startsWith('-')).length,
    };
  }
  if (!text) return failed ? { type: 'state' } : { type: 'done' };
  return { type: 'output', text, kind: 'text', failed, added: 0, removed: 0 };
}
