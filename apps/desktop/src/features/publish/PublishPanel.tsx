import { AutoHeight, Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Check as CheckIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { AlpineSignIn, QrCode } from '@/shared/components/cloud';
import { useFormat, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import { appAddress, useCloudStatus } from '@/shared/server';

import { messages } from './messages';
import { runChecks, runPublish, type Check, type CheckState, type PublishStep, type Scenario } from './preview';

export interface PublishProject {
  name: string;
  changes: number;
  /** When it last went online; absent before the first time. */
  lastPublished?: Date;
}

type Phase = 'sign-in' | 'checks' | 'publishing' | 'done';

/**
 * The 올리기 sheet (decisions 14, 15, 17, 23 in docs/alpine-cloud.md). Signed out, it asks for the Alpine account with
 * the reason first. Then: what the AI checked, the security checks settling one by one, what changes in the data,
 * and one button. Only a secret key in the page code blocks; everything else is said in plain words with a way to
 * have the AI fix it. Publishing ends with the address and a QR code for a phone.
 */
export function PublishPanel({
  project,
  scenario = 'clean',
  signedIn = true,
  onFix,
  onEvidence,
  onPublished,
}: {
  project: PublishProject;
  scenario?: Scenario;
  signedIn?: boolean;
  onFix?: () => void;
  onEvidence?: () => void;
  onPublished?: () => void;
}) {
  const t = useMessages(messages);
  const address = appAddress(project.name, useCloudStatus().data?.appDomain);
  const [phase, setPhase] = useState<Phase>(signedIn ? 'checks' : 'sign-in');
  const [checks, setChecks] = useState<Check[]>([]);
  const [dropOk, setDropOk] = useState(false);
  const [step, setStep] = useState<{ step: PublishStep; progress: number }>({ step: 'restore', progress: 0 });

  useEffect(() => {
    if (phase !== 'checks') return;
    let current = true;
    void runChecks(scenario, (next) => current && setChecks(next));
    return () => {
      current = false;
    };
  }, [phase, scenario]);

  const settled = checks.length > 0 && checks.every((check) => check.state !== 'running');
  const blocked = checks.some((check) => check.state === 'blocked');
  const ready = settled && !blocked && (scenario !== 'drop' || dropOk);

  const publish = () => {
    setPhase('publishing');
    void runPublish((next, progress) => setStep({ step: next, progress })).then(() => {
      setPhase('done');
      onPublished?.();
    });
  };

  let body: ReactNode;
  switch (phase) {
    case 'sign-in':
      body = <AlpineSignIn reason={t.signInReason} onDone={() => setPhase('checks')} />;
      break;
    case 'checks':
      body = (
        <>
          <Header project={project} address={address} />
          <Section title={t.aiChecked}>
            <Row
              state="ok"
              text={t.aiCheckedText}
              action={<LinkButton onClick={onEvidence}>{t.evidence}</LinkButton>}
            />
          </Section>
          <Section title={t.security}>
            {checks.map((check) => (
              <SecurityRow key={check.id} check={check} onFix={onFix} />
            ))}
          </Section>
          <Section title={t.dataShape}>
            {scenario === 'drop' ? (
              <Row
                state="attention"
                text={t.dropColumn}
                action={
                  <label className="inline-flex cursor-pointer items-center gap-2 text-meta text-fg">
                    <input
                      type="checkbox"
                      checked={dropOk}
                      onChange={(event) => setDropOk(event.target.checked)}
                      className="size-3.5 cursor-pointer accent-interactive"
                    />
                    {t.dropOk}
                  </label>
                }
              />
            ) : (
              <Row state="ok" text={t.addTables} />
            )}
            <p className="pl-7 text-meta text-fg-muted">{t.restoreFirst}</p>
          </Section>
          <div className="flex justify-end pt-1">
            {blocked ? (
              <Button variant="primary" onClick={onFix}>
                {t.fixWithAi}
              </Button>
            ) : (
              <Button variant="primary" disabled={!ready} onClick={publish}>
                {t.publish}
              </Button>
            )}
          </div>
        </>
      );
      break;
    case 'publishing':
      body = <Publishing step={step.step} progress={step.progress} address={address} />;
      break;
    case 'done':
      body = <Published address={address} />;
      break;
  }

  return (
    <AutoHeight className="w-103">
      <div key={phase} className="motion-step flex flex-col gap-4">
        {body}
      </div>
    </AutoHeight>
  );
}

function Header({ project, address }: { project: PublishProject; address: string }) {
  const t = useMessages(messages);
  const format = useFormat();
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title">{t.publish}</h2>
        <span className="text-meta text-fg-muted">{t.changes(project.changes)}</span>
      </div>
      <p className="flex items-baseline justify-between gap-3">
        <span className="truncate font-mono text-meta text-fg">{address}</span>
        <span className="shrink-0 text-meta text-fg-muted">
          {project.lastPublished ? t.lastPublished(format.since(project.lastPublished)) : t.firstTime}
        </span>
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line-subtle pt-3">
      <h3 className="text-meta font-semibold text-fg-muted">{title}</h3>
      {children}
    </section>
  );
}

function SecurityRow({ check, onFix }: { check: Check; onFix?: () => void }) {
  const t = useMessages(messages);
  const text = {
    secret: check.state === 'blocked' ? t.secretFound : t.secretCheck,
    'open-api': check.state === 'attention' ? t.openApi : t.openApiFine,
    'logged-out': t.loggedOut,
    phishing: t.phishing,
  }[check.id];
  const action = check.state === 'attention' ? <LinkButton onClick={onFix}>{t.fixWithAi}</LinkButton> : undefined;
  return <Row state={check.state} text={text} action={action} />;
}

function Row({ state, text, action }: { state: CheckState; text: string; action?: ReactNode }) {
  return (
    <div className="flex gap-2">
      <Mark state={state} />
      <div className="flex min-w-0 grow flex-col items-start gap-1">
        <p
          className={clsx(
            'text-body transition-colors',
            state === 'running' ? 'text-fg-muted' : state === 'blocked' ? 'text-danger' : 'text-fg',
          )}
        >
          {text}
        </p>
        {action && <div className="motion-step -ml-1">{action}</div>}
      </div>
    </div>
  );
}

/** One mark per state, with its word for screen readers and as a pill where a word is needed on screen. */
function Mark({ state }: { state: CheckState }) {
  const t = useMessages(messages);
  const word = { running: t.checking, ok: t.ok, attention: t.attention, blocked: t.blocked }[state];
  return (
    <span className="relative mt-0.5 inline-flex size-5 shrink-0 items-center justify-center" title={word}>
      <span className="sr-only">{word}</span>
      {state === 'running' && (
        <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-interactive" />
      )}
      {state === 'ok' && (
        <CheckIcon aria-hidden="true" size={14} strokeWidth={2.25} className="motion-step text-interactive" />
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

function Publishing({ step, progress, address }: { step: PublishStep; progress: number; address: string }) {
  const t = useMessages(messages);
  const label = { restore: t.stepRestore, files: t.stepFiles, shape: t.stepShape }[step];
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title">{t.publishing}</h2>
        <p className="truncate font-mono text-meta text-fg-muted">{address}</p>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        className="h-1.5 overflow-hidden rounded-full bg-canvas-sunken"
      >
        <div
          className="h-full rounded-full bg-interactive transition-[width] duration-(--motion-panel)"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <p key={step} role="status" className="motion-step text-meta text-fg-muted">
        {label}
      </p>
    </>
  );
}

function Published({ address }: { address: string }) {
  const t = useMessages(messages);
  const [copied, setCopied] = useState(false);
  const url = `https://${address}`;
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title">{t.published}</h2>
        <p className="text-body text-fg-muted">{t.publishedLead}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="rounded-xl border border-line p-2">
          <QrCode address={url} size={132} />
        </div>
        <div className="flex min-w-0 grow flex-col gap-3">
          <p className="font-mono text-body break-all text-fg">{address}</p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              <span key={String(copied)} className="motion-step">
                {copied ? t.copied : t.copy}
              </span>
            </Button>
            <Button variant="primary" onClick={() => void openInBrowser(url)}>
              {t.open}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
