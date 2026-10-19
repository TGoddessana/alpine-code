import type { ProjectInfo } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Check } from 'lucide-react';

import { useMessages } from '@/shared/i18n';
import { tildePath, useHomeDir } from '@/shared/platform';
import type { CreateStep, TemplateId } from '@/shared/server';

import { messages } from './messages';

const ORDER: CreateStep[] = ['folder', 'address', 'agent'];

/**
 * Why making the project stopped. `not_started`: the project was made and is on the rail, but the AI could not start
 * on the idea. The others made nothing: the setup is not there, the settings cannot be read, or something else.
 */
export interface CreateFailure {
  kind: 'not_found' | 'invalid_config' | 'other' | 'not_started';
  /** What the server said, for whoever has to look into it. */
  detail: string | null;
}

/**
 * 만들기 with a template: the folder, the web address when signed in, then the AI starts on the idea. The steps tick
 * as the server announces them, the folder shows where it is; when the request ends (`done`) the way into the session
 * opens. When it fails, a short plain message says what happened and the button goes back.
 */
export function Creating({
  online,
  template,
  steps,
  project,
  address,
  done: finished,
  failure,
  onOpen,
  onBack,
}: {
  /** Signed in to Alpine: a web template gets its web address as the second step. */
  online: boolean;
  template: TemplateId;
  steps: CreateStep[];
  /** The project being made, once the folder step has announced it. */
  project: ProjectInfo | null;
  /** The web address the server made, with the `address` step; `null` when it made none. */
  address: string | null;
  /** The request ended well: every step is done and the session can be opened. */
  done: boolean;
  failure: CreateFailure | null;
  onOpen: () => void;
  /** After a failure: back to the setups, or (`not_started`) on to the project that was made. */
  onBack: () => void;
}) {
  const t = useMessages(messages);
  const home = useHomeDir();
  // The address row is promised only while it can still come: a blank project has none, and a step the server
  // skipped (the app could not be made, a realtime web app on Free) leaves no empty tick behind.
  const addressed = online && (template === 'web-lite' || template === 'web-pro') && (address !== null || !finished);
  const shown = ORDER.filter((step) => addressed || step !== 'address');
  const labels: Record<CreateStep, string> = { folder: t.stepFolder, address: t.stepAddress, agent: t.stepAgent };
  const details: Partial<Record<CreateStep, string>> = project
    ? { folder: tildePath(project.path, home), ...(address ? { address } : {}) }
    : {};
  const reached = (step: CreateStep) => finished || steps.includes(step);
  const body =
    failure &&
    {
      not_found: t.createNoTemplate,
      invalid_config: t.createBadConfig,
      other: t.createUnknown,
      not_started: t.madeButNotStartedBody,
    }[failure.kind];
  return (
    <div className="motion-step flex flex-col gap-6">
      <h1 className="text-display font-semibold">
        {failure
          ? failure.kind === 'not_started'
            ? t.madeButNotStarted
            : t.createFailed
          : finished
            ? t.created
            : t.creating}
      </h1>
      <ol className="flex flex-col overflow-hidden rounded-xl border border-line bg-canvas-raised">
        {shown.map((step, index) => {
          const done = reached(step);
          const working = !done && !failure && shown.slice(0, index).every(reached);
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
      {failure && (
        <div role="alert" className="motion-step flex flex-col gap-1">
          <p className="text-body text-fg">{body}</p>
          {failure.detail && <p className="font-mono text-meta break-words text-fg-muted">{failure.detail}</p>}
        </div>
      )}
      {(failure || finished) && (
        <div className="motion-step flex justify-end">
          <Button variant="primary" autoFocus onClick={failure ? onBack : onOpen}>
            {failure ? (failure.kind === 'not_started' ? t.openProject : t.back) : t.goToSession}
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
