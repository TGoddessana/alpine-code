import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { counts, type RunSnapshot } from './run';
import { Workshop } from './Workshop';

/** Decision 4: the model proposes, the user presses 시작. The size is in agents, the model per step, the time. */
export function ProposalCard({
  run,
  minutes,
  onStart,
  onAlone,
}: {
  run: RunSnapshot;
  minutes: number;
  onStart?: () => void;
  onAlone?: () => void;
}) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-3">
      <div>
        <p className="text-body font-medium">{t.proposeTitle(run.planned)}</p>
        <p className="text-meta text-fg-muted">{t.proposeTime(minutes)}</p>
      </div>
      <Workshop run={run} size={26} labels={false} />
      {open && (
        <ul className="flex flex-col gap-1 text-body text-fg-muted">
          {run.phases.map((phase, i) => (
            <li key={phase.title}>
              {t.phaseLine(phase.title, run.agents.filter((a) => a.phase === i).length, phase.model)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onStart}>
          {t.start}
        </Button>
        <Button onClick={onAlone}>{t.alone}</Button>
        <span className="grow" />
        <button
          type="button"
          className="cursor-pointer text-meta text-fg-muted hover:text-fg"
          onClick={() => setOpen(!open)}
        >
          {open ? t.hidePlan : t.showPlan}
        </button>
      </div>
    </div>
  );
}

/** Decision 6: the proposal card turns into this summary; the details live in the dock's 에이전트 tab. */
export function ProgressCard({
  run,
  title,
  over,
  onShowAgents,
  onStop,
  onSelect,
}: {
  run: RunSnapshot;
  title: string;
  /** Decision 5: the script wants more agents than the card said. */
  over?: { needed: number };
  onShowAgents?: () => void;
  onStop?: () => void;
  onSelect?: (id: string) => void;
}) {
  const t = useMessages(messages);
  const { asking } = counts(run);
  return (
    <div
      className={clsx(
        'flex flex-col gap-3 rounded-xl border bg-canvas-raised p-3',
        over ? 'border-attention' : 'border-line',
      )}
    >
      <p className="text-body font-medium">{run.finished ? t.finished(title) : t.working(title, run.minutes)}</p>
      <Workshop run={run} size={26} labels={false} onSelect={onSelect} />
      {run.log && <p className="text-meta text-fg-muted">{run.log}</p>}
      {over ? (
        <>
          <div className="flex items-start gap-2 text-body text-attention">
            <CircleAlert size={16} className="mt-0.5 shrink-0" />
            <div>
              <p>
                {t.overTitle} · {t.overCounts(run.planned, over.needed)}
              </p>
              <p className="text-meta text-fg-muted">{t.overHint}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="primary">{t.overContinue(over.needed - run.planned)}</Button>
            <Button>{t.overStop}</Button>
          </div>
        </>
      ) : (
        !run.finished && (
          <div className="flex items-center gap-2">
            <Button onClick={onShowAgents}>{t.showAgents}</Button>
            <Button onClick={onStop}>{t.stop}</Button>
            <span className="grow" />
            {asking > 0 && <span className="text-meta text-attention">{t.waiting(asking)}</span>}
          </div>
        )
      )}
    </div>
  );
}
