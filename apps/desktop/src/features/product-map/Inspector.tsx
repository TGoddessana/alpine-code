import type { FlowGetResult, FlowNode, FlowNodeResult, FlowPrepareParams, ProductFlow } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Pencil, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { ServerError, useEditFlow, useReviewFlow, useSetFlow } from '@/shared/server';

import { CheckRecord, Conditions } from './Conditions';
import { Editable } from './Editable';
import { ExecutionEvidence } from './ExecutionEvidence';
import { messages } from './messages';
import { conditionResults, PROBLEM_ISSUES, type Verification } from './model';
import { kindGroup, kindGroupIcons, VerificationLabel } from './status';

export type InspectorForm = 'flow' | 'extend' | 'change' | 'define' | 'reshape';
type Field = 'priority' | 'scope' | 'decision';

/** The panel for one selected feature, or the "new flow" form when no feature is selected. */
export function Inspector({
  cwd,
  board,
  node,
  number,
  status,
  working,
  flows,
  form,
  text,
  busy,
  running,
  hasSession,
  readOnly = false,
  editLocked = false,
  images,
  onText,
  onForm,
  onSubmit,
  onCancelForm,
  onStart,
  onConversation,
  onOpenFlow,
  onNotARule,
  onClose,
}: {
  cwd: string;
  board: FlowGetResult;
  node?: FlowNode;
  number?: string;
  status?: Verification;
  working: boolean;
  /** Flows this feature appears in. */
  flows: ProductFlow[];
  form: InspectorForm | null;
  text: string;
  busy: boolean;
  /** An agent session is already working on this feature. */
  running: boolean;
  hasSession: boolean;
  /** The map was written by a newer Alpine: nothing here may change it. */
  readOnly?: boolean;
  /** A session of the project is working: the card's sentences wait until it ends. */
  editLocked?: boolean;
  /** Check pictures of this feature, loaded when it opens. */
  images?: FlowNodeResult;
  onText: (value: string) => void;
  onForm: (form: InspectorForm) => void;
  onSubmit: () => void;
  onCancelForm: () => void;
  onStart: (action: FlowPrepareParams['action']) => void;
  onConversation: () => void;
  /** Shows this feature's card inside the given flow on the flows tab. */
  onOpenFlow?: (flow: ProductFlow) => void;
  /** An AI-guessed rule was rejected: start a change request that fixes or removes it. */
  onNotARule: (node: FlowNode, conditionId: string) => void;
  onClose: () => void;
}) {
  const t = useMessages(messages);
  const locked = busy || running || readOnly;
  const state = node && board.states?.[node.id];
  const results = node ? conditionResults(node, state) : [];
  const problems = results.filter((r) => PROBLEM_ISSUES.includes(r.promise?.issue));
  const failedPromises = problems.map((r) => r.condition.expectation);
  const orphanChecks = node?.checks?.filter((check) => !check.conditionId) ?? [];
  const issue =
    problems[0]?.check?.plain ||
    problems[0]?.check?.summary ||
    orphanChecks.find((c) => c.result === 'failed')?.plain ||
    '';
  const KindIcon = node ? kindGroupIcons[kindGroup(node.kind)] : null;
  const kindLabel = node
    ? { screen: t.kindGroupScreen, external: t.kindGroupExternal, auto: t.kindGroupAuto }[kindGroup(node.kind)]
    : '';
  const meaning = status
    ? {
        failed: t.meaningFailed,
        question: t.meaningQuestion,
        recheck: t.meaningRecheck,
        unconfirmed: t.meaningUnconfirmed,
        passed: t.meaningPassed,
        none: t.meaningNone,
      }[status]
    : '';

  const fix = () => {
    if (!node) return;
    onText(t.fixRequest(node.title, issue, failedPromises));
    onForm('change');
  };
  /** The one thing to do next for this status; a passing feature needs nothing. */
  const primary = (() => {
    if (!node || !status) return null;
    if (status === 'failed') return { label: t.fixIssue, run: fix, disabled: locked };
    if (status === 'recheck') return { label: t.recheckAction, run: () => onStart('verify'), disabled: locked };
    if (status === 'unconfirmed') return { label: t.requestCheck, run: () => onStart('verify'), disabled: locked };
    if (status === 'none') {
      return {
        label: t.definePromises,
        run: () => {
          onText(t.defineRequest(node.title));
          onForm('define');
        },
        disabled: locked,
      };
    }
    return null;
  })();
  // A failed feature with an open issue shows its fix button inside the issue box instead.
  const issueBox = status === 'failed' && !!issue;
  const verifyIsPrimary = status === 'recheck' || status === 'unconfirmed';

  return (
    <aside
      className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas-raised"
      aria-label={node?.title ?? t.add}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-canvas-raised p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 grow">
            {node && number && <p className="text-meta text-fg-muted tabular-nums">{number}</p>}
            {node ? (
              <Title
                key={node.id}
                cwd={cwd}
                node={node}
                mine={state?.overridden?.title}
                canEdit={!readOnly && !editLocked}
              />
            ) : (
              <h2 className="text-title font-semibold">{t.add}</h2>
            )}
          </div>
          <Button aria-label={t.close} disabled={busy} onClick={onClose}>
            <X size={14} />
          </Button>
        </div>
        {node && status && KindIcon && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-fg-muted">
            <span className="inline-flex items-center gap-1">
              <KindIcon size={12} />
              {kindLabel}
            </span>
            <span className={working ? 'text-interactive' : undefined}>
              {working ? t.working : t[node.phase ?? 'planned']}
            </span>
            <VerificationLabel status={status} />
            {node.tags?.map((tag) => (
              <span key={tag} className="rounded-full border border-line px-1.5">
                {tag}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-5 p-4">
        {node && status && (
          <div className="flex flex-col gap-3">
            <p className="text-body text-fg-muted">{meaning}</p>
            {issueBox && (
              <div className="rounded-lg bg-diff-removed p-3">
                <p className="text-meta font-medium text-danger">{t.openIssue}</p>
                <p className="mt-1 text-body text-danger">{issue}</p>
                <Button className="mt-3" variant="primary" disabled={locked} onClick={fix}>
                  {t.fixIssue}
                </Button>
              </div>
            )}
            {primary && !issueBox && (
              <div>
                <Button variant="primary" disabled={primary.disabled} onClick={primary.run}>
                  {primary.label}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={locked} onClick={() => onForm('change')}>
                {t.change}
              </Button>
              <Button disabled={locked} onClick={() => onForm('reshape')}>
                {t.reshape}
              </Button>
              {!verifyIsPrimary && (
                <Button disabled={locked} onClick={() => onStart('verify')}>
                  {t.verify}
                </Button>
              )}
              <Button disabled={busy || readOnly} onClick={() => onForm('extend')}>
                <Plus size={14} />
                {t.extend}
              </Button>
              {hasSession && <Button onClick={onConversation}>{t.viewConversation}</Button>}
            </div>
          </div>
        )}
        {form && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (text.trim()) onSubmit();
            }}
          >
            <label htmlFor="product-map-request" className="text-body font-medium">
              {form === 'change'
                ? t.changePrompt
                : form === 'reshape'
                  ? t.reshapePrompt
                  : form === 'define'
                    ? t.definePrompt
                    : form === 'extend'
                      ? t.branchPrompt
                      : t.newPrompt}
            </label>
            <textarea
              id="product-map-request"
              autoFocus
              rows={4}
              value={text}
              disabled={busy}
              placeholder={form === 'reshape' ? t.reshapePlaceholder : undefined}
              onChange={(event) => onText(event.target.value)}
              className="w-full resize-y rounded-lg border border-line bg-canvas p-3 text-body outline-none focus:border-interactive"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
                {busy ? t.starting : t.send}
              </Button>
              <Button disabled={busy} onClick={onCancelForm}>
                {t.cancel}
              </Button>
            </div>
          </form>
        )}
        {node && (
          <>
            {node.description && <p className="text-body text-fg-muted">{node.description}</p>}
            <Plan key={node.id} cwd={cwd} node={node} readOnly={readOnly} />
            <Conditions
              key={node.id}
              cwd={cwd}
              node={node}
              state={state}
              provenance={board.provenance}
              images={images}
              issue={issue}
              readOnly={readOnly}
              editLocked={editLocked}
              onRecheck={() => onStart('verify')}
              onNotARule={(conditionId) => onNotARule(node, conditionId)}
              onFix={readOnly ? undefined : fix}
            />
            <HowToTry
              key={`try-${node.id}`}
              cwd={cwd}
              node={node}
              mine={state?.overridden?.howToTry}
              canEdit={!readOnly && !editLocked}
            />
            <Preview
              node={node}
              preview={board.previews?.[node.id]}
              showExample={node.kind === 'screen' && !!node.example}
            />
            {!!orphanChecks.length && (
              <section>
                <h3 className="mb-1 text-lead font-semibold">{t.checks}</h3>
                {orphanChecks.map((check, index) => (
                  <details key={index} className="mb-2 rounded-lg border border-line p-3">
                    <summary className="cursor-pointer text-body">
                      <span className={check.result === 'failed' ? 'text-danger' : 'text-fg-muted'}>
                        {check.result === 'passed' ? t.passed : check.result === 'failed' ? t.failed : t.blocked}
                      </span>{' '}
                      · {check.plain || check.summary}
                    </summary>
                    <div className="mt-3">
                      <CheckRecord check={check} hidePlain />
                    </div>
                  </details>
                ))}
              </section>
            )}
            <section aria-label={t.usedIn}>
              <h3 className="mb-2 text-lead font-semibold">{t.usedIn}</h3>
              {flows.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {flows.map((flow) => (
                    <li key={flow.id}>
                      {onOpenFlow ? (
                        <button
                          type="button"
                          onClick={() => onOpenFlow(flow)}
                          className="cursor-pointer rounded-full border border-line px-2.5 py-0.5 text-meta text-fg-muted hover:bg-hover hover:text-fg"
                        >
                          {flow.title}
                        </button>
                      ) : (
                        <span className="block rounded-full border border-line px-2.5 py-0.5 text-meta text-fg-muted">
                          {flow.title}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-meta text-fg-muted">{t.noFlow}</p>
              )}
            </section>
            {!!state?.unread?.length && (
              <p data-note="unread" className="border-t border-line pt-4 text-meta text-attention">
                {t.unreadNote(state.unread.length)}
              </p>
            )}
            <details className="border-t border-line pt-4 text-meta text-fg-muted">
              <summary className="cursor-pointer">{t.technicalInfo}</summary>
              <div className="mt-3 flex flex-col gap-3">
                <p>
                  {t.technicalId}: <span className="font-mono break-all">{node.id}</span>
                </p>
                {!!state?.missing?.length && (
                  <div>
                    <p className="text-attention">{t.missingFiles}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {state.missing.map((path) => (
                        <li key={path} className="font-mono break-all">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!node.sources?.length && (
                  <div>
                    <p>{t.sources}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {node.sources.map((path) => (
                        <li key={path} className="font-mono break-all">
                          {path}
                          {state?.unread?.includes(path) && (
                            <span className="ml-1.5 font-sans text-attention">· {t.unreadMark}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {node.kind !== 'screen' && !!node.example && (
                  <div>
                    <p>{t.technicalExample}</p>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-canvas-sunken p-3 font-mono text-meta whitespace-pre-wrap">
                      {node.example}
                    </pre>
                  </div>
                )}
                <ExecutionEvidence sessionId={node.sessionId ?? null} cwd={cwd} />
              </div>
            </details>
          </>
        )}
      </div>
    </aside>
  );
}

function Preview({ node, preview, showExample }: { node: FlowNode; preview?: string; showExample: boolean }) {
  const t = useMessages(messages);
  const format = useFormat();
  if (!preview && !showExample) return null;
  const takenAt = node.previewAt ? new Date(node.previewAt) : null;
  return (
    <section>
      <h3 className="mb-2 text-lead font-semibold">{t.evidence}</h3>
      {preview && <img src={preview} alt={node.title} className="mb-1 w-full rounded-lg border border-line" />}
      {preview && takenAt && !Number.isNaN(takenAt.getTime()) && (
        <p className="mb-2 text-meta text-fg-muted">{t.previewTaken(format.since(takenAt))}</p>
      )}
      {showExample && (
        <pre className="overflow-x-auto rounded-lg bg-canvas-sunken p-3 font-mono text-meta whitespace-pre-wrap">
          {node.example}
        </pre>
      )}
    </section>
  );
}

/** The user's own planning decisions. The agent never sets these. */
function Plan({ cwd, node, readOnly }: { cwd: string; node: FlowNode; readOnly: boolean }) {
  const t = useMessages(messages);
  const set = useSetFlow();
  const [error, setError] = useState<string | null>(null);
  const [memo, setMemo] = useState(node.decision ?? '');
  const save = (field: Field, value: string | null) => {
    setError(null);
    set.mutate(
      { cwd, nodeId: node.id, field, value },
      {
        onError: (e) =>
          setError(e instanceof ServerError && e.data?.reason === 'map_read_only' ? t.readOnlyBanner : t.planFailed),
      },
    );
  };
  const saveMemo = () => {
    const value = memo.trim();
    if (value === (node.decision ?? '')) return;
    save('decision', value || null);
  };
  const choices = {
    priority: [
      ['must', t.priorityMust],
      ['should', t.priorityShould],
      ['later', t.priorityLater],
    ],
    scope: [
      ['now', t.scopeNow],
      ['next', t.scopeNext],
      ['out', t.scopeOut],
    ],
  } as const;
  const current = { priority: node.priority, scope: node.scope };
  const group = (field: 'priority' | 'scope', label: string) => (
    <div className="flex items-center justify-between gap-2">
      <span id={`plan-${field}`} className="text-body text-fg-muted">
        {label}
      </span>
      <div role="group" aria-labelledby={`plan-${field}`} className="flex rounded-lg border border-line p-0.5">
        {choices[field].map(([value, name]) => (
          <button
            key={value}
            type="button"
            aria-pressed={current[field] === value}
            disabled={set.isPending || readOnly}
            onClick={() => save(field, current[field] === value ? null : value)}
            className={clsx(
              'cursor-pointer rounded-md px-2 py-0.5 text-meta',
              current[field] === value ? 'bg-selected font-medium text-fg' : 'text-fg-muted hover:text-fg',
            )}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <section aria-label={t.plan} className="flex flex-col gap-2">
      <h3 className="text-lead font-semibold">{t.plan}</h3>
      {group('priority', t.planPriority)}
      {group('scope', t.planScope)}
      <label className="flex flex-col gap-1 text-body text-fg-muted">
        {t.planDecision}
        <input
          type="text"
          value={memo}
          maxLength={200}
          disabled={readOnly}
          placeholder={t.planDecisionHint}
          onChange={(event) => setMemo(event.target.value)}
          onBlur={saveMemo}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              saveMemo();
            }
          }}
          className="rounded-md border border-line bg-canvas px-2 py-1 text-body text-fg outline-none focus:border-interactive"
        />
      </label>
      {error && (
        <p role="alert" className="text-meta text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/** The card's title, which the user may rewrite; a later change by the agent is asked about. */
function Title({ cwd, node, mine, canEdit }: { cwd: string; node: FlowNode; mine?: string; canEdit: boolean }) {
  const t = useMessages(messages);
  const [editing, setEditing] = useState(false);
  const edit = useEditFlow();
  return (
    <div className="flex flex-col gap-1">
      {editing ? (
        <Editable
          value={node.title}
          label={t.editTitle}
          hint={t.editHint}
          maxLength={120}
          disabled={edit.isPending}
          onSave={(value, done) => edit.mutate({ cwd, nodeId: node.id, field: 'title', value }, { onSuccess: done })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <h2 className="group flex items-start gap-1 text-title font-semibold">
          <span className="min-w-0">{node.title}</span>
          {canEdit && (
            <button
              type="button"
              aria-label={t.editTitle}
              title={t.editTitle}
              onClick={() => setEditing(true)}
              className="mt-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
            >
              <Pencil size={13} aria-hidden />
            </button>
          )}
        </h2>
      )}
      <EditError error={edit.error} />
      <FieldGuard cwd={cwd} node={node} field="title" mine={mine} canEdit={canEdit} />
    </div>
  );
}

/** "직접 해 보려면": what a person needs to try the card (accounts, keys, data, commands). */
function HowToTry({ cwd, node, mine, canEdit }: { cwd: string; node: FlowNode; mine?: string; canEdit: boolean }) {
  const t = useMessages(messages);
  const [editing, setEditing] = useState(false);
  const edit = useEditFlow();
  const text = node.howToTry ?? '';
  return (
    <section aria-label={t.howToTry} className="flex flex-col gap-1.5">
      <h3 className="flex items-center gap-1 text-lead font-semibold">
        {t.howToTry}
        {canEdit && !editing && text && (
          <button
            type="button"
            aria-label={t.editSentence}
            title={t.editSentence}
            onClick={() => setEditing(true)}
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
          >
            <Pencil size={13} aria-hidden />
          </button>
        )}
      </h3>
      {editing ? (
        <Editable
          value={text}
          label={t.howToTry}
          hint={t.editHint}
          placeholder={t.howToTryPlaceholder}
          maxLength={1000}
          multiline
          allowEmpty
          disabled={edit.isPending}
          onSave={(value, done) =>
            edit.mutate({ cwd, nodeId: node.id, field: 'how_to_try', value }, { onSuccess: done })
          }
          onCancel={() => setEditing(false)}
        />
      ) : text ? (
        <p className="text-body whitespace-pre-wrap">{text}</p>
      ) : (
        <p className="flex items-center gap-2 text-meta text-fg-muted">
          {t.howToTryEmpty}
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cursor-pointer text-meta text-interactive hover:underline"
            >
              {t.howToTryWrite}
            </button>
          )}
        </p>
      )}
      <EditError error={edit.error} />
      <FieldGuard cwd={cwd} node={node} field="how_to_try" mine={mine} canEdit={canEdit} />
    </section>
  );
}

function EditError({ error }: { error: Error | null }) {
  const t = useMessages(messages);
  if (!error) return null;
  return (
    <p role="alert" className="text-meta text-danger">
      {error instanceof ServerError && error.data?.reason === 'flow_busy' ? t.busyEdit : t.editFailed}
    </p>
  );
}

/** When the agent changed a sentence the user wrote: the user's text and the keep / put back answer. */
function FieldGuard({
  cwd,
  node,
  field,
  mine,
  canEdit,
}: {
  cwd: string;
  node: FlowNode;
  field: 'title' | 'how_to_try';
  mine?: string;
  canEdit: boolean;
}) {
  const t = useMessages(messages);
  const review = useReviewFlow();
  if (mine === undefined) return null;
  const answer = (action: 'accept' | 'restore') =>
    review.mutate({ cwd, target: 'field', action, nodeId: node.id, field });
  return (
    <div data-guard className="flex flex-col gap-2 rounded-lg border border-attention p-3">
      <p className="text-body font-medium text-attention">{t.aiChanged}</p>
      <p className="text-meta text-fg-muted">{t.yourVersion(mine || '—')}</p>
      <div className="flex gap-2">
        <Button disabled={review.isPending || !canEdit} onClick={() => answer('accept')}>
          {t.acceptChange}
        </Button>
        <Button disabled={review.isPending || !canEdit} onClick={() => answer('restore')}>
          {t.restoreMine}
        </Button>
      </div>
    </div>
  );
}
