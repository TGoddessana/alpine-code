import type { PublishStatus } from '@alpine/protocol';
import { AutoHeight, Button, LinkButton } from '@alpine/ui/primitives';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AlpineSignIn, NodeInstall, QrCode, UpgradeSheet } from '@/shared/components/cloud';
import { useLocale, useMessages } from '@/shared/i18n';
import { openInBrowser } from '@/shared/platform';
import {
  appAddress,
  PUBLISH_STEPS,
  useCloudStatus,
  useProductMap,
  useSendMessage,
  type PublishFlow,
  type PublishState,
} from '@/shared/server';

import { Domains } from './Domains';
import { evidenceOf, sortChecks } from './findings';
import { messages } from './messages';
import { ProgressLine, Row, rowState } from './parts';
import { Restore } from './Restore';
import { Review, type FixAction } from './Review';

export interface PublishPanelProps {
  cwd: string;
  /** The project's name, for the address before the app exists. */
  name: string;
  /** `publish/status`; the sheet shows nothing until it is known. */
  status: PublishStatus | undefined;
  /** The publish in progress, held by the button so closing the sheet does not lose a run. */
  flow: PublishFlow;
  /** The project's session, where "AI에게 고쳐 달라고 하기" goes. Absent: the button is not offered. */
  sessionId?: string | null;
  onEvidence?: () => void;
  /** After the AI was sent a message: the sheet is not needed while it works. */
  onClose: () => void;
  /** The account or Node.js changed under `publish/status`; ask it again. */
  onStatusChange: () => void;
}

/**
 * The 올리기 sheet (decisions 14, 15, 17, 23 in docs/alpine-cloud.md) on the real `publish/*`. Signed out, it asks for
 * the Alpine account with the reason first; without Node.js it offers Alpine's own. Otherwise it builds, checks and
 * uploads at once (`publish/prepare`), shows what the AI tried, the checks, what changes in the data and one button,
 * then publishes (`publish/run`) with the confirms the person said yes to, and ends with the address and a QR code.
 */
export function PublishPanel(props: PublishPanelProps) {
  const t = useMessages(messages);
  const { status } = props;
  const [view, setView] = useState<'publish' | 'restore' | 'domains' | 'upgrade'>('publish');
  let body: ReactNode = null;
  if (status) {
    if (status.reason === 'signed_out') body = <AlpineSignIn reason={t.signInReason} onDone={props.onStatusChange} />;
    else if (status.reason === 'no_node') body = <NeedNode onReady={props.onStatusChange} />;
    else if (!status.publishable) body = <p className="text-body text-fg-muted">{t.cannot}</p>;
    else if (view === 'restore')
      body = (
        <Restore
          cwd={props.cwd}
          onBack={() => setView('publish')}
          onClose={props.onClose}
          onUpgrade={() => setView('upgrade')}
        />
      );
    else if (view === 'domains')
      body = (
        <Domains
          cwd={props.cwd}
          app={status.app}
          sessionId={props.sessionId}
          onBack={() => setView('publish')}
          onUpgrade={() => setView('upgrade')}
          onClose={props.onClose}
        />
      );
    else if (view === 'upgrade')
      body = <UpgradeSheet onBack={() => setView('publish')} onDone={() => setView('publish')} />;
    else
      body = (
        <Publisher
          {...props}
          status={status}
          onRestore={() => setView('restore')}
          onDomains={() => setView('domains')}
        />
      );
  }
  return (
    <AutoHeight className="w-103">
      <div key={status ? `${status.reason ?? 'ok'}-${view}` : 'loading'} className="motion-step flex flex-col gap-4">
        {body}
      </div>
    </AutoHeight>
  );
}

function NeedNode({ onReady }: { onReady: () => void }) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-title">{t.needNodeTitle}</h2>
        <p className="text-body text-fg-muted">{t.needNodeLead}</p>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t.needNodeInstall}
        </Button>
      </div>
      <NodeInstall
        open={open}
        onReady={() => {
          setOpen(false);
          onReady();
        }}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

function Publisher({
  cwd,
  name,
  status,
  flow,
  sessionId,
  onEvidence,
  onClose,
  onStatusChange,
  onRestore,
  onDomains,
}: PublishPanelProps & { status: PublishStatus; onRestore: () => void; onDomains: () => void }) {
  const { locale } = useLocale();
  const cloud = useCloudStatus().data;
  const map = useProductMap(cwd);
  const send = useSendMessage();
  const changes = status.changes ?? 0;
  const state = flow.state;

  // Opening the sheet starts a prepare, unless one is working or its plan still matches what is on disk.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const keep =
      state.status === 'preparing' ||
      state.status === 'running' ||
      (state.status === 'ready' && state.changes === changes) ||
      (state.status === 'done' && changes === 0);
    if (!keep) flow.prepare(locale, changes);
    // Only on opening; later changes of `status` must not start another prepare.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fix: FixAction = {
    send: sessionId ? (text) => send.mutate({ sessionId, text }, { onSuccess: onClose }) : undefined,
    sending: send.isPending,
    failed: send.isError,
  };
  const address =
    (state.status === 'done' && state.app.address) || status.app?.address || appAddress(name, cloud?.appDomain);

  switch (state.status) {
    case 'idle':
    case 'preparing':
      return <Preparing state={state} address={address} onStop={() => (flow.cancel(), onClose())} />;
    case 'ready':
      return (
        <Review
          project={address}
          plan={state.plan}
          app={state.plan.app ?? status.app}
          status={status}
          evidence={evidenceOf(map.data)}
          fix={fix}
          onEvidence={onEvidence}
          onPublish={flow.run}
          onRestore={onRestore}
          onDomains={onDomains}
        />
      );
    case 'running':
      return <Publishing state={state} address={address} />;
    case 'done':
      return <Published state={state} onRestore={onRestore} onDomains={onDomains} />;
    case 'failed':
      return (
        <Failed
          state={state}
          fix={fix}
          onAgain={() => flow.prepare(locale, changes)}
          onSignedIn={() => {
            onStatusChange();
            flow.prepare(locale, changes);
          }}
        />
      );
  }
}

const PHASES = ['build', 'checks', 'upload'];

function Preparing({
  state,
  address,
  onStop,
}: {
  state: Extract<PublishState, { status: 'idle' | 'preparing' }>;
  address: string;
  onStop: () => void;
}) {
  const t = useMessages(messages);
  const phase = state.status === 'preparing' ? state.phase : 'build';
  const index = Math.max(0, PHASES.indexOf(phase));
  const progress = state.status === 'preparing' ? (index + state.progress) / PHASES.length : 0;
  const label = { build: t.prepareBuild, checks: t.prepareChecks, upload: t.prepareUpload }[phase] ?? t.prepareOther;
  const checks = state.status === 'preparing' ? sortChecks(state.checks) : [];
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title">{t.publish}</h2>
        <p className="truncate font-mono text-meta text-fg-muted">{address}</p>
      </div>
      <ProgressLine progress={progress} />
      <p key={phase} role="status" className="motion-step text-meta text-fg-muted">
        {label}
      </p>
      {checks.map((check) => (
        <Row
          key={check.id}
          state={rowState(check.state)}
          text={
            check.state === 'running'
              ? t.checkRunning(check.id) || t.checking
              : check.state === 'ok'
                ? t.checkOk(check.id) || t.ok
                : t.checkOther(check.id)
          }
        />
      ))}
      <div className="flex justify-end">
        <LinkButton onClick={onStop}>{t.stop}</LinkButton>
      </div>
    </>
  );
}

function Publishing({ state, address }: { state: Extract<PublishState, { status: 'running' }>; address: string }) {
  const t = useMessages(messages);
  const label =
    { restore: t.stepRestore, files: t.stepFiles, shape: t.stepShape, live: t.stepLive }[state.step] ?? t.stepOther;
  const progress = (state.done.length + (state.done.includes(state.step) ? 0 : 0.5)) / PUBLISH_STEPS.length;
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title">{t.publishing}</h2>
        <p className="truncate font-mono text-meta text-fg-muted">{address}</p>
      </div>
      <ProgressLine progress={Math.min(progress, 1)} />
      <p key={state.step} role="status" className="motion-step text-meta text-fg-muted">
        {label}
      </p>
    </>
  );
}

function Published({
  state,
  onRestore,
  onDomains,
}: {
  state: Extract<PublishState, { status: 'done' }>;
  onRestore: () => void;
  onDomains: () => void;
}) {
  const t = useMessages(messages);
  const [copied, setCopied] = useState(false);
  const { app } = state;
  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title">{t.published}</h2>
        <p className="text-body text-fg-muted">{t.publishedLead}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="rounded-xl border border-line p-2">
          <QrCode address={app.url} size={132} />
        </div>
        <div className="flex min-w-0 grow flex-col gap-3">
          <p className="font-mono text-body break-all text-fg">{app.address}</p>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(app.url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
            >
              <span key={String(copied)} className="motion-step">
                {copied ? t.copied : t.copy}
              </span>
            </Button>
            <Button variant="primary" onClick={() => void openInBrowser(app.url)}>
              {t.open}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <LinkButton className="-ml-1" onClick={onRestore}>
          {t.restorePoints}
        </LinkButton>
        <LinkButton onClick={onDomains}>{t.domainsLink}</LinkButton>
      </div>
    </>
  );
}

/** The last lines of a failed build, as the server sent them. */
const buildTail = (message: string) => message.split('\n').slice(-40).join('\n');

function Failed({
  state,
  fix,
  onAgain,
  onSignedIn,
}: {
  state: Extract<PublishState, { status: 'failed' }>;
  fix: FixAction;
  onAgain: () => void;
  onSignedIn: () => void;
}) {
  const t = useMessages(messages);
  const { failure, during } = state;
  if (failure.reason === 'signed_out') return <AlpineSignIn reason={t.signInReason} onDone={onSignedIn} />;

  const build = failure.reason === 'build_failed';
  const known = (failure.reason && t.failure(failure.reason)) || undefined;
  const title = build ? t.buildFailedTitle : during === 'run' ? t.runFailedTitle : t.prepareFailedTitle;
  const lead = build ? t.buildFailedLead : during === 'run' ? t.runFailedLead : (known ?? t.failureOther);
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-title">{title}</h2>
        <p role="alert" className="text-body text-fg-muted">
          {lead}
        </p>
        {known && during === 'run' && <p className="text-body text-fg-muted">{known}</p>}
      </div>
      {failure.message && (build || !known) && (
        <pre
          aria-label={t.detail}
          className="max-h-40 overflow-auto rounded-lg bg-canvas-sunken p-2 font-mono text-meta whitespace-pre-wrap text-fg-muted"
        >
          {build ? buildTail(failure.message) : failure.message}
        </pre>
      )}
      {fix.failed && (
        <p role="alert" className="text-meta text-danger">
          {t.fixFailed}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onAgain}>{t.again}</Button>
        {build && fix.send && (
          <Button
            variant="primary"
            disabled={fix.sending}
            onClick={() => fix.send?.(t.buildFixMessage(buildTail(failure.message)))}
          >
            {t.fixWithAi}
          </Button>
        )}
      </div>
    </>
  );
}
