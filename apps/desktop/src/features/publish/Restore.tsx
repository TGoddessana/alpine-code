import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { useCloudPlans, useCloudStatus, useRestore, useRestorePoints } from '@/shared/server';

import { messages } from './messages';

/**
 * Going back to an earlier point (decision 15). Data and code go back together, so the schema always fits the code; the
 * state you leave is kept as a point first, which the lead says in plain words before anything is pressed.
 */
export function Restore({
  cwd,
  onBack,
  onClose,
  onUpgrade,
}: {
  cwd: string;
  onBack: () => void;
  onClose: () => void;
  /** Pro reaches further back; the sheet shows the plans. */
  onUpgrade: () => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const points = useRestorePoints(cwd);
  const restore = useRestore(cwd);
  const cloud = useCloudStatus().data;
  const plans = useCloudPlans().data?.plans;
  // Free goes back less far than Pro; say so where the window is shown (decision 15).
  const proDays = plans?.find((plan) => plan.id === 'pro')?.limits.restoreDays;
  const [chosen, setChosen] = useState<string | null>(null);
  const when = (at: string) => {
    const date = new Date(at);
    return `${format.date(date)} ${format.time(date)}`;
  };

  if (restore.isSuccess)
    return (
      <>
        <h2 className="text-title">{t.restoreTitle}</h2>
        <p role="status" className="text-body text-fg">
          {t.restored(when(points.data?.points.find((point) => point.id === chosen)?.at ?? new Date().toISOString()))}
        </p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={onClose}>
            {t.close}
          </Button>
        </div>
      </>
    );

  const list = points.data?.points ?? [];
  return (
    <>
      <div className="flex flex-col gap-1">
        <LinkButton className="-ml-1 self-start" onClick={onBack}>
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.75} className="mr-1" />
          {t.restoreBack}
        </LinkButton>
        <h2 className="text-title">{t.restoreTitle}</h2>
        <p className="text-body text-fg-muted">{t.restoreLead}</p>
      </div>
      {points.isSuccess && list.length === 0 && <p className="text-body text-fg-muted">{t.restoreEmpty}</p>}
      {list.length > 0 && (
        <ul role="radiogroup" aria-label={t.restoreTitle} className="flex flex-col gap-1">
          {list.map((point) => {
            const date = new Date(point.at);
            const on = chosen === point.id;
            return (
              <li key={point.id}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={restore.isPending}
                  onClick={() => setChosen(point.id)}
                  className={clsx(
                    'flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-lg border px-3 py-2 text-left',
                    on ? 'border-interactive bg-hover' : 'border-line hover:bg-hover',
                  )}
                >
                  <span className="text-body text-fg">{t.reason(point.reason) || t.reasonOther}</span>
                  <span className="shrink-0 text-meta text-fg-muted">
                    {when(point.at)} · {format.since(date)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {points.data && (
        <p className="flex items-baseline justify-between gap-3 text-meta text-fg-muted">
          {t.restoreWindow(points.data.windowDays)}
          {cloud?.plan?.id === 'free' && proDays != null && proDays > points.data.windowDays && (
            <LinkButton onClick={onUpgrade}>{t.restoreUpgrade(proDays)}</LinkButton>
          )}
        </p>
      )}
      {restore.isError && (
        <p role="alert" className="text-meta text-danger">
          {t.restoreFailed}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {restore.isPending && (
          <span role="status" className="text-meta text-fg-muted">
            {t.restoring}
          </span>
        )}
        <Button
          variant="primary"
          disabled={!chosen || restore.isPending}
          onClick={() => chosen && restore.mutate(chosen)}
        >
          {t.restoreDo}
        </Button>
      </div>
    </>
  );
}
