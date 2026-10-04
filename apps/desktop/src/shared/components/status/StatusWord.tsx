import type { SessionInfo } from '@alpine/protocol';
import clsx from 'clsx';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const dots = {
  idle: { color: 'bg-fg-faint', text: 'text-fg-muted' },
  running: { color: 'bg-interactive animate-pulse motion-reduce:animate-none', text: 'text-fg-muted' },
  waiting: { color: 'bg-attention', text: 'text-fg' },
  failed: { color: 'bg-danger', text: 'text-danger' },
} satisfies Record<SessionInfo['status'], { color: string; text: string }>;

/** A session's state as a filled dot and always a word beside it: blue pulses while it works, yellow is my turn, red is a stop. */
export function StatusWord({ status, className }: { status: SessionInfo['status']; className?: string }) {
  const t = useMessages(messages);
  const dot = dots[status];
  return (
    <span className={clsx('inline-flex items-center gap-1.5 text-meta whitespace-nowrap', dot.text, className)}>
      <span aria-hidden="true" className={clsx('size-1.5 rounded-full', dot.color)} />
      {t[status]}
    </span>
  );
}
