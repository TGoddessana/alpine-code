import type { SessionInfo, Usage } from '@alpine/protocol';
import clsx from 'clsx';

import { useFormat, useMessages } from '@/shared/i18n';
import { CONTEXT_WARN_PERCENT, contextPercent } from '@/shared/usage';

import { messages } from './messages';

type Counter = 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'requests';

const ROWS = [
  ['inputTokens', 'sent', 'sentHint'],
  ['outputTokens', 'received', 'receivedHint'],
  ['cacheReadTokens', 'cacheRead', 'cacheReadHint'],
  ['cacheWriteTokens', 'cacheWrite', 'cacheWriteHint'],
  ['requests', 'requests', 'requestsHint'],
] as const satisfies readonly (readonly [Counter, keyof (typeof messages)['en'], keyof (typeof messages)['en']])[];

/**
 * What the session has used, as rows of a plain label, the number and one quiet line saying what it means. The
 * numbers are the whole session's; while a run is active this run's sit beside them. The last row is the model's
 * memory, and the cost says so when the price is unknown.
 */
export function UsageSection({ info }: { info: SessionInfo | null }) {
  const t = useMessages(messages);
  const format = useFormat();
  if (!info) return <p className="flex min-h-7 items-center text-body text-fg-muted">{t.none}</p>;

  const { usage, runUsage } = info;
  const percent = contextPercent(info);
  const money = (usage: Usage) => (usage.cost === null ? null : format.money(usage.cost));
  const columns = runUsage ? 'grid-cols-[1fr_auto_auto]' : 'grid-cols-[1fr_auto]';

  return (
    <dl className="flex flex-col gap-3">
      {runUsage && (
        <div className={clsx('grid gap-x-4 text-meta text-fg-muted', columns)}>
          <span />
          <dt className="text-right">{t.wholeSession}</dt>
          <dt className="text-right">{t.thisRun}</dt>
        </div>
      )}
      {ROWS.map(([key, label, hint]) => (
        <Row key={key} label={t[label]} hint={t[hint]} columns={columns}>
          <dd className="text-right">{format.number(usage[key])}</dd>
          {runUsage && <dd className="text-right">{format.number(runUsage[key])}</dd>}
        </Row>
      ))}
      <Row label={t.cost} hint={t.costHint} columns={columns}>
        <dd className="text-right">{money(usage) ?? t.noPrice}</dd>
        {runUsage && <dd className="text-right">{money(runUsage) ?? '–'}</dd>}
      </Row>
      {percent !== null && info.contextWindow !== null && (
        <Row label={t.memory} hint={t.memoryHint} columns="grid-cols-[1fr_auto]">
          <dd className={clsx('text-right', percent >= CONTEXT_WARN_PERCENT && 'text-attention')}>
            {t.memoryValue(format.number(percent), format.number(info.contextUsed), format.number(info.contextWindow))}
          </dd>
        </Row>
      )}
    </dl>
  );
}

function Row({
  label,
  hint,
  columns,
  children,
}: {
  label: string;
  hint: string;
  columns: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className={clsx('grid items-baseline gap-x-4 text-body', columns)}>
        <dt>{label}</dt>
        {children}
      </div>
      <p className="text-meta text-fg-muted">{hint}</p>
    </div>
  );
}
