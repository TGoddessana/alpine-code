import type { DataRead } from '@alpine/protocol';
import { LinkButton } from '@alpine/ui/primitives';

import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * What the AI read from the live data (decision 15): when, the question it asked in SQL, which tables, how many rows
 * came back. Newest first, kept 30 days; the person can always see what the AI looked at.
 */
export function ReadLog({ reads, onBack }: { reads: DataRead[]; onBack: () => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  return (
    <div className="motion-step flex min-h-0 grow flex-col">
      <div className="px-2 pb-1">
        <LinkButton autoFocus onClick={onBack}>
          {t.readsBack}
        </LinkButton>
      </div>
      <div className="min-h-0 grow overflow-y-auto px-3 pb-3">
        <h2 className="text-body font-medium text-fg">{t.readsTitle}</h2>
        <p className="pb-2 text-meta text-fg-muted">{t.readsHint}</p>
        {reads.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-meta text-fg-muted">
            {t.readsEmpty}
          </p>
        ) : (
          <ul className="flex flex-col">
            {reads.map((read, index) => {
              const at = new Date(read.at);
              return (
                <li
                  key={`${read.at}/${index}`}
                  className="flex flex-col gap-1 border-b border-line-subtle py-2.5 last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-2 text-meta text-fg-muted">
                    <time dateTime={read.at}>
                      {format.date(at)} {format.time(at)}
                    </time>
                    <span className="tabular-nums">
                      {read.tables?.length ? `${t.readIn(read.tables.join(', '))} · ` : ''}
                      {t.readRows(format.number(read.rows ?? 0))}
                    </span>
                  </div>
                  <code className="block overflow-x-auto rounded-md bg-canvas-sunken px-2 py-1.5 font-mono text-meta whitespace-pre-wrap break-words text-fg">
                    {read.sql}
                  </code>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
