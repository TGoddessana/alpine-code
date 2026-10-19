import clsx from 'clsx';
import { Check as CheckIcon, Minus } from 'lucide-react';
import type { ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/** A check's state is an open enum on the wire; anything the sheet does not know is shown as needing a look. */
export type RowState = 'running' | 'ok' | 'attention' | 'blocked' | 'skipped';

export const rowState = (state: string): RowState =>
  state === 'running' || state === 'ok' || state === 'blocked' || state === 'skipped' ? state : 'attention';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line-subtle pt-3">
      <h3 className="text-meta font-semibold text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

export function Row({
  state,
  text,
  detail,
  action,
}: {
  state: RowState;
  text: string;
  /** Smaller, under the sentence: where it is, or how many rows it touches. */
  detail?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <Mark state={state} />
      <div className="flex min-w-0 grow flex-col items-start gap-1">
        <p
          className={clsx(
            'text-body transition-colors',
            state === 'running' || state === 'skipped'
              ? 'text-fg-muted'
              : state === 'blocked'
                ? 'text-danger'
                : 'text-fg',
          )}
        >
          {text}
        </p>
        {detail && <p className="font-mono text-meta break-all text-fg-muted">{detail}</p>}
        {action && <div className="motion-step -ml-1">{action}</div>}
      </div>
    </div>
  );
}

/** One mark per state, with its word for screen readers. */
export function Mark({ state }: { state: RowState }) {
  const t = useMessages(messages);
  const word = { running: t.checking, ok: t.ok, attention: t.attention, blocked: t.blocked, skipped: t.skipped }[state];
  return (
    <span className="relative mt-0.5 inline-flex size-5 shrink-0 items-center justify-center" title={word}>
      <span className="sr-only">{word}</span>
      {state === 'running' && (
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-interactive" />
      )}
      {state === 'ok' && (
        <CheckIcon aria-hidden="true" size={14} strokeWidth={2.25} className="motion-step text-interactive" />
      )}
      {state === 'skipped' && (
        <Minus aria-hidden="true" size={14} strokeWidth={2} className="motion-step text-fg-muted" />
      )}
      {(state === 'attention' || state === 'blocked') && (
        <span
          aria-hidden="true"
          className={clsx('motion-step size-2 rounded-full', state === 'attention' ? 'bg-attention' : 'bg-danger')}
        />
      )}
    </span>
  );
}

export function ProgressLine({ progress }: { progress: number }) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      className="h-1.5 overflow-hidden rounded-full bg-canvas-sunken"
    >
      <div
        className="h-full rounded-full bg-interactive transition-[width] duration-(--motion-panel)"
        style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }}
      />
    </div>
  );
}
