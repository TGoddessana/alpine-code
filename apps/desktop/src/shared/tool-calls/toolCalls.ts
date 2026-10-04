import type { ApprovalItem } from '@alpine/protocol';

export type ToolKind = 'edit' | 'run' | 'read' | 'search' | 'other';

/** What a tool call does, from its name: the core's tools (`edit`, `bash`, `read`...) and the scripted `*_file` ones. */
export function toolKind(name: string): ToolKind {
  if (/^(edit|write)(_file)?$/.test(name)) return 'edit';
  if (name === 'bash') return 'run';
  if (/^read(_file)?$/.test(name)) return 'read';
  if (/^(grep|glob)(_file)?$/.test(name)) return 'search';
  return 'other';
}

/**
 * The part of a call's arguments worth showing on its line: a path, a command or a pattern (and where it looks).
 * Takes a call or an approval, which carries its call's arguments.
 */
export function toolTarget({ args }: { args: Record<string, unknown> }): string {
  const { path, file_path, command, pattern } = args;
  if (typeof pattern === 'string') return typeof path === 'string' && path ? `${pattern}  ${path}` : pattern;
  for (const value of [path, file_path, command]) if (typeof value === 'string') return value;
  return '';
}

/** A file change as its diff lines and how many lines it added and removed. */
export interface EditDiff {
  lines: string[];
  added: number;
  removed: number;
}

/**
 * The diff an edit showed when it asked, without the file names at its top (they repeat the call's own line).
 * Null when the edit did not ask, or asked without a diff.
 */
export function editDiff(approval: ApprovalItem | null): EditDiff | null {
  if (approval?.previewKind !== 'diff' || !approval.preview) return null;
  const lines = approval.preview
    .replace(/\n+$/, '')
    .split('\n')
    .filter((line) => !/^(---|\+\+\+) /.test(line));
  return {
    lines,
    added: lines.filter((line) => line.startsWith('+')).length,
    removed: lines.filter((line) => line.startsWith('-')).length,
  };
}
