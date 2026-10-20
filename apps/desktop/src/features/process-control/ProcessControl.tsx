import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useServer } from '@/shared/server';

import { messages } from './messages';

export function ProcessControl({
  cwd,
  sessionId,
  onInspectProcess,
}: {
  cwd: string;
  sessionId?: string;
  onInspectProcess?: (id: string) => void;
}) {
  const t = useMessages(messages);
  const server = useServer();
  const client = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['processes', cwd, sessionId, 'command'],
    queryFn: () => server.request('processes/list', { cwd, sessionId, kind: 'command' }),
    refetchInterval: 750,
    retry: false,
  });
  const processes = [...(query.data?.processes ?? [])]
    .filter((p) => p.kind !== 'shell')
    .sort((a, b) => b.createdAt - a.createdAt);
  const active = processes.some((p) => p.status === 'running' || p.status === 'stopping');
  const remaining = processes.some((p) => p.status === 'stopping');
  const stop = async (id?: string, force = false) => {
    setPending(id ?? 'all');
    setError('');
    try {
      if (id) {
        await server.request('terminals/stop', { processId: id, force });
      } else {
        if (sessionId) await server.request('session/cancel', { sessionId });
        await server.request('processes/stop', { cwd, sessionId, force, kind: 'command' });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['processes', cwd, sessionId] }),
        client.invalidateQueries({ queryKey: ['terminals', cwd] }),
      ]);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(null);
    }
  };
  return (
    <section aria-label={t.title} className="flex min-h-0 grow flex-col gap-3 overflow-auto p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-meta text-fg-muted">{t.count(processes.length)}</p>
        <button
          type="button"
          disabled={!active || pending !== null}
          onClick={() => void stop()}
          className="shrink-0 cursor-pointer text-meta text-danger disabled:opacity-50"
        >
          {t.stopAll}
        </button>
      </div>
      {remaining && (
        <p role="status" className="rounded-lg border border-line p-3 text-meta text-danger">
          {t.remaining}
        </p>
      )}
      {pending && (
        <p role="status" className="text-meta text-fg-muted">
          {t.waiting}
        </p>
      )}
      {!processes.length && !query.isPending && <p className="text-body text-fg-muted">{t.empty}</p>}
      {processes.map((p) => (
        <article key={p.id} className="flex flex-col gap-2 rounded-lg border border-line p-3">
          <div className="flex flex-wrap items-center gap-3">
            <strong className="grow text-body font-medium break-words text-fg">{p.title}</strong>
            <span className="text-meta text-fg-muted">{t[p.status]}</span>
          </div>
          <pre className="overflow-x-auto rounded-md bg-canvas-sunken px-2 py-1.5 font-mono text-meta text-fg whitespace-pre-wrap break-all">
            {p.command}
          </pre>
          <div className="flex items-center gap-3 text-meta">
            <span className="grow text-fg-muted">{p.exitCode != null ? t.exitCode(p.exitCode) : ''}</span>
            {onInspectProcess && (
              <button type="button" onClick={() => onInspectProcess(p.id)} className="cursor-pointer text-interactive">
                {t.output}
              </button>
            )}
            {p.status === 'running' && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void stop(p.id)}
                className="cursor-pointer text-danger disabled:opacity-50"
              >
                {t.stop}
              </button>
            )}
            {p.status === 'stopping' && (
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void stop(p.id, true)}
                className="cursor-pointer text-danger disabled:opacity-50"
              >
                {t.force}
              </button>
            )}
          </div>
          {p.stopError && (
            <p role="alert" className="text-meta text-danger">
              {p.stopError}
            </p>
          )}
        </article>
      ))}
      {(error || query.error) && (
        <p role="alert" className="text-meta text-danger">
          {error || query.error?.message}
        </p>
      )}
    </section>
  );
}
