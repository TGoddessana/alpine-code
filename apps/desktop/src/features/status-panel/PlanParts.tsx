import type { Plan, PlanCheck, SessionInfo } from '@alpine/protocol';
import clsx from 'clsx';
import type { ReactNode } from 'react';

import { statusColor, useStatusWord } from '@/shared/components/status';
import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';

type Messages = (typeof messages)['en'];

/** The numbers beside the tabs and the part titles: steps done / steps, checks passed / checks, unusual things. */
export function planCounts(plan: Plan | null | undefined): {
  plan: [number, number] | null;
  verification: [number, number] | null;
  unusual: number;
} {
  if (!plan) return { plan: null, verification: null, unusual: 0 };
  return {
    plan: plan.steps.length ? [plan.steps.filter((s) => s.status === 'done').length, plan.steps.length] : null,
    verification: plan.checks.length
      ? [plan.checks.filter((c) => c.result === 'passed').length, plan.checks.length]
      : null,
    unusual: plan.dropped.length,
  };
}

/**
 * The plan's steps: ✓ done, ● now, ○ to do. There is one ●, and the word beside it is the session's state (the same
 * word as the header's), not the model's.
 */
export function PlanPart({ info }: { info: SessionInfo | null }) {
  const t = useMessages(messages);
  const word = useStatusWord(info?.status ?? 'idle');
  const steps = info?.plan?.steps ?? [];
  if (!info || !steps.length) return <None />;
  return (
    <ul className="flex flex-col">
      {steps.map((step, i) => (
        <Row
          key={i}
          mark={
            step.status === 'done' ? (
              <Mark className="text-fg-muted">✓</Mark>
            ) : step.status === 'now' ? (
              <Mark className={statusColor(info.status)}>●</Mark>
            ) : (
              <Mark className="text-fg-faint">○</Mark>
            )
          }
          state={t[`step_${step.status}`]}
          meta={step.status === 'now' ? word : null}
        >
          {step.text}
        </Row>
      ))}
    </ul>
  );
}

/**
 * The plan's checks, each with its result: ✓ passed, red ● failed, ○ not run yet. The grey word on the right says
 * who judged it: nothing for the harness (a fact it saw), "에이전트" for the agent's claim (with how many calls it
 * cited), "나" for me. Before any check has run, the checks are only their labels.
 */
export function VerificationPart({ info }: { info: SessionInfo | null }) {
  const t = useMessages(messages);
  const format = useFormat();
  const checks = info?.plan?.checks ?? [];
  if (!checks.length) return <None />;
  const anyRan = checks.some((check) => check.result !== 'not_run');
  return (
    <ul className="flex flex-col">
      {checks.map((check) => {
        const result = resultWord(t, check, anyRan);
        return (
          <Row
            key={check.label}
            mark={
              check.result === 'passed' ? (
                <Mark className="text-fg-muted">✓</Mark>
              ) : check.result === 'failed' ? (
                <Mark className="text-danger">●</Mark>
              ) : (
                <Mark className="text-fg-faint">○</Mark>
              )
            }
            state={t[`check_${check.result}`]}
            meta={judgeWord(t, check, format.number)}
          >
            {result ? `${check.label} · ${result}` : check.label}
          </Row>
        );
      })}
    </ul>
  );
}

/** What the harness noticed that is out of the ordinary. For now: steps that left the plan. */
export function UnusualPart({ info }: { info: SessionInfo | null }) {
  const t = useMessages(messages);
  const dropped = info?.plan?.dropped ?? [];
  if (!dropped.length) return <None />;
  return (
    <ul className="flex flex-col">
      {dropped.map((text) => (
        <Row
          key={text}
          mark={
            <span className="inline-flex size-3.5 items-center justify-center rounded-full border border-fg-muted text-meta leading-none">
              !
            </span>
          }
          state={null}
          meta={null}
        >
          {t.droppedStep(text)}
        </Row>
      ))}
    </ul>
  );
}

export function None() {
  const t = useMessages(messages);
  return <p className="flex min-h-7 items-center text-body text-fg-muted">{t.none}</p>;
}

function resultWord(t: Messages, check: PlanCheck, anyRan: boolean): string | null {
  switch (check.result) {
    case 'passed':
      return t.passed;
    case 'failed':
      return t.failed;
    case 'changed':
      return t.changedSincePassed;
    case 'not_run':
      return anyRan ? t.notRun : null;
  }
}

function judgeWord(t: Messages, check: PlanCheck, number: (n: number) => string): string | null {
  switch (check.judge) {
    case 'harness':
      return null;
    case 'agent':
      return check.result !== 'not_run' && check.evidence.length
        ? t.judgedByAgentWith(number(check.evidence.length))
        : t.judgedByAgent;
    case 'user':
      return t.judgedByMe;
  }
}

/** A mark in its 16px box, so the rows' text lines up whatever the shape. */
function Mark({ className, children }: { className: string; children: ReactNode }) {
  return <span className={clsx('leading-none', className)}>{children}</span>;
}

/** One row of the panel: the mark, the text (13px, never dimmed) and a grey word on the right. */
function Row({
  mark,
  state,
  meta,
  children,
}: {
  mark: ReactNode;
  state: string | null;
  meta: string | null;
  children: ReactNode;
}) {
  return (
    <li className="flex min-h-7 items-center gap-2 text-body">
      <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center">
        {mark}
      </span>
      {state && <span className="sr-only">{state}</span>}
      <span className="min-w-0 grow">{children}</span>
      {meta && <span className="shrink-0 text-meta whitespace-nowrap text-fg-muted">{meta}</span>}
    </li>
  );
}
