import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Check } from 'lucide-react';

import { appAddress } from '@/shared/components/cloud';
import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { CreateStep } from './preview';

const ORDER: CreateStep[] = ['folder', 'address', 'agent'];

/** 만들기 with a template: the folder, the web address when signed in, then the AI starts on the idea. */
export function Creating({
  online,
  steps,
  name,
  onOpen,
}: {
  online: boolean;
  steps: CreateStep[];
  name: string | null;
  onOpen: () => void;
}) {
  const t = useMessages(messages);
  const shown = ORDER.filter((step) => online || step !== 'address');
  const labels: Record<CreateStep, string> = { folder: t.stepFolder, address: t.stepAddress, agent: t.stepAgent };
  const project = name ?? 'craft-booking';
  const details: Partial<Record<CreateStep, string>> = {
    folder: `~/AlpineCode/${project}`,
    address: appAddress(project),
  };
  return (
    <div className="motion-step flex flex-col gap-6">
      <h1 className="text-display font-semibold">{t.creating}</h1>
      <ol className="flex flex-col overflow-hidden rounded-xl border border-line bg-canvas-raised">
        {shown.map((step, index) => {
          const done = steps.includes(step);
          const working = !done && shown.slice(0, index).every((before) => steps.includes(before));
          return (
            <li
              key={step}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 transition-colors not-first:border-t not-first:border-line-subtle',
                working && 'bg-canvas-sunken',
              )}
            >
              <Mark state={done ? 'done' : working ? 'working' : 'waiting'} />
              <span className={clsx('grow text-body transition-colors', done || working ? 'text-fg' : 'text-fg-muted')}>
                {labels[step]}
              </span>
              {done && details[step] && (
                <span className="motion-step font-mono text-meta text-fg-muted">{details[step]}</span>
              )}
            </li>
          );
        })}
      </ol>
      {name && (
        <div className="motion-step flex justify-end">
          <Button variant="primary" autoFocus onClick={onOpen}>
            {t.goToSession}
          </Button>
        </div>
      )}
    </div>
  );
}

/** ✓ / ● / ○ and always the word beside it, as everywhere else in the app. */
function Mark({ state }: { state: 'done' | 'working' | 'waiting' }) {
  const t = useMessages(messages);
  return (
    <span className="inline-flex w-16 shrink-0 items-center gap-1.5 text-meta text-fg-muted">
      <span
        aria-hidden="true"
        className={clsx(
          'inline-flex size-4 items-center justify-center transition-colors',
          state === 'done' && 'text-interactive',
          state === 'working' && 'text-interactive',
          state === 'waiting' && 'text-fg-faint',
        )}
      >
        {state === 'done' ? (
          <Check size={14} strokeWidth={2.25} className="motion-step" />
        ) : state === 'working' ? (
          <span className="size-1.5 animate-pulse rounded-full bg-interactive" />
        ) : (
          '○'
        )}
      </span>
      {state === 'done' ? t.done : state === 'working' ? t.working : t.waiting}
    </span>
  );
}
