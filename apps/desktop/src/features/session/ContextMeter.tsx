import type { SessionInfo, Usage } from '@alpine/protocol';
import { Popover } from '@alpine/ui/primitives';
import clsx from 'clsx';

import { useFormat, useMessages } from '@/shared/i18n';
import { CONTEXT_WARN_PERCENT, contextPercent } from '@/shared/usage';

import { messages } from './messages';

type Info = Pick<SessionInfo, 'contextUsed' | 'contextWindow' | 'usage' | 'runUsage'>;

/**
 * How much of what the model can read at once this conversation fills (its length), as a small pie in the input's
 * bar, explained on hover. A click opens what the conversation has used: its length, then what was sent and
 * received, the requests and the cost (this run's beside the whole conversation's while a run is active). The pie turns to the attention colour from 80%.
 */
export function ContextMeter({ info }: { info: Info }) {
  const t = useMessages(messages);
  const format = useFormat();
  const percent = contextPercent(info);
  const warn = percent !== null && percent >= CONTEXT_WARN_PERCENT;
  const label = percent === null ? t.usage : t.lengthAria(format.number(percent));

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        title={percent === null ? undefined : t.lengthHint(format.number(percent))}
        className={clsx(
          'inline-flex size-7 cursor-pointer items-center justify-center rounded-md hover:bg-canvas-sunken data-popup-open:bg-canvas-sunken',
          warn ? 'text-attention' : 'text-fg-muted',
        )}
      >
        <Pie percent={percent ?? 0} />
      </Popover.Trigger>
      <Popover.Popup side="top" align="end" className="w-80">
        <UsageDetails info={info} percent={percent} />
      </Popover.Popup>
    </Popover.Root>
  );
}

/** A circle filled to `percent`, like a clock hand sweeping from twelve. */
function Pie({ percent }: { percent: number }) {
  const angle = (2 * Math.PI * Math.min(percent, 100)) / 100;
  const x = 9 + 5 * Math.sin(angle);
  const y = 9 - 5 * Math.cos(angle);
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {percent >= 100 ? (
        <circle cx="9" cy="9" r="5" fill="currentColor" />
      ) : (
        percent > 0 && <path d={`M9 9 L9 4 A5 5 0 ${percent > 50 ? 1 : 0} 1 ${x} ${y} Z`} fill="currentColor" />
      )}
    </svg>
  );
}

function UsageDetails({ info, percent }: { info: Info; percent: number | null }) {
  const t = useMessages(messages);
  const format = useFormat();
  const { usage, runUsage } = info;
  const money = (u: Usage) => (u.cost === null ? null : format.money(u.cost));
  const columns = runUsage ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]';
  const rows = [
    [t.sent, (u: Usage) => t.tokens(format.number(u.inputTokens))],
    [t.received, (u: Usage) => t.tokens(format.number(u.outputTokens))],
    [t.requests, (u: Usage) => t.times(format.number(u.requests))],
  ] as const;

  return (
    <>
      {percent !== null && (
        <section className="flex flex-col gap-2">
          <Popover.Title className="flex items-baseline justify-between text-lead font-semibold">
            {t.lengthTitle}
            <span className={clsx('text-body', percent >= CONTEXT_WARN_PERCENT && 'text-attention')}>
              {format.number(percent)}%
            </span>
          </Popover.Title>
          <div className="h-1.5 overflow-hidden rounded-full bg-hover">
            <div
              className={clsx('h-full rounded-full', percent >= CONTEXT_WARN_PERCENT ? 'bg-attention' : 'bg-fg-muted')}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <p className="text-meta text-fg-muted">{t.lengthExplain}</p>
        </section>
      )}
      <section className={clsx('flex flex-col gap-2', percent !== null && 'border-t border-line-subtle pt-3')}>
        <h3 className="text-lead font-semibold">{t.usedTitle}</h3>
        <dl className="flex flex-col gap-1.5 text-body tabular-nums">
          {runUsage && (
            <div className={clsx('grid gap-x-4 text-meta text-fg-muted', columns)}>
              <span />
              <dt className="text-right">{t.wholeSession}</dt>
              <dt className="text-right">{t.thisRun}</dt>
            </div>
          )}
          {rows.map(([label, value]) => (
            <div key={label} className={clsx('grid items-baseline gap-x-4', columns)}>
              <dt className="text-fg-muted">{label}</dt>
              <dd className="text-right">{value(usage)}</dd>
              {runUsage && <dd className="text-right">{value(runUsage)}</dd>}
            </div>
          ))}
          <div className={clsx('grid items-baseline gap-x-4', columns)}>
            <dt className="text-fg-muted">{t.cost}</dt>
            <dd className="text-right">{money(usage) ?? t.noPrice}</dd>
            {runUsage && <dd className="text-right">{money(runUsage) ?? '–'}</dd>}
          </div>
        </dl>
        <p className="text-meta text-fg-muted">{t.tokenTip}</p>
      </section>
    </>
  );
}
