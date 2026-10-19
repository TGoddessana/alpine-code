import type { AppInfo, Check, PublishPlan, PublishStatus, ShapeConfirm } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import { fixMessage, place, sentence, sortChecks, troubles, type Evidence } from './findings';
import { messages } from './messages';
import { Row, rowState, Section, type RowState } from './parts';

type Copy = (typeof messages)['ko'];

export interface FixAction {
  /** Sends the text to the project's session; absent when there is no session to send it to. */
  send?: (text: string) => void;
  sending: boolean;
  failed: boolean;
}

/** What each change that needs a yes says, in plain words. Kinds are an open enum: an unknown one still asks. */
function confirmText(confirm: ShapeConfirm, t: Copy): string {
  const table = confirm.table ?? '';
  switch (confirm.kind) {
    case 'drop_column':
      return t.confirmDropColumn(table, confirm.column ?? '');
    case 'drop_table':
      return t.confirmDropTable(table);
    case 'rename_table':
      return t.confirmRename(table, null);
    case 'rename_column':
      return t.confirmRename(table, confirm.column ?? '');
    case 'data_change':
      return t.confirmDataChange(confirm.table ?? null);
    case 'unknown':
      return t.confirmUnknown;
    default:
      return t.confirmOther;
  }
}

/**
 * The sheet once the build, the checks and the upload are done: what the AI tried, the security checks, what changes
 * in the data, and the one button. Only a secret key in the page code blocks; every drop, rename, data change or
 * statement nobody understood needs its own OK before 올리기 turns on (decision 15).
 */
export function Review({
  project,
  plan,
  app,
  status,
  evidence,
  fix,
  onEvidence,
  onPublish,
  onRestore,
  onDomains,
}: {
  project: string;
  plan: PublishPlan;
  app: AppInfo | null | undefined;
  status: PublishStatus;
  evidence: Evidence;
  fix: FixAction;
  onEvidence?: () => void;
  onPublish: (confirm: string[]) => void;
  onRestore: () => void;
  onDomains: () => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const confirms = plan.shape.confirms ?? [];
  const [ok, setOk] = useState<string[]>([]);
  const left = confirms.filter((confirm) => !ok.includes(confirm.id)).length;
  const checks = sortChecks(plan.checks);
  const added = plan.shape.added;
  const tables = added?.tables ?? [];
  const columns = (added?.columns ?? []).map((column) => `${column.table}.${column.column}`);
  const askFix = (checkList: Check[]) => fix.send?.(fixMessage(troubles(checkList), t));

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-title">{t.publish}</h2>
          <span className="text-meta text-fg-muted">{t.changes(status.changes ?? 0)}</span>
        </div>
        <p className="flex items-baseline justify-between gap-3">
          <span className="truncate font-mono text-meta text-fg">{app?.address ?? project}</span>
          <span className="shrink-0 text-meta text-fg-muted">
            {status.lastPublishedAt ? t.lastPublished(format.since(new Date(status.lastPublishedAt))) : t.firstTime}
          </span>
        </p>
      </div>
      <Section title={t.aiChecked}>
        <Row
          state={evidence.passed > 0 ? 'ok' : 'skipped'}
          text={evidence.total > 0 ? t.aiCheckedCount(evidence.passed, evidence.total) : t.aiCheckedNothing}
          action={onEvidence && <LinkButton onClick={onEvidence}>{t.evidence}</LinkButton>}
        />
        {evidence.notes.map((note) => (
          <p key={note} className="pl-7 text-meta text-fg-muted">
            {note}
          </p>
        ))}
      </Section>
      <Section title={t.security}>
        {checks.map((check) => (
          <CheckRows key={check.id} check={check} blocked={plan.blocked} fix={fix} onFix={() => askFix([check])} />
        ))}
      </Section>
      <Section title={t.dataShape}>
        {tables.length > 0 && <Row state="ok" text={t.addedTables(tables.join(', '))} />}
        {columns.length > 0 && <Row state="ok" text={t.addedColumns(columns.join(', '))} />}
        {tables.length === 0 && columns.length === 0 && confirms.length === 0 && (
          <Row state="ok" text={t.noDataChange} />
        )}
        {confirms.map((confirm) => (
          <Row
            key={confirm.id}
            state="attention"
            text={confirmText(confirm, t)}
            detail={
              [confirm.statement, confirm.rowsAffected != null ? t.confirmRows(confirm.rowsAffected) : null]
                .filter(Boolean)
                .join(' · ') || null
            }
            action={
              <label className="inline-flex cursor-pointer items-center gap-2 text-meta text-fg">
                <input
                  type="checkbox"
                  checked={ok.includes(confirm.id)}
                  onChange={(event) =>
                    setOk((current) =>
                      event.target.checked ? [...current, confirm.id] : current.filter((id) => id !== confirm.id),
                    )
                  }
                  className="size-3.5 cursor-pointer accent-interactive"
                />
                {t.confirmOk}
              </label>
            }
          />
        ))}
        <p className="pl-7 text-meta text-fg-muted">{t.restoreFirst}</p>
      </Section>
      <div className="flex items-center justify-between gap-3 pt-1">
        {app ? (
          <span className="flex items-center gap-3">
            <LinkButton onClick={onRestore}>{t.restorePoints}</LinkButton>
            <LinkButton onClick={onDomains}>{t.domainsLink}</LinkButton>
          </span>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {!plan.blocked && left > 0 && <span className="text-meta text-fg-muted">{t.confirmsLeft(left)}</span>}
          {plan.blocked ? (
            fix.send && (
              <Button variant="primary" disabled={fix.sending} onClick={() => askFix(checks)}>
                {t.fixWithAi}
              </Button>
            )
          ) : (
            <Button variant="primary" disabled={left > 0} onClick={() => onPublish(ok)}>
              {t.publish}
            </Button>
          )}
        </div>
      </div>
      {fix.failed && (
        <p role="alert" className="text-meta text-danger">
          {t.fixFailed}
        </p>
      )}
    </>
  );
}

function CheckRows({
  check,
  blocked,
  fix,
  onFix,
}: {
  check: Check;
  /** The footer's button already asks the AI to fix what blocks, so a row does not offer it a second time. */
  blocked: boolean;
  fix: FixAction;
  onFix: () => void;
}) {
  const t = useMessages(messages);
  const findings = check.findings ?? [];
  const state = rowState(check.state);
  if (findings.length === 0 || state === 'running' || state === 'ok' || state === 'skipped') {
    const text = {
      running: t.checkRunning(check.id) || t.checking,
      ok: t.checkOk(check.id) || t.ok,
      skipped: t.checkSkipped(check.id) || t.skipped,
      attention: t.checkOther(check.id),
      blocked: t.checkOther(check.id),
    }[state];
    return <Row state={state} text={text} />;
  }
  return (
    <>
      {findings.map((finding, index) => {
        const mark: RowState =
          finding.severity === 'block' ? 'blocked' : finding.severity === 'info' ? 'ok' : 'attention';
        const last = index === findings.length - 1;
        return (
          <Row
            key={`${finding.code}-${finding.file}-${finding.line}-${index}`}
            state={mark}
            text={sentence(finding, t)}
            detail={place(finding, t)}
            action={
              last && !blocked && fix.send ? (
                <LinkButton disabled={fix.sending} onClick={onFix}>
                  {t.fixWithAi}
                </LinkButton>
              ) : undefined
            }
          />
        );
      })}
    </>
  );
}
