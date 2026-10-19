import clsx from 'clsx';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { DataType, DataValue } from './types';
import { localTime } from './values';

/** One value as it is stored, in a form that reads well: empty is said, times are local, JSON stays code. */
export function Value({ value, type, full = false }: { value: DataValue | undefined; type: DataType; full?: boolean }) {
  const t = useMessages(messages);
  if (value === null || value === undefined) return <span className="text-fg-faint">{t.nothing}</span>;
  if (type === 'boolean') return <span className="font-mono text-meta text-fg-muted">{String(value)}</span>;
  if (type === 'timestamp' && typeof value === 'string')
    return <span className="tabular-nums">{localTime(value)}</span>;
  if (type === 'json' || typeof value === 'object')
    return full ? (
      <pre className="overflow-x-auto rounded-md bg-canvas-sunken px-2 py-1.5 font-mono text-meta whitespace-pre text-fg">
        {JSON.stringify(value, null, 2)}
      </pre>
    ) : (
      <span className="font-mono text-meta text-fg-muted">{JSON.stringify(value)}</span>
    );
  return <span className={clsx(full && 'break-words whitespace-pre-wrap')}>{String(value)}</span>;
}
