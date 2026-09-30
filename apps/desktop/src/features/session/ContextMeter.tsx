import type { SessionInfo } from '@alpine/protocol';
import clsx from 'clsx';

import { useFormat, useMessages } from '@/shared/i18n';
import { CONTEXT_WARN_PERCENT, contextPercent } from '@/shared/usage';

import { messages } from './messages';

/**
 * How much of the model's memory this conversation uses, as small text in the input's bar ("기억 34%") with a
 * one-line explanation on hover. Turns orange from 80%. Nothing when the model's window is unknown.
 */
export function ContextMeter({ info }: { info: Pick<SessionInfo, 'contextUsed' | 'contextWindow'> }) {
  const t = useMessages(messages);
  const format = useFormat();
  const percent = contextPercent(info);
  if (percent === null) return null;
  return (
    <span
      title={t.memoryHint(format.number(percent))}
      className={clsx(
        'cursor-default px-2 text-meta',
        percent >= CONTEXT_WARN_PERCENT ? 'text-attention' : 'text-fg-muted',
      )}
    >
      {t.memory(format.number(percent))}
    </span>
  );
}
