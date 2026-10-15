import type {
  CheckStamp,
  FlowCheck,
  FlowNode,
  FlowNodeResult,
  FlowPromiseParams,
  NodeState,
  ObservationProvenance,
  PromiseState,
} from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { CircleHelp, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { ServerError, useEditFlow, usePromiseAction, useReviewFlow } from '@/shared/server';

import { Editable } from './Editable';

import { messages } from './messages';
import { conditionResults, type PromiseStatus } from './model';
import { isReadOnly, isUnverified, mismatchCount, ObservationList, SourceDetails } from './Observations';
import { VerificationIcon } from './status';

const icon = {
  passed: 'passed',
  failed: 'failed',
  recheck: 'recheck',
  blocked: 'unconfirmed',
  unconfirmed: 'unconfirmed',
} as const;

/** "10월 3일" for a stored time; empty when it cannot be read. */
function useDay() {
  const t = useMessages(messages);
  return (iso?: string | null) => {
    const date = iso ? new Date(iso) : null;
    return date && !Number.isNaN(date.getTime()) ? t.changeDate(date.getMonth() + 1, date.getDate()) : '';
  };
}

/** When Alpine recorded a check, and whether this computer can vouch for that record. */
function StampLine({ stamp }: { stamp: CheckStamp }) {
  const t = useMessages(messages);
  const format = useFormat();
  const at = new Date(stamp.at);
  if (Number.isNaN(at.getTime())) return null;
  const when = format.since(at);
  const witness = stamp.witness ?? 'mine';
  const line =
    witness === 'mismatch'
      ? t.stampMismatch(when)
      : stamp.firstSeen
        ? t.stampFirst(when)
        : witness === 'other'
          ? t.stampOther(when)
          : t.stampMine(when);
  return (
    <>
      <p data-testid="stamp" className={clsx('text-meta', witness === 'mismatch' ? 'text-attention' : 'text-fg-muted')}>
        {line}
      </p>
      {stamp.uncertain && <p className="text-meta text-attention">{t.stampUncertain}</p>}
    </>
  );
}

const same = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.replace(/\s+/g, '').replace(/[.。]$/, '') === b.replace(/\s+/g, '').replace(/[.。]$/, '');

const verdictStyle = { passed: 'text-fg', failed: 'text-danger', blocked: 'text-attention' } as const;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="text-meta font-semibold text-fg-muted">{title}</h4>
      {children}
    </section>
  );
}

/**
 * One check result as a short argument: what was tried, what was seen (each with where Alpine got it), the verdict,
 * and what could not be checked. Older checks without observations keep the two-tier view. The technical record,
 * including sources and the command with its output, is folded away.
 */
export function CheckRecord({
  check,
  screenshot,
  hidePlain,
  stale,
  provenance,
  images,
  stamp,
  changed,
}: {
  check: FlowCheck;
  screenshot?: string;
  /** The same text is already shown elsewhere (the open-issue box), so it is not repeated. */
  hidePlain?: boolean;
  stale?: boolean;
  /** Labels the server computed, aligned with `check.observations`. */
  provenance?: ObservationProvenance[];
  /** Observation images keyed by observation index. */
  images?: Record<number, string | undefined>;
  /** What Alpine recorded about this run. */
  stamp?: CheckStamp | null;
  /** Files the check depends on that changed since it ran, for the technical record. */
  changed?: string[];
}) {
  const t = useMessages(messages);
  const plain = check.plain || check.summary;
  const observations = check.observations ?? [];
  const steps = check.steps ?? [];
  const limits = check.limits ?? [];
  const verdict = { passed: t.passed, failed: t.failed, blocked: t.blocked }[check.result];
  const meta = (
    <>
      {check.environment && <p className="text-meta text-fg-muted">{t.environmentLine(check.environment)}</p>}
      {stamp && <StampLine stamp={stamp} />}
      {isReadOnly(check, provenance) ? (
        <p className="text-meta text-fg-muted">{t.readOnlyResult}</p>
      ) : (
        isUnverified(check, provenance) && (
          <p className="text-meta text-fg-muted" title={t.unverifiedHint}>
            {t.unverified}
          </p>
        )
      )}
    </>
  );
  const fold = (
    <details className="rounded-md bg-canvas-sunken p-2">
      <summary className="cursor-pointer text-meta text-fg-muted">{t.recordTitle}</summary>
      {!!observations.length && (
        <div className="mt-2">
          <SourceDetails observations={observations} provenance={provenance} />
        </div>
      )}
      {!!changed?.length && (
        <div className="mt-2">
          <p className="text-meta text-fg-muted">{t.changedFiles}</p>
          <ul className="font-mono text-meta break-all">
            {changed.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </div>
      )}
      {!!observations.length && <p className="mt-2 text-meta text-fg-muted">{t.legacyRecord}</p>}
      <pre className="mt-2 overflow-x-auto font-mono text-meta whitespace-pre-wrap">
        {check.command}
        {'\n\n'}
        {check.output}
      </pre>
      <p className="mt-2 text-meta text-fg-muted">{t.reportNote}</p>
    </details>
  );
  if (!observations.length && !steps.length && !limits.length) {
    return (
      <div className="flex flex-col gap-2">
        {stale && <p className="text-meta text-attention">{t.stale}</p>}
        {!hidePlain && <p className="text-body">{check.result === 'blocked' ? t.blockedReason(plain) : plain}</p>}
        {meta}
        {screenshot && <img src={screenshot} alt={plain} className="w-full rounded-lg border border-line" />}
        {fold}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {stale && <p className="text-meta text-attention">{t.stale}</p>}
      {!!steps.length && (
        <Section title={t.stepsTitle}>
          <ol className="flex list-decimal flex-col gap-0.5 pl-5 text-body">
            {steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </Section>
      )}
      {!!observations.length && (
        <Section title={t.observationsTitle}>
          <ObservationList observations={observations} provenance={provenance} images={images} />
        </Section>
      )}
      <Section title={t.verdictTitle}>
        <p className="text-body">
          <span className={verdictStyle[check.result]}>{verdict}</span>
          {!hidePlain && plain && <span className="text-fg-muted"> · {plain}</span>}
        </p>
      </Section>
      {!!limits.length && (
        <Section title={t.limitsTitle}>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-body">
            {limits.map((limit, index) => (
              <li key={index}>{limit}</li>
            ))}
          </ul>
        </Section>
      )}
      <div className="flex flex-col gap-0.5">{meta}</div>
      {screenshot && <img src={screenshot} alt={plain} className="w-full rounded-lg border border-line" />}
      {fold}
    </div>
  );
}

/** A quiet note under the status when the evidence is thin or contradicted. It never changes the status. */
function EvidenceHint({ check, provenance }: { check?: FlowCheck | null; provenance?: ObservationProvenance[] }) {
  const t = useMessages(messages);
  if (!check) return null;
  const readOnly = isReadOnly(check, provenance);
  const unverified = isUnverified(check, provenance);
  const mismatches = mismatchCount(provenance);
  if (!unverified && !mismatches) return null;
  return (
    <span className="flex flex-wrap gap-x-2 text-meta text-fg-muted" data-testid="evidence-hint">
      {unverified && <span>{readOnly ? t.readOnlyResult : t.unverified}</span>}
      {!!mismatches && <span className="text-attention">{t.mismatchCount(mismatches)}</span>}
    </span>
  );
}

type PromiseAction = FlowPromiseParams['action'];
type Issue = NonNullable<PromiseState['issue']>;

const issueTone: Record<Issue, string> = {
  '': '',
  open: 'border-danger text-danger',
  regressed: 'border-danger text-danger',
  maybe_fixed: 'border-attention text-attention',
  question: 'border-attention text-attention',
  resolved: 'border-line text-fg',
  later: 'border-line-subtle text-fg-muted',
  wontfix: 'border-line-subtle text-fg-muted',
};

function OriginBadge({ origin, written }: { origin: NonNullable<PromiseState['origin']>; written?: boolean }) {
  const t = useMessages(messages);
  const text = written
    ? t.originWritten
    : { inferred: t.originInferred, confirmed: t.originConfirmed, plan: t.originPlan }[origin];
  return (
    <span
      data-origin={origin}
      className={clsx(
        'shrink-0 rounded-md border px-1.5 text-meta',
        origin === 'inferred' ? 'border-dashed border-line text-fg-muted' : 'border-line text-fg',
      )}
    >
      {text}
    </span>
  );
}

function IssueBadge({ promise }: { promise: PromiseState }) {
  const t = useMessages(messages);
  const day = useDay();
  const issue = promise.issue ?? '';
  if (!issue) return null;
  const since = day(promise.since);
  const text: Record<Exclude<Issue, ''>, string> = {
    open: t.issueOpen(since),
    resolved: t.issueResolved(since),
    regressed: t.issueRegressed(since),
    maybe_fixed: t.issueMaybeFixed,
    later: t.issueLater(since),
    wontfix: t.issueWontfix(promise.reason ?? ''),
    question: t.issueQuestion,
  };
  return (
    <span data-issue={issue} className={clsx('rounded-md border px-1.5 text-meta', issueTone[issue])}>
      {text[issue]}
    </span>
  );
}

/** What the user can do about a promise's problem, by the problem's state. */
function IssueActions({
  promise,
  disabled,
  onAction,
  onRecheck,
  onNotARule,
  onFix,
}: {
  promise: PromiseState;
  disabled: boolean;
  onAction: (action: PromiseAction, reason?: string, done?: () => void) => void;
  onRecheck: () => void;
  onNotARule: () => void;
  /** Ask the agent to make the product keep this promise. */
  onFix?: () => void;
}) {
  const t = useMessages(messages);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const issue = promise.issue ?? '';
  if (issue === 'question')
    return (
      <div className="flex flex-col gap-2 rounded-lg bg-canvas-sunken p-3">
        <p className="text-body font-medium">{t.issueQuestion}</p>
        <p className="text-meta text-fg-muted">{t.issueQuestionHint}</p>
        <div className="flex gap-2">
          <Button variant="primary" disabled={disabled} onClick={() => onAction('confirm')}>
            {t.actionYes}
          </Button>
          <Button disabled={disabled} onClick={onNotARule}>
            {t.actionNo}
          </Button>
        </div>
      </div>
    );
  if (issue === 'later' || issue === 'wontfix')
    return (
      <div className="flex flex-col gap-2">
        {issue === 'later' && <p className="text-meta text-fg-muted">{t.issueLaterHint}</p>}
        <div>
          <Button disabled={disabled} onClick={() => onAction('reopen')}>
            {t.actionReopen}
          </Button>
        </div>
      </div>
    );
  if (issue !== 'open' && issue !== 'regressed' && issue !== 'maybe_fixed') return null;
  return (
    <div className="flex flex-col gap-2">
      {onFix && issue !== 'maybe_fixed' && (
        <div>
          <Button variant="primary" disabled={disabled} onClick={onFix}>
            {t.askFix}
          </Button>
        </div>
      )}
      {issue === 'maybe_fixed' && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-meta text-attention">{t.issueMaybeFixedAsk}</p>
          <Button variant="primary" disabled={disabled} onClick={onRecheck}>
            {t.actionRecheck}
          </Button>
        </div>
      )}
      {asking ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            // Keep what was typed until it is saved, so a failure loses nothing.
            onAction('wontfix', reason.trim(), () => {
              setAsking(false);
              setReason('');
            });
          }}
        >
          <label className="flex flex-col gap-1 text-meta text-fg-muted">
            {t.wontfixReason}
            <input
              autoFocus
              type="text"
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
              className="rounded-md border border-line bg-canvas px-2 py-1 text-body text-fg outline-none focus:border-interactive"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={disabled || !reason.trim()}>
              {t.wontfixSave}
            </Button>
            <Button onClick={() => setAsking(false)}>{t.cancel}</Button>
          </div>
        </form>
      ) : (
        <div className="flex gap-2">
          <Button disabled={disabled} onClick={() => onAction('later')}>
            {t.actionLater}
          </Button>
          <Button disabled={disabled} onClick={() => setAsking(true)}>
            {t.actionWontfix}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Whether Alpine may re-run the check's command by itself, and what the last re-run showed. */
function Replay({
  check,
  promise,
  disabled,
  onAction,
}: {
  check?: FlowCheck;
  promise?: PromiseState;
  disabled: boolean;
  onAction: (action: PromiseAction, options?: { key?: string }) => void;
}) {
  const t = useMessages(messages);
  const day = useDay();
  const state = promise?.replay;
  const spec = check?.replay;
  if (!state?.approved) {
    if (!spec) return null;
    return (
      <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-line p-3">
        <div>
          <Button disabled={disabled} onClick={() => onAction('approve_replay', { key: state?.key })}>
            {t.replayAsk}
          </Button>
        </div>
        <p className="text-meta text-fg-muted">{t.replayAskLead}</p>
        <details className="text-meta text-fg-muted">
          <summary className="cursor-pointer">{t.replayCommand}</summary>
          <pre className="mt-1 overflow-x-auto rounded-md bg-canvas-sunken p-2 font-mono whitespace-pre-wrap">
            {spec.command}
            {spec.cwd ? `\n(${spec.cwd})` : ''}
          </pre>
        </details>
      </div>
    );
  }
  const line = state.running
    ? t.replayRunning
    : state.same === true
      ? t.replaySame(day(state.at))
      : state.same === false
        ? t.replayDifferent(day(state.at))
        : t.replayOnHint;
  return (
    <div className="flex flex-col gap-1.5">
      <p data-testid="replay" className={clsx('text-meta', state.same === false ? 'text-attention' : 'text-fg-muted')}>
        {line}
      </p>
      {!!state.output && (
        <details className="text-meta text-fg-muted">
          <summary className="cursor-pointer">{t.replayOutput}</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-canvas-sunken p-2 font-mono whitespace-pre-wrap">
            {state.output}
          </pre>
        </details>
      )}
      <div>
        <Button disabled={disabled} onClick={() => onAction('revoke_replay')}>
          {t.replayOff}
        </Button>
      </div>
    </div>
  );
}

/** A promise the user decided on that the agent rewrote or removed: keep the agent's change or put the user's back. */
function Guard({
  title,
  mine,
  disabled,
  onAnswer,
}: {
  title: string;
  mine?: string;
  disabled: boolean;
  onAnswer: (action: 'accept' | 'restore') => void;
}) {
  const t = useMessages(messages);
  return (
    <div data-guard className="mt-1 flex flex-col gap-2 rounded-lg border border-attention p-3">
      <p className="text-body font-medium text-attention">{title}</p>
      {mine && <p className="text-meta text-fg-muted">{t.yourVersion(mine)}</p>}
      <div className="flex gap-2">
        <Button disabled={disabled} onClick={() => onAnswer('accept')}>
          {t.acceptChange}
        </Button>
        <Button disabled={disabled} onClick={() => onAnswer('restore')}>
          {t.restoreMine}
        </Button>
      </div>
    </div>
  );
}

/** Keeps a click on a button inside a <summary> from also opening or closing the promise. */
const inSummary = (run: () => void) => (event: React.MouseEvent) => {
  event.preventDefault();
  event.stopPropagation();
  run();
};

export function Conditions({
  cwd,
  node,
  state,
  provenance,
  images,
  issue,
  readOnly = false,
  editLocked = false,
  onRecheck,
  onNotARule,
  onFix,
}: {
  cwd: string;
  node: FlowNode;
  /** What the server computed about this feature's promises. */
  state?: NodeState;
  /** Provenance labels keyed "<nodeId>/<conditionId>", aligned with each check's observations. */
  provenance?: Record<string, ObservationProvenance[]>;
  /** Check pictures, loaded when the feature opens. */
  images?: FlowNodeResult;
  /** The problem shown above; a failed promise saying the same thing is not repeated. */
  issue?: string;
  readOnly?: boolean;
  /** A session of the project is working: sentences wait, since its agent may be writing the same card. */
  editLocked?: boolean;
  /** Asks for this feature to be checked again. */
  onRecheck: () => void;
  /** The user says an AI-guessed rule is not a rule: ask the agent to fix or remove it. */
  onNotARule: (conditionId: string) => void;
  /** Ask the agent to make the product keep this card's failing promises. */
  onFix?: () => void;
}) {
  const t = useMessages(messages);
  const act = usePromiseAction();
  const edit = useEditFlow();
  const review = useReviewFlow();
  const [help, setHelp] = useState(false);
  // The promise being rewritten, or "new" while one is added.
  const [editing, setEditing] = useState<string | null>(null);
  const results = conditionResults(node, state);
  const labels: Record<PromiseStatus, string> = {
    passed: t.passed,
    failed: t.failed,
    blocked: t.blocked,
    recheck: t.recheck,
    unconfirmed: t.unconfirmed,
  };
  const run = (
    conditionId: string,
    action: PromiseAction,
    extra: { reason?: string; key?: string } = {},
    done?: () => void,
  ) =>
    act.mutate(
      {
        cwd,
        nodeId: node.id,
        conditionId,
        action,
        ...(extra.reason ? { reason: extra.reason } : {}),
        ...(extra.key ? { key: extra.key } : {}),
      },
      { onSuccess: done },
    );
  const write = (conditionId: string | null, value: string, done: () => void) =>
    edit.mutate({ cwd, nodeId: node.id, field: 'promise', conditionId, value }, { onSuccess: done });
  const answer = (conditionId: string, action: 'accept' | 'restore') =>
    review.mutate({ cwd, target: 'promise', action, nodeId: node.id, conditionId });
  const failure = [act, edit, review].find((m) => m.isError)?.error;
  const busy = act.isPending || edit.isPending || review.isPending;
  const canEdit = !readOnly && !editLocked;
  return (
    <section aria-label={t.promises}>
      <h3 className="flex items-center justify-between gap-2 text-lead font-semibold">
        <span className="flex items-center gap-1.5">
          {t.promises}
          <button
            type="button"
            aria-label={t.promisesHelpLabel}
            aria-expanded={help}
            aria-controls={`promises-help-${node.id}`}
            onClick={() => setHelp((v) => !v)}
            className="cursor-pointer text-fg-faint hover:text-fg-muted"
          >
            <CircleHelp size={14} />
          </button>
        </span>
        {!!results.length && (
          <span className="text-meta font-normal text-fg-muted tabular-nums">
            {t.promiseTotal(results.filter((item) => item.status === 'passed').length, results.length)}
          </span>
        )}
      </h3>
      {help && (
        <p id={`promises-help-${node.id}`} className="mt-1 text-meta text-fg-muted">
          {t.promisesHelp}
        </p>
      )}
      {!results.length && !state?.removedPromises?.length && editing !== 'new' && (
        <div className="mt-2 rounded-lg border border-dashed border-line p-3">
          <p className="text-body">{t.noPromises}</p>
          <p className="mt-1 text-meta text-fg-muted">{t.noPromisesLead}</p>
        </div>
      )}
      {failure && (
        <p role="alert" className="mt-2 text-meta text-danger">
          {failure instanceof ServerError && failure.data?.reason === 'replay_changed'
            ? t.replayChanged
            : failure instanceof ServerError && failure.data?.reason === 'flow_busy'
              ? t.busyEdit
              : failure === act.error
                ? t.promiseFailed
                : t.editFailed}
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-2">
        {results.map(({ condition, check, status, promise }) => {
          const key = `${node.id}/${condition.id}`;
          const problem = promise?.issue ?? '';
          const origin = promise?.origin ?? 'inferred';
          const written = !!promise?.written;
          const disabled = readOnly || busy;
          if (editing === condition.id)
            return (
              <li key={condition.id} className="rounded-lg border border-line p-3">
                <Editable
                  value={condition.expectation}
                  label={t.editSentence}
                  hint={t.editPromiseHint}
                  maxLength={2000}
                  multiline
                  allowEmpty
                  disabled={edit.isPending}
                  onSave={(value, done) => write(condition.id, value, done)}
                  onCancel={() => setEditing(null)}
                />
              </li>
            );
          // A sentence the user wrote and nothing has checked since: say so, and offer the check right on the line.
          const waiting = written && (status === 'recheck' || status === 'unconfirmed');
          const line =
            status === 'blocked' && check
              ? t.blockedReason(check.plain || check.summary)
              : waiting
                ? t.writtenUnchecked
                : written && status === 'passed'
                  ? t.keepsIt
                  : !check && origin === 'inferred'
                    ? t.codeOnly
                    : labels[status];
          return (
            <li key={condition.id}>
              <details
                className={clsx('rounded-lg border p-3', problem === 'question' ? 'border-attention' : 'border-line')}
              >
                <summary className="flex cursor-pointer gap-2 text-body">
                  <span className="mt-0.5">
                    <VerificationIcon status={problem === 'question' ? 'question' : icon[status]} />
                  </span>
                  <span className="flex min-w-0 grow flex-col gap-0.5">
                    <span className={clsx(origin === 'inferred' && 'text-fg-muted')}>{condition.expectation}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span
                        className={
                          status === 'failed'
                            ? 'text-meta text-danger'
                            : status === 'recheck' && !waiting
                              ? 'text-meta text-attention'
                              : 'text-meta text-fg-muted'
                        }
                      >
                        {line}
                      </span>
                      <OriginBadge origin={origin} written={written} />
                      {promise && <IssueBadge promise={promise} />}
                      {promise?.decidedElsewhere && (
                        <span data-elsewhere-decision className="text-meta text-fg-faint">
                          {t.decidedElsewhere}
                        </span>
                      )}
                      {waiting && (
                        <Button disabled={disabled || editLocked} onClick={inSummary(onRecheck)}>
                          {t.askCheck}
                        </Button>
                      )}
                    </span>
                    <EvidenceHint check={check} provenance={provenance?.[key]} />
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={t.editSentence}
                      title={t.editSentence}
                      disabled={disabled}
                      onClick={inSummary(() => setEditing(condition.id))}
                      className="mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
                    >
                      <Pencil size={13} aria-hidden />
                    </button>
                  )}
                </summary>
                <div className="mt-3 flex flex-col gap-3 border-t border-line-subtle pt-3">
                  {promise && (
                    <IssueActions
                      promise={promise}
                      disabled={disabled}
                      onAction={(action, reason, done) => run(condition.id, action, { reason }, done)}
                      onRecheck={onRecheck}
                      onNotARule={() => onNotARule(condition.id)}
                      onFix={onFix}
                    />
                  )}
                  {origin === 'inferred' && problem !== 'question' && !promise?.reworded && (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-meta text-fg-muted">{t.originInferredHint}</p>
                      <Button disabled={disabled} onClick={() => run(condition.id, 'confirm')}>
                        {t.confirmRule}
                      </Button>
                    </div>
                  )}
                  {origin === 'confirmed' && !written && (
                    <div>
                      <Button disabled={disabled} onClick={() => run(condition.id, 'unconfirm')}>
                        {t.unconfirmRule}
                      </Button>
                    </div>
                  )}
                  {check ? (
                    <div>
                      <CheckRecord
                        check={check}
                        screenshot={images?.checkScreenshots?.[condition.id]}
                        provenance={provenance?.[key]}
                        images={Object.fromEntries(
                          (check.observations ?? []).map((_, index) => [
                            index,
                            images?.observationImages?.[`${condition.id}/${index}`],
                          ]),
                        )}
                        stamp={promise?.stamp}
                        changed={promise?.changed}
                        stale={status === 'recheck'}
                        hidePlain={
                          status === 'blocked' ||
                          (status === 'failed' && (same(check.plain, issue) || same(check.summary, issue)))
                        }
                      />
                      {check.expectation !== condition.expectation && (
                        <p className="mt-2 text-meta text-fg-muted line-through">{check.expectation}</p>
                      )}
                    </div>
                  ) : (
                    <p className="text-meta text-fg-muted">{t.unchecked}</p>
                  )}
                  <Replay
                    check={check}
                    promise={promise}
                    disabled={disabled}
                    onAction={(action, options) => run(condition.id, action, options)}
                  />
                </div>
              </details>
              {promise?.reworded && (
                <Guard
                  title={t.aiChanged}
                  mine={promise.mine}
                  disabled={disabled || !canEdit}
                  onAnswer={(action) => answer(condition.id, action)}
                />
              )}
            </li>
          );
        })}
        {state?.removedPromises?.map((gone) => (
          <li key={`removed-${gone.id}`}>
            <Guard
              title={t.aiRemovedPromise}
              mine={gone.text}
              disabled={readOnly || busy || !canEdit}
              onAnswer={(action) => answer(gone.id, action)}
            />
          </li>
        ))}
        {editing === 'new' && (
          <li className="rounded-lg border border-line p-3">
            <Editable
              value=""
              label={t.addPromise}
              hint={t.editHint}
              placeholder={t.addPromisePlaceholder}
              maxLength={2000}
              multiline
              disabled={edit.isPending}
              onSave={(value, done) => write(null, value, done)}
              onCancel={() => setEditing(null)}
            />
          </li>
        )}
      </ul>
      {canEdit && editing !== 'new' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing('new')}
          className="mt-2 inline-flex cursor-pointer items-center gap-1 text-meta text-fg-muted hover:text-fg"
        >
          <Plus size={13} aria-hidden />
          {t.addPromise}
        </button>
      )}
    </section>
  );
}
