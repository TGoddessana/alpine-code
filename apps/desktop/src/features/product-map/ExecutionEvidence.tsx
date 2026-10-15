import { useMessages } from '@/shared/i18n';
import { useSession } from '@/shared/server';

import { messages } from './messages';

/** The execution log is separate from the agent's own claims in the map document. */
export function ExecutionEvidence({ sessionId, cwd }: { sessionId: string | null; cwd: string }) {
  const t = useMessages(messages);
  const session = useSession(sessionId);
  if (session.data?.info.cwd !== cwd || session.data.deleted) return null;
  const calls = session.data.items.filter((item) => item.kind === 'tool_call' && item.name === 'bash');
  if (!calls.length) return null;
  return (
    <details>
      <summary className="cursor-pointer">{t.inspect}</summary>
      {calls.map(
        (item) =>
          item.kind === 'tool_call' && (
            <details key={item.id} className="mt-3 rounded-lg bg-canvas-sunken p-2">
              <summary className="cursor-pointer break-all font-mono text-meta">
                {String(item.args.command ?? item.name)} · {item.status}
              </summary>
              <pre className="mt-2 max-h-60 overflow-auto font-mono text-meta whitespace-pre-wrap">{item.result}</pre>
            </details>
          ),
      )}
    </details>
  );
}
