import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useServer, useSession } from '@/shared/server';

import { messages } from './messages';
import type { WorkResult as Result } from './results';
import { WorkResult } from './WorkResult';

/** Historical comparisons use saved versions, independently of the current working files. */
export function SessionChanges({ sessionId, result }: { sessionId: string | null; result: Result | null }) {
  const t = useMessages(messages);
  const server = useServer();
  const session = useSession(sessionId);
  const [checkpointId, setCheckpointId] = useState('');
  // A TF's agents work between the session's turns: their next requests mean their last calls are over.
  const agentsWorked = session.data?.items
    .flatMap((item) => (item.kind === 'taskforce' ? item.members.map((m) => `${m.turn}${m.state}`) : []))
    .join();
  const changes = useQuery({
    queryKey: [
      'session-changes',
      sessionId,
      checkpointId,
      session.data?.items.length,
      session.data?.info.status,
      agentsWorked,
    ],
    queryFn: () =>
      server.request('session/changes', { sessionId: sessionId!, checkpointId: checkpointId || undefined }),
    enabled: Boolean(sessionId && result && session.data && !session.data.deleted),
    retry: false,
  });
  const data = changes.data;
  const shown =
    result && data?.available
      ? { ...result, files: data.files }
      : result && checkpointId
        ? { ...result, files: [] }
        : result;
  return (
    <WorkResult
      key={checkpointId}
      result={shown}
      comparison={
        <div className="flex flex-col gap-2 text-meta text-fg-muted">
          {data?.available && (
            <>
              <label className="flex items-center gap-2">
                <span className="shrink-0">{t.comparison}</span>
                <select
                  aria-label={t.comparison}
                  value={checkpointId}
                  onChange={(event) => setCheckpointId(event.target.value)}
                  className="min-w-0 grow rounded-md border border-line bg-canvas px-2 py-1 text-fg"
                >
                  <option value="">{t.cumulative}</option>
                  {[...data.checkpoints].reverse().map((checkpoint, index) => (
                    <option key={checkpoint.id} value={checkpoint.id}>
                      {data.checkpoints.length - index}. {checkpoint.label}
                      {checkpoint.status === 'running'
                        ? ` · ${t.checkpointRunning}`
                        : checkpoint.status === 'failed'
                          ? ` · ${t.checkpointFailed}`
                          : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p title={t.concurrent}>{t.checkpointScope}</p>
            </>
          )}
          {changes.isFetching && <p role="status">{t.checkpointLoading}</p>}
          {changes.error && (
            <div role="alert">
              <p>{t.checkpointError}</p>
              <button type="button" onClick={() => void changes.refetch()} className="cursor-pointer text-interactive">
                {t.retry}
              </button>
            </div>
          )}
          {data && !data.available && <p>{t.checkpointEmpty}</p>}
        </div>
      }
    />
  );
}
