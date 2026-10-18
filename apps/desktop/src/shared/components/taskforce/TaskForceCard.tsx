import type { TaskForceItem } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { CircleAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useResumeTaskForce, useTaskForceAction, type TaskForceAction } from '@/shared/server';

import { messages } from './messages';
import { counts, minutesSince, roomOf } from './room';
import { Workshop } from './Workshop';

/**
 * A TF in the chat, through its life (decisions 4-6): the proposal with 시작 / 혼자 하기, then a small room with the
 * script's latest line, how many wait for an approval, 에이전트 보기 and 멈추기; the question when the script wants
 * more agents than planned; 이어 하기 after the app closed mid-run; and how it ended.
 */
export function TaskForceCard({
  sessionId,
  item,
  onShowAgents,
}: {
  sessionId: string;
  item: TaskForceItem;
  onShowAgents?: () => void;
}) {
  const t = useMessages(messages);
  const act = useTaskForceAction();
  const resume = useResumeTaskForce();
  const room = useMemo(() => roomOf(item), [item]);
  const [open, setOpen] = useState(false);
  const live = item.status === 'running' || item.status === 'over' || item.status === 'stopping';
  const now = useClock(live);
  const busy = act.isPending || resume.isPending;
  const run = (action: TaskForceAction) => act.mutate({ action, sessionId, runId: item.id });
  const { done, asking, total } = counts(item);

  if (item.status === 'declined') return <p className="text-meta text-fg-muted">{t.declined(item.title)}</p>;

  const heading =
    item.status === 'proposed'
      ? t.proposeTitle(item.title)
      : item.status === 'stopping'
        ? t.stopping(item.title)
        : live
          ? t.working(item.title, minutesSince(item.startedAt, now))
          : item.status === 'done'
            ? t.finished(item.title)
            : item.status === 'stopped'
              ? t.stoppedEnd(item.title)
              : item.status === 'failed'
                ? t.failedEnd(item.title)
                : t.interrupted(item.title);
  const sub =
    item.status === 'proposed'
      ? `${t.agents(room.planned)} · ${t.proposeTime(item.minutes)}`
      : total
        ? t.doneCount(done, total)
        : null;

  return (
    <section
      aria-label={heading}
      className={clsx(
        'flex flex-col gap-3 rounded-xl border bg-canvas-raised p-3',
        item.status === 'over' || item.status === 'interrupted' ? 'border-attention' : 'border-line',
      )}
    >
      <div>
        <p className="text-body font-medium">{heading}</p>
        {sub && <p className="text-meta text-fg-muted">{sub}</p>}
      </div>
      <Workshop room={room} size={26} labels={false} onSelect={item.members.length ? onShowAgents : undefined} />
      {open && (
        <ul className="flex flex-col gap-1 text-body text-fg-muted">
          {item.steps.map((step) => (
            <li key={step.title}>{t.phaseLine(step.title, step.count, shortName(step.model))}</li>
          ))}
        </ul>
      )}
      {item.log && item.status !== 'proposed' && <p className="text-meta text-fg-muted">{item.log}</p>}
      {item.status === 'over' && item.needed !== null && (
        <div className="flex items-start gap-2 text-body text-attention">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <div>
            <p>
              {t.overTitle} · {t.overCounts(room.planned, item.needed)}
            </p>
            <p className="text-meta text-fg-muted">{t.overHint}</p>
          </div>
        </div>
      )}
      {item.status === 'interrupted' && <p className="text-meta text-fg-muted">{t.resumeHint(done)}</p>}
      {(act.isError || resume.isError) && (
        <p role="alert" className="text-meta text-danger">
          {t.actionFailed}
        </p>
      )}
      <div className="flex items-center gap-2">
        {item.status === 'proposed' && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => run('start')}>
              {t.start}
            </Button>
            <Button disabled={busy} onClick={() => run('decline')}>
              {t.alone}
            </Button>
            <span className="grow" />
            <LinkButton onClick={() => setOpen(!open)}>{open ? t.hidePlan : t.showPlan}</LinkButton>
          </>
        )}
        {item.status === 'over' && item.needed !== null && (
          <>
            <Button variant="primary" disabled={busy} onClick={() => run('allowMore')}>
              {t.overContinue(item.needed - room.planned)}
            </Button>
            <Button disabled={busy} onClick={() => run('stop')}>
              {t.overStop}
            </Button>
          </>
        )}
        {(item.status === 'running' || item.status === 'stopping') && (
          <>
            <Button onClick={onShowAgents}>{t.showAgents}</Button>
            {item.status === 'running' && (
              <Button disabled={busy} onClick={() => run('stop')}>
                {t.stop}
              </Button>
            )}
            <span className="grow" />
            {asking > 0 && <span className="text-meta text-attention">{t.waiting(asking)}</span>}
          </>
        )}
        {item.status === 'interrupted' && (
          <>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => resume.mutate({ sessionId, runId: item.id, fresh: false })}
            >
              {t.resume}
            </Button>
            <Button disabled={busy} onClick={() => run('takeResults')}>
              {t.takeResults}
            </Button>
            <span className="grow" />
            <LinkButton disabled={busy} onClick={() => resume.mutate({ sessionId, runId: item.id, fresh: true })}>
              {t.fresh}
            </LinkButton>
          </>
        )}
        {(item.status === 'done' || item.status === 'stopped' || item.status === 'failed') && total > 0 && (
          <Button onClick={onShowAgents}>{t.showAgents}</Button>
        )}
      </div>
    </section>
  );
}

/** Now, again every half minute while `ticking`, for "N분째". */
function useClock(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function shortName(model: string): string {
  return model.split('/').pop() ?? model;
}
