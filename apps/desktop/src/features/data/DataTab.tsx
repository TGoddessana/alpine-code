import { Button, Input, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Download, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import type { DataSourceKind } from '@/shared/server';

import { Filters } from './Filters';
import { Grid, type Sort } from './Grid';
import { messages } from './messages';
import { RowDetail } from './RowDetail';
import type { DataRead } from '@alpine/protocol';
import { ReadLog } from './ReadLog';
import type { DataTable, DataWrites } from './types';
import { compare, isKey, matches, plain, toCsv, type Filter } from './values';

export type { DataColumn, DataRow, DataTable, DataType, DataValue, DataWrites } from './types';

/** Rows drawn at once; more come on request, so a table of many thousands stays quick. */
const PAGE = 100;

/**
 * The dock's 데이터 tab (decisions 15 and 16 in docs/alpine-cloud.md): the database of the app, every table, column
 * and value as it is, so nobody needs a separate database tool until real developer work. Find, filter by column,
 * sort, export CSV. The practice data on this Mac can be edited, added to and deleted from; the live data of the
 * published app is only looked at (changes go through the AI), and a friend's booking appears in it as it happens.
 * A line says which of the two is shown, with a switch when there are both.
 */
export function DataTab({
  state = 'ready',
  tables,
  selected,
  onSelect,
  source,
  kinds,
  onSource,
  writes,
  reads,
  onRetry,
  onRestorePoints,
  onExport = download,
}: {
  state?: 'loading' | 'failed' | 'ready';
  tables: DataTable[];
  /** The table on screen; the one that is not there (or none) shows the first. */
  selected: string | null;
  onSelect: (table: string) => void;
  source: DataSourceKind;
  /** The data this project has; with more than one, the person can switch. */
  kinds: DataSourceKind[];
  onSource: (source: DataSourceKind) => void;
  /** Only the practice data is edited: without it, no control to change anything is drawn. */
  writes?: DataWrites;
  /** What the AI read from the live data, newest first; none when the project has no live data. */
  reads?: DataRead[];
  onRetry?: () => void;
  onRestorePoints?: () => void;
  /** Hands over the CSV; the app saves it where I pick. */
  onExport?: (name: string, csv: string) => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [sort, setSort] = useState<Sort>(null);
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<{ table: string; row: string | null } | null>(null);
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const [reading, setReading] = useState(false);
  const table = tables.find((candidate) => candidate.id === selected) ?? tables[0];

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 3200);
    return () => clearTimeout(timer);
  }, [note]);

  const shown = useMemo(() => {
    if (!table) return [];
    const needle = query.trim().toLowerCase();
    let rows = table.rows.filter((row) => filters.every((filter) => matches(row, filter)));
    if (needle)
      rows = rows.filter((row) =>
        Object.values(row.cells).some((value) => plain(value).toLowerCase().includes(needle)),
      );
    if (!sort) return rows;
    const sign = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => sign * compare(a.cells[sort.key], b.cells[sort.key]));
  }, [table, query, filters, sort]);

  const go = (id: string, row: string | null = null) => {
    onSelect(id);
    setQuery('');
    setFilters([]);
    setSort(null);
    setLimit(PAGE);
    setOpen(row ? { table: id, row } : null);
    setReading(false);
  };

  const openTable = open ? tables.find((candidate) => candidate.id === open.table) : undefined;
  const openRow = open?.row && openTable ? (openTable.rows.find((row) => row.id === open.row) ?? null) : null;
  const narrowed = query.trim() !== '' || filters.length > 0;

  const live = source === 'live';
  const loaded = table ? table.rows.length : 0;

  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex items-center gap-1 px-3 pb-2">
        {kinds.length > 1 ? (
          <div role="group" aria-label={t.source} className="flex gap-1">
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kind === source}
                onClick={() => kind !== source && onSource(kind)}
                className={clsx(
                  'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-meta whitespace-nowrap',
                  kind === source
                    ? 'border-interactive bg-selected text-fg'
                    : 'border-line bg-canvas-raised text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                <Dot live={kind === 'live'} />
                {kind === 'live' ? t.live : t.practice}
              </button>
            ))}
          </div>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-meta text-fg">
            <Dot live={live} />
            {live ? t.live : t.practice}
          </span>
        )}
      </div>
      <p className="px-3 pb-2 text-meta text-fg-muted">{live ? `${t.liveHint} ${t.liveReadOnly}` : t.practiceHint}</p>
      {state === 'loading' && <p className="px-3 py-4 text-meta text-fg-muted">{t.loading}</p>}
      {state === 'failed' && (
        <div role="alert" className="flex items-center gap-2 px-3 py-4 text-meta text-fg-muted">
          {t.loadFailed}
          {onRetry && <LinkButton onClick={onRetry}>{t.retry}</LinkButton>}
        </div>
      )}
      {state === 'ready' && (
        <>
          <div className="flex items-center gap-2 px-3 pb-2">
            <div role="tablist" aria-label={t.tables} className="flex min-w-0 grow gap-1 overflow-x-auto">
              {tables.map((candidate) => {
                const current = candidate.id === table?.id;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    role="tab"
                    aria-selected={current}
                    onClick={() => go(candidate.id)}
                    className={clsx(
                      'relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-meta whitespace-nowrap',
                      current
                        ? 'border-interactive bg-selected text-fg'
                        : 'border-line bg-canvas-raised text-fg-muted hover:bg-hover hover:text-fg',
                    )}
                  >
                    {candidate.label}
                    <span key={candidate.count} className="motion-step font-sans text-fg-muted tabular-nums">
                      {format.number(candidate.count)}
                    </span>
                    {candidate.fresh && !current && (
                      <span aria-hidden="true" className="motion-step size-1.5 rounded-full bg-interactive" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {note && (
            <p
              key={note.at}
              role="status"
              className="motion-step mx-3 mb-2 rounded-md bg-selected px-2.5 py-1.5 text-meta text-fg"
            >
              {note.text}
            </p>
          )}

          {reading ? (
            <ReadLog reads={reads ?? []} onBack={() => setReading(false)} />
          ) : open && openTable ? (
            <RowDetail
              key={`${open.table}/${open.row ?? 'new'}`}
              table={openTable}
              row={openRow}
              tables={tables}
              writes={writes}
              onBack={() => setOpen(null)}
              onFollow={go}
              onDone={(text, closed) => {
                setNote({ text, at: Date.now() });
                if (closed) setOpen(null);
              }}
            />
          ) : (
            table && (
              <div key="grid" className="motion-step flex min-h-0 grow flex-col">
                <div className="flex flex-col gap-2 px-3 pb-2">
                  <div className="flex items-center gap-2">
                    <label className="relative flex min-w-0 grow items-center">
                      <Search
                        size={14}
                        strokeWidth={1.5}
                        aria-hidden="true"
                        className="pointer-events-none absolute left-2 text-fg-faint"
                      />
                      <span className="sr-only">{t.search}</span>
                      <Input
                        value={query}
                        placeholder={t.search}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setLimit(PAGE);
                        }}
                        className="pl-7"
                      />
                    </label>
                    {writes && table.columns.some(isKey) && (
                      <Button className="shrink-0" onClick={() => setOpen({ table: table.id, row: null })}>
                        <Plus size={14} aria-hidden="true" />
                        {t.addRow}
                      </Button>
                    )}
                    <Button
                      className="shrink-0 px-2"
                      aria-label={t.exportCsv}
                      title={t.exportCsv}
                      disabled={shown.length === 0}
                      onClick={() => onExport(`${table.label}.csv`, toCsv(table, shown))}
                    >
                      <Download size={14} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <Filters
                      columns={table.columns}
                      filters={filters}
                      onChange={(next) => {
                        setFilters(next);
                        setLimit(PAGE);
                      }}
                    />
                    <span className="shrink-0 pt-1 text-meta text-fg-muted tabular-nums">
                      {narrowed
                        ? t.found(format.number(shown.length), format.number(loaded))
                        : loaded < table.count
                          ? t.firstRows(format.number(loaded))
                          : t.rows(format.number(table.count))}
                    </span>
                  </div>
                  {writes && !table.columns.some(isKey) && <p className="text-meta text-fg-muted">{t.noKey}</p>}
                </div>
                <div className="min-h-0 grow overflow-auto px-3 pb-3">
                  {table.count === 0 ? (
                    <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-meta text-fg-muted">
                      {t.empty}
                    </p>
                  ) : loaded === 0 ? (
                    <p className="px-1 py-4 text-meta text-fg-muted">{t.loading}</p>
                  ) : shown.length === 0 ? (
                    <p className="px-1 py-4 text-meta text-fg-muted">{t.noMatch}</p>
                  ) : (
                    <>
                      <Grid
                        table={table}
                        rows={shown.slice(0, limit)}
                        sort={sort}
                        onSort={(key) =>
                          setSort((last) =>
                            last?.key !== key
                              ? { key, direction: 'asc' }
                              : last.direction === 'asc'
                                ? { key, direction: 'desc' }
                                : null,
                          )
                        }
                        onOpen={(row) => setOpen({ table: table.id, row })}
                      />
                      {shown.length > limit && (
                        <div className="flex items-center justify-center gap-2 pt-3">
                          <Button onClick={() => setLimit(limit + PAGE)}>
                            {t.more(format.number(Math.min(PAGE, shown.length - limit)))}
                          </Button>
                          <span className="text-meta text-fg-muted">
                            {t.remaining(format.number(shown.length - limit))}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          )}
        </>
      )}

      {(reads || onRestorePoints) && (
        <div className="flex items-center gap-1 border-t border-line-subtle px-2 py-1.5">
          {reads && <LinkButton onClick={() => setReading(true)}>{t.aiReads(reads.length)}</LinkButton>}
          {reads && onRestorePoints && (
            <span aria-hidden="true" className="text-meta text-fg-faint">
              ·
            </span>
          )}
          {onRestorePoints && <LinkButton onClick={onRestorePoints}>{t.restorePoints}</LinkButton>}
        </div>
      )}
    </div>
  );
}

/** A small dot in front of the source's name: it pulses for the live data, which can change under my eyes. */
function Dot({ live }: { live: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        'size-1.5 rounded-full',
        live ? 'animate-pulse bg-interactive motion-reduce:animate-none' : 'bg-fg-faint',
      )}
    />
  );
}

/** Until the app's save dialog is wired, a plain browser download. */
function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
