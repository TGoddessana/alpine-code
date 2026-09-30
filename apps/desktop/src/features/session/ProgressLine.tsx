import type { SessionInfo } from '@alpine/protocol';
import clsx from 'clsx';
import { useEffect, useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { runTokens } from '@/shared/usage';

import { activityWord } from './activity';
import { messages } from './messages';

/** The current time, refreshed every second while mounted, so an elapsed time ticks. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * What the agent is doing right now, in one line above the input: a dot (grey while it works, orange while it
 * waits for me), the activity in words, how long the run has lasted and how many tokens it used so far. Shown only
 * while a run is active. The dot pulses gently so the line never looks frozen, unless motion is reduced.
 */
export function ProgressLine({ info }: { info: Pick<SessionInfo, 'activity' | 'runStartedAt' | 'runUsage'> }) {
  const t = useMessages(messages);
  const format = useFormat();
  const now = useNow();
  const { activity, runStartedAt, runUsage } = info;
  const waiting = activity?.kind === 'waiting_approval';
  const parts = [t[`activity_${activityWord(activity)}`]];
  if (runStartedAt) parts.push(format.duration(now - new Date(runStartedAt).getTime()));
  if (runUsage && runUsage.requests > 0) parts.push(t.runTokens(format.number(runTokens(runUsage))));

  return (
    // The clock ticks every second, so the region is not announced.
    <p role="status" aria-live="off" className="flex items-center gap-2 px-1 text-meta text-fg-muted">
      <span
        aria-hidden="true"
        className={clsx('animate-pulse motion-reduce:animate-none', waiting && 'text-attention')}
      >
        ●
      </span>
      <span className="min-w-0 truncate">{parts.join(' · ')}</span>
    </p>
  );
}
