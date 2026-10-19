import clsx from 'clsx';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { KeyboardEvent } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { DataRow, DataTable } from './types';
import { Value } from './Value';
import { numeric, plain } from './values';

export type Sort = { key: string; direction: 'asc' | 'desc' } | null;

/**
 * Every column as stored, its name and type in the header. The header and the first column stay put while the rest
 * scrolls; a header sorts, a row opens.
 */
export function Grid({
  table,
  rows,
  sort,
  onSort,
  onOpen,
}: {
  table: DataTable;
  rows: DataRow[];
  sort: Sort;
  onSort: (key: string) => void;
  onOpen: (row: string) => void;
}) {
  const t = useMessages(messages);
  const open = (event: KeyboardEvent, row: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(row);
    }
  };
  return (
    <div className="w-max min-w-full overflow-hidden rounded-lg border border-line-subtle bg-canvas-raised">
      <table aria-label={table.label} className="border-separate border-spacing-0 text-body">
        <thead>
          <tr>
            {table.columns.map((column, index) => {
              const sorted = sort?.key === column.key ? sort.direction : null;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={clsx(
                    'sticky top-0 z-10 border-b border-line-subtle bg-canvas-sunken p-0 text-left font-normal',
                    index === 0 && 'left-0 z-20 border-r',
                  )}
                >
                  <button
                    type="button"
                    title={t.sortBy(column.key)}
                    onClick={() => onSort(column.key)}
                    className={clsx(
                      'flex w-full cursor-pointer items-baseline gap-1.5 px-3 py-1.5 whitespace-nowrap hover:bg-hover',
                      numeric(column.type) && 'justify-end',
                    )}
                  >
                    <span className="font-mono text-meta text-fg">{column.key}</span>
                    <span className="text-meta text-fg-faint">{column.type}</span>
                    {sorted === 'asc' && (
                      <ArrowUp size={12} aria-hidden="true" className="motion-step self-center text-interactive" />
                    )}
                    {sorted === 'desc' && (
                      <ArrowDown size={12} aria-hidden="true" className="motion-step self-center text-interactive" />
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              tabIndex={0}
              aria-label={plain(row.cells[table.columns[0]?.key ?? ''])}
              onClick={() => onOpen(row.id)}
              onKeyDown={(event) => open(event, row.id)}
              className={clsx('group cursor-pointer', row.fresh && 'motion-arrive')}
            >
              {table.columns.map((column, index) => (
                <td
                  key={column.key}
                  className={clsx(
                    'max-w-60 truncate border-b border-line-subtle px-3 py-2 whitespace-nowrap group-last:border-b-0 group-hover:bg-hover',
                    numeric(column.type) && 'text-right tabular-nums',
                    index === 0 && 'sticky left-0 border-r bg-canvas-raised',
                  )}
                >
                  <Value value={row.cells[column.key]} type={column.type} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
