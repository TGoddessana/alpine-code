import type { ApprovalItem } from '@alpine/protocol';

export type ToolKind = 'edit' | 'run' | 'read' | 'search' | 'memory' | 'other';

/**
 * What a tool call does, from its name: the core's tools (`edit`, `bash`, `read`...), the scripted `*_file` ones, and
 * those of a conversation brought over from Claude Code (`Bash`, `Read`, `MultiEdit`...) or Codex (`exec_command`,
 * `shell`, `apply_patch`).
 */
export function toolKind(name: string): ToolKind {
  if (name === 'propose_memory') return 'memory';
  if (/^(edit|write)(_file)?$/i.test(name) || /^(MultiEdit|NotebookEdit|apply_patch)$/.test(name)) return 'edit';
  if (/^(bash|shell|local_shell|exec_command)$/i.test(name)) return 'run';
  if (/^read(_file)?$/i.test(name)) return 'read';
  if (/^(grep|glob)(_file)?$/i.test(name)) return 'search';
  return 'other';
}

/**
 * The part of a call's arguments worth showing on its line: a path, a command, a pattern (and where it looks) or a
 * memory's headline. Takes a call or an approval, which carries its call's arguments.
 */
export function toolTarget({ args }: { args: Record<string, unknown> }): string {
  const { path, file_path, command, cmd, pattern, headline } = args;
  if (typeof pattern === 'string') return typeof path === 'string' && path ? `${pattern}  ${path}` : pattern;
  for (const value of [path, file_path, command, cmd, headline]) if (typeof value === 'string') return value;
  // Codex's shell takes the command as a list: ["bash", "-lc", "ls"].
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) return command.at(-1) ?? '';
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
