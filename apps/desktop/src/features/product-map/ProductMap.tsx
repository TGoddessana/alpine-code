import type { FlowNode, FlowPrepareParams, FlowPrepareResult, ProductFlow } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import { GitBranchPlus, MessageSquare, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';
import {
  ServerError,
  useNewSession,
  usePrepareFlow,
  useProductMap,
  useSendMessage,
  useSession,
  useSessions,
} from '@/shared/server';

import { Conditions } from './Conditions';
import { ExecutionEvidence } from './ExecutionEvidence';
import { FlowCanvas } from './FlowCanvas';
import { messages } from './messages';
import { nodeState } from './model';

type Action = FlowPrepareParams['action'];

export function ProductMap({
  cwd,
  sessionId = null,
  conversation,
  onSession,
  demo = false,
}: {
  cwd: string;
  sessionId?: string | null;
  conversation?: ReactNode;
  onSession: (id: string) => void;
  demo?: boolean;
}) {
  const t = useMessages(messages);
  const board = useProductMap(cwd);
  const sessions = useSessions().data ?? [];
  const live = useSession(sessionId);
  const create = useNewSession();
  const prepare = usePrepareFlow();
  const send = useSendMessage();
  const [selection, setSelection] = useState<{ node: string; flow: string } | null>(null);
  const [form, setForm] = useState<'extend' | 'change' | null>(null);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<'feature' | 'chat'>('feature');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<Action | null>(null);
  // A failed send retries exactly the prepared prompt and branch, rather than creating duplicate work.
  const attempt = useRef<{ key: string; session: string; prepared?: FlowPrepareResult } | null>(null);
  const data = board.data;
  const node = data?.document.nodes?.find((n) => n.id === selection?.node);
  const selectedSession = sessions.find((s) => s.id === node?.sessionId);
  const nodeRunning = selectedSession?.status === 'running' || selectedSession?.status === 'waiting';
  const active = live.data?.info.status === 'running' || live.data?.info.status === 'waiting';

  const start = async (action: Action) => {
    if (!data || board.isError || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setRetryAction(action);
    const key = JSON.stringify([cwd, action, selection, text]);
    try {
      if (attempt.current?.key !== key) {
        const info = await create.mutateAsync({ cwd });
        attempt.current = { key, session: info.id };
      }
      const current = attempt.current;
      if (!current.prepared) {
        current.prepared = await prepare.mutateAsync({
          cwd,
          revision: data.revision,
          action,
          request: text || (action === 'discover' ? t.discoveryRequest : t.checkRequest(node?.title ?? '')),
          nodeId: action === 'discover' ? null : (node?.id ?? null),
          flowId: action === 'discover' || selection?.flow === '__unassigned' ? null : (selection?.flow ?? null),
          sessionId: current.session,
        });
      }
      await send.mutateAsync({ sessionId: current.session, text: current.prepared.prompt });
      if (current.prepared.nodeId) {
        const flow = current.prepared.board.document.flows?.find((f) => f.nodeIds?.includes(current.prepared!.nodeId!));
        setSelection({ node: current.prepared.nodeId, flow: flow?.id ?? '__unassigned' });
      }
      onSession(current.session);
      setPanel('chat');
      attempt.current = null;
      setForm(null);
      setText('');
      setRetryAction(null);
    } catch (error) {
      setError(
        error instanceof ServerError && error.data?.reason === 'flow_conflict'
          ? t.conflict
          : error instanceof Error
            ? error.message
            : t.failed,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const select = (node: FlowNode, flow: ProductFlow) => {
    if (busy) return;
    setSelection({ node: node.id, flow: flow.id });
    setPanel('feature');
    setForm(null);
    setText('');
    setError(null);
    setRetryAction(null);
  };
  const close = () => {
    setSelection(null);
    setForm(null);
    setText('');
    setError(null);
    setRetryAction(null);
  };
  const shared = data?.document.flows?.filter((f) => f.nodeIds?.includes(node?.id ?? '')) ?? [];

  return (
    <main className="flex min-h-0 min-w-0 grow flex-col bg-canvas" aria-label={t.title}>
      <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-2">
        <GitBranchPlus size={20} className="text-interactive" />
        <div className="mr-auto">
          <h1 className="text-title font-semibold">{t.title}</h1>
          <p className="text-meta text-fg-muted">{demo ? t.demo : cwd.split('/').pop()}</p>
        </div>
        {sessionId && (
          <Button onClick={() => setPanel((p) => (p === 'chat' ? 'feature' : 'chat'))}>
            <MessageSquare size={15} />
            {t.conversation}
          </Button>
        )}
        <Button disabled={busy || active || !data || board.isError} onClick={() => void start('discover')}>
          <RefreshCw size={15} />
          {t.refresh}
        </Button>
        <Button
          disabled={busy || !data || board.isError}
          onClick={() => {
            close();
            setPanel('feature');
            setForm('extend');
          }}
        >
          <Plus size={15} />
          {t.add}
        </Button>
      </header>
      {sessionId && (
        <button
          className="flex cursor-pointer items-center gap-2 border-b border-line bg-canvas-sunken px-5 py-2 text-left text-meta text-fg-muted"
          onClick={() => setPanel('chat')}
        >
          <MessageSquare size={13} />
          {live.data?.info.status === 'waiting' ? t.needsApproval : active ? t.workingSession : t.sessionFinished}
        </button>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-line bg-diff-removed px-5 py-3 text-body text-danger"
        >
          <span className="min-w-0 grow break-words">{error}</span>
          {retryAction && (
            <Button disabled={busy} onClick={() => void start(retryAction)}>
              {t.retry}
            </Button>
          )}
        </div>
      )}
      {board.isError && data && (
        <p role="alert" className="border-b border-line bg-diff-removed px-5 py-2 text-meta text-danger">
          {t.loadFailed}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 grow">
        {board.isError && !data ? (
          <div className="flex grow flex-col items-center justify-center gap-3 p-8">
            <p role="alert" className="text-body text-danger">
              {t.loadFailed}
            </p>
            <Button onClick={() => void board.refetch()}>{t.retry}</Button>
          </div>
        ) : !data ? (
          <p className="p-8 text-body text-fg-muted">{t.loading}</p>
        ) : !(data.document.nodes?.length || data.document.flows?.length) ? (
          <div className="flex min-w-0 grow flex-col items-center justify-center gap-4 p-8 text-center">
            <GitBranchPlus size={42} strokeWidth={1} className="text-interactive" />
            <h2 className="text-display font-semibold">{t.empty}</h2>
            <p className="max-w-100 text-reading text-fg-muted">{t.emptyLead}</p>
            <Button variant="primary" disabled={busy || active} onClick={() => void start('discover')}>
              <Search size={16} />
              {busy ? t.starting : t.discover}
            </Button>
          </div>
        ) : (
          <FlowCanvas board={data} sessions={sessions} selected={node?.id ?? null} onSelect={select} />
        )}
        {panel === 'chat' && conversation ? (
          <aside className="flex w-120 shrink-0 flex-col border-l border-line" aria-label={t.conversation}>
            <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
              <h2 className="text-lead">{t.conversation}</h2>
              <Button aria-label={t.close} onClick={() => setPanel('feature')}>
                <X size={14} />
              </Button>
            </div>
            {conversation}
          </aside>
        ) : (
          (node || form) && (
            <aside
              className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas-raised p-5"
              aria-label={node?.title ?? t.add}
            >
              <div className="mb-4 flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-title font-semibold">{node?.title ?? t.add}</h2>
                  {node && (
                    <p className="text-meta text-fg-muted">
                      {t[node.kind ?? 'process']} · {t[nodeState(node, sessions)]}
                    </p>
                  )}
                </div>
                <Button aria-label={t.close} disabled={busy} onClick={close}>
                  <X size={14} />
                </Button>
              </div>
              {node?.description && <p className="mb-3 text-body">{node.description}</p>}
              {shared.length > 1 && (
                <p className="mb-3 text-meta text-interactive">
                  {t.shared(shared.length)} · {shared.map((f) => f.title).join(' / ')}
                </p>
              )}
              {node?.issue && <p className="mb-4 rounded-lg bg-diff-removed p-3 text-body text-danger">{node.issue}</p>}
              {node && !form && (
                <div className="mb-5 flex flex-wrap gap-2">
                  <Button disabled={busy || nodeRunning} onClick={() => setForm('change')}>
                    {t.change}
                  </Button>
                  <Button disabled={busy} variant="primary" onClick={() => setForm('extend')}>
                    <Plus size={14} />
                    {t.extend}
                  </Button>
                  <Button disabled={busy || nodeRunning} onClick={() => void start('verify')}>
                    {t.verify}
                  </Button>
                  {!node.conditions?.length && (
                    <Button
                      disabled={busy || nodeRunning}
                      onClick={() => {
                        setText(t.defineRequest(node.title));
                        setForm('change');
                      }}
                    >
                      {t.definePromises}
                    </Button>
                  )}
                  {node.sessionId && (
                    <Button
                      onClick={() => {
                        onSession(node.sessionId!);
                        setPanel('chat');
                      }}
                    >
                      {t.viewConversation}
                    </Button>
                  )}
                </div>
              )}
              {form && (
                <form
                  className="mb-5 flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (text.trim()) void start(form);
                  }}
                >
                  <label htmlFor="product-map-request" className="text-body font-medium">
                    {form === 'change' ? t.changePrompt : node ? t.branchPrompt : t.newPrompt}
                  </label>
                  <textarea
                    id="product-map-request"
                    autoFocus
                    rows={4}
                    value={text}
                    disabled={busy}
                    onChange={(event) => {
                      setText(event.target.value);
                      setError(null);
                    }}
                    className="w-full resize-y rounded-lg border border-line bg-canvas p-3 text-body outline-none focus:border-interactive"
                  />
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" disabled={busy || !text.trim()}>
                      {busy ? t.starting : t.send}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setForm(null);
                        setText('');
                      }}
                    >
                      {t.cancel}
                    </Button>
                  </div>
                </form>
              )}
              {node && (
                <>
                  {data?.previews?.[node.id] && (
                    <img
                      src={data.previews[node.id]}
                      alt={node.title}
                      className="mb-4 w-full rounded-lg border border-line"
                    />
                  )}
                  {node.example && (
                    <pre className="mb-4 overflow-x-auto rounded-lg bg-canvas-sunken p-3 font-mono text-meta whitespace-pre-wrap">
                      {node.example}
                    </pre>
                  )}
                  <ExecutionEvidence sessionId={node.sessionId ?? null} cwd={cwd} />
                  <Conditions node={node} staleIds={data?.staleConditions?.[node.id]} />
                  {!!node.checks?.some((check) => !check.conditionId) && (
                    <>
                      <h3 className="mt-5 mb-2 text-lead font-semibold">{t.checks}</h3>
                      <p className="mb-3 text-meta text-fg-muted">{t.reportNote}</p>
                      {data?.staleChecks?.includes(node.id) && (
                        <p className="mb-3 rounded-md bg-canvas-sunken p-2 text-meta text-attention">{t.stale}</p>
                      )}
                      {!node.checks?.filter((check) => !check.conditionId).length && (
                        <p className="text-body text-fg-muted">{t.unchecked}</p>
                      )}
                      {node.checks
                        ?.filter((check) => !check.conditionId)
                        .map((check, index) => (
                          <details key={index} className="mb-3 rounded-lg border border-line p-3">
                            <summary className="cursor-pointer text-body">
                              <span className={check.result === 'failed' ? 'text-danger' : 'text-fg-muted'}>
                                {check.result === 'passed'
                                  ? t.passed
                                  : check.result === 'failed'
                                    ? t.failedCheck
                                    : t.blocked}
                              </span>{' '}
                              · {check.summary}
                            </summary>
                            <pre className="mt-3 overflow-x-auto font-mono text-meta whitespace-pre-wrap">
                              {check.command}
                              {'\n\n'}
                              {check.output}
                            </pre>
                          </details>
                        ))}
                    </>
                  )}
                  {!!node.sources?.length && (
                    <details className="mt-5">
                      <summary className="cursor-pointer text-meta text-fg-muted">{t.sources}</summary>
                      <ul className="mt-2 flex flex-col gap-1">
                        {node.sources.map((path) => (
                          <li key={path} className="break-all font-mono text-meta text-fg-muted">
                            {path}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </aside>
          )
        )}
      </div>
    </main>
  );
}
