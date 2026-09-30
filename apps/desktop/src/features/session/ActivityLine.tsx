import type { ToolCallItem } from '@alpine/protocol';
import clsx from 'clsx';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { toolKind, toolTarget, type ToolKind } from './blocks';
import { messages } from './messages';

const KINDS: ToolKind[] = ['edit', 'run', 'read', 'other'];

const statusOf = {
  running: { mark: '●', word: 'toolRunning', color: 'text-fg-muted' },
  done: { mark: '✓', word: 'toolDone', color: 'text-fg-muted' },
  error: { mark: '●', word: 'toolFailed', color: 'text-danger' },
  input_error: { mark: '●', word: 'toolFailed', color: 'text-danger' },
  aborted: { mark: '●', word: 'toolFailed', color: 'text-danger' },
  interrupted: { mark: '○', word: 'toolInterrupted', color: 'text-fg-muted' },
  denied: { mark: '○', word: 'toolDenied', color: 'text-fg-muted' },
  cancelled: { mark: '○', word: 'toolCancelled', color: 'text-fg-muted' },
} as const satisfies Record<
  ToolCallItem['status'],
  { mark: string; word: keyof (typeof messages)['en']; color: string }
>;

/**
 * The tool calls of one stretch of work as a compact line ("Edit 2 · Run 1 ›"). Opening it lists each call with
 * its state written as a word.
 */
export function ActivityLine({ calls }: { calls: ToolCallItem[] }) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const summary = KINDS.map((kind) => [kind, calls.filter((call) => toolKind(call.name) === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${t[kind]} ${count}`)
    .join(' · ');

  return (
    <div className="flex flex-col gap-1 text-meta text-fg-muted">
      <button
        type="button"
        aria-expanded={open}
        aria-label={t.activity(summary)}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-6 w-fit cursor-pointer items-center gap-1 rounded-md hover:text-fg"
      >
        {summary}
        <span aria-hidden="true" className={clsx('inline-block transition-transform', open && 'rotate-90')}>
          ›
        </span>
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 border-l border-line-subtle pl-3">
          {calls.map((call) => {
            const status = statusOf[call.status];
            return (
              <li key={call.id} className="flex min-h-6 items-center gap-2">
                <span className="shrink-0">{t[toolKind(call.name)]}</span>
                <span className="min-w-0 grow truncate font-mono text-fg" title={toolTarget(call)}>
                  {toolTarget(call)}
                </span>
                <span className={clsx('inline-flex shrink-0 items-center gap-1', status.color)}>
                  <span aria-hidden="true">{status.mark}</span>
                  {t[status.word]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
