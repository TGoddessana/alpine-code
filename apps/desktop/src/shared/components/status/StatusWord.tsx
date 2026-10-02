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

/** The colour that says a session's state: grey while it works or rests, orange on my turn, red after a failure. */
export function statusColor(status: SessionInfo['status']): string {
  return dots[status].color;
}

/** A session's state in a word ("작업 중", "내 차례"), for a mark that is drawn elsewhere (the plan's ●). */
export function useStatusWord(status: SessionInfo['status']): string {
  return useMessages(messages)[status];
}

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
