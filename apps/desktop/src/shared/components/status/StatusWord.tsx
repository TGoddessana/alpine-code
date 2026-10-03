import type { SessionInfo } from '@alpine/protocol';
import clsx from 'clsx';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const dots = {
  idle: { mark: '○', color: 'text-fg-muted' },
  running: { mark: '●', color: 'text-fg-muted' },
  waiting: { mark: '●', color: 'text-attention' },
  failed: { mark: '●', color: 'text-danger' },
} satisfies Record<SessionInfo['status'], { mark: string; color: string }>;

/** A session's state as a dot and always a word beside it: grey is running, orange is my turn, red is a failure. */
export function StatusWord({ status, className }: { status: SessionInfo['status']; className?: string }) {
  const t = useMessages(messages);
  const dot = dots[status];
  return (
    <span className={clsx('inline-flex items-center gap-1 text-meta whitespace-nowrap', dot.color, className)}>
      <span aria-hidden="true">{dot.mark}</span>
      {t[status]}
    </span>
  );
}
