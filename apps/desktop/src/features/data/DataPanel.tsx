import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useDataReads,
  useDataRows,
  useDataSources,
  useDataTables,
  useDataWrites,
  type DataSourceKind,
  type RowRequest,
} from '@/shared/server';

import { rowsOf, tableOf, toWire } from './convert';
import { DataTab } from './DataTab';
import type { DataRow, DataTable, DataWrites } from './types';

/** How long a row that just arrived keeps its highlight. */
const FRESH_MS = 4_000;

/**
 * The 데이터 tab on the real protocol: `data/sources` says what there is to show (the practice data on this Mac, the
 * live data of the published app), the open tab then looks at `data/tables` and the table on screen every 5 seconds,
 * and a row that was not there before opens into place. Practice rows are edited through `data/save` and
 * `data/delete`; the live data is shown without any way to change it. With both, the live data is shown first, since
 * that is the app people share.
 */
export function DataPanel({
  cwd,
  onRestorePoints,
  onExport,
}: {
  cwd: string;
  onRestorePoints?: () => void;
  onExport?: (name: string, csv: string) => void;
}) {
  const sources = useDataSources(cwd);
  const [picked, pick] = useState<DataSourceKind | null>(null);
  const kinds = (sources.data?.sources ?? []).filter((source) => source.available).map((source) => source.kind);
  const ordered = (['live', 'practice'] as const).filter((kind) => kinds.includes(kind));
  const source = picked && ordered.includes(picked) ? picked : ordered[0];
  if (!source) return null;
  return (
    <Source
      key={`${cwd}/${source}`}
      cwd={cwd}
      source={source}
      kinds={ordered}
      onSource={pick}
      onRestorePoints={onRestorePoints}
      onExport={onExport}
    />
  );
}

/** The order a table is read in: newest first when its key counts up, so a new row is among the first ones. */
function orderOf(table: DataTable | undefined): RowRequest['order'] {
  const keys = table?.columns.filter((column) => column.pk) ?? [];
  const key = keys.length === 1 ? keys[0] : undefined;
  return key?.type === 'integer' ? { column: key.key, dir: 'desc' } : null;
}

function Source({
  cwd,
  source,
  kinds,
  onSource,
  onRestorePoints,
  onExport,
}: {
  cwd: string;
  source: DataSourceKind;
  kinds: DataSourceKind[];
  onSource: (source: DataSourceKind) => void;
  onRestorePoints?: () => void;
  onExport?: (name: string, csv: string) => void;
}) {
  const tablesQuery = useDataTables(cwd, source);
  // The AI reads only the live data, so its read log belongs to that view and not to the practice data.
  const live = source === 'live';
  const reads = useDataReads(cwd, live);
  const { save, remove } = useDataWrites(cwd, source);
  const [picked, pick] = useState<string | null>(null);
  const [freshRows, setFreshRows] = useState<ReadonlySet<string>>(new Set());
  const [freshTables, setFreshTables] = useState<ReadonlySet<string>>(new Set());
  const seenRows = useRef(new Map<string, Set<string>>());
  const seenCounts = useRef(new Map<string, number>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  const metas = useMemo(() => (tablesQuery.data?.tables ?? []).map(tableOf), [tablesQuery.data]);
  const selected = metas.find((table) => table.id === picked) ?? metas[0];
  // The table on screen, and the ones it points into, so a value can name the row it points at.
  const wanted = [selected, ...(selected?.columns ?? []).map((column) => metas.find((t) => t.id === column.references))]
    .filter((table, index, all): table is DataTable => !!table && all.indexOf(table) === index)
    .map((table): RowRequest => ({ table: table.id, order: orderOf(table) }));
  const rowQueries = useDataRows(cwd, source, wanted, selected?.id ?? null);
  const selectedData = rowQueries[0]?.data;
  const selectedRows = useMemo(
    () => (selected && selectedData ? rowsOf(selected, selectedData.columns, selectedData.rows) : []),
    [selected, selectedData],
  );

  // A row that was not in the last look is new; the first look only sets the baseline.
  useEffect(() => {
    if (!selected || !selectedData) return;
    const before = seenRows.current.get(selected.id);
    seenRows.current.set(selected.id, new Set(selectedRows.map((row) => row.id)));
    if (!before) return;
    const arrived = selectedRows.filter((row) => !before.has(row.id)).map((row) => `${selected.id}/${row.id}`);
    if (arrived.length === 0) return;
    setFreshRows((last) => new Set([...last, ...arrived]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFreshRows((last) => new Set([...last].filter((id) => !arrived.includes(id))));
    }, FRESH_MS);
    timers.current.add(timer);
  }, [selected, selectedData, selectedRows]);

  // Another table that grew while I looked at this one gets a dot on its name until I open it.
  useEffect(() => {
    const grown = metas.filter(
      (table) => table.id !== selected?.id && table.count > (seenCounts.current.get(table.id) ?? table.count),
    );
    metas.forEach((table) => seenCounts.current.set(table.id, table.count));
    if (grown.length > 0) setFreshTables((last) => new Set([...last, ...grown.map((table) => table.id)]));
  }, [metas, selected?.id]);

  useEffect(() => {
    const open = timers.current;
    return () => open.forEach(clearTimeout);
  }, []);

  const tables = metas.map((meta): DataTable => {
    const at = wanted.findIndex((request) => request.table === meta.id);
    const data = rowQueries[at]?.data;
    const rows: DataRow[] =
      at === 0
        ? selectedRows.map((row) => (freshRows.has(`${meta.id}/${row.id}`) ? { ...row, fresh: true } : row))
        : data
          ? rowsOf(meta, data.columns, data.rows)
          : [];
    return { ...meta, rows, ...(freshTables.has(meta.id) ? { fresh: true } : {}) };
  });

  const editing = useMemo<DataWrites | undefined>(
    () =>
      source === 'practice'
        ? {
            save: async (table, key, cells) => {
              const types = new Map(metas.find((meta) => meta.id === table)?.columns.map((c) => [c.key, c.type]));
              await save({
                table,
                key,
                cells: Object.fromEntries(
                  Object.entries(cells).map(([name, value]) => [name, toWire(types.get(name) ?? 'text', value)]),
                ),
              });
            },
            remove: async (table, key) => void (await remove({ table, key })),
          }
        : undefined,
    [source, metas, save, remove],
  );

  const choose = useCallback((id: string) => {
    pick(id);
    setFreshTables((last) => new Set([...last].filter((table) => table !== id)));
  }, []);

  return (
    <DataTab
      state={tablesQuery.isError ? 'failed' : tablesQuery.isPending ? 'loading' : 'ready'}
      tables={tables}
      selected={selected?.id ?? null}
      onSelect={choose}
      source={source}
      kinds={kinds}
      onSource={onSource}
      writes={editing}
      reads={live ? (reads.data?.reads ?? []) : undefined}
      onRetry={() => void tablesQuery.refetch()}
      onRestorePoints={onRestorePoints}
      onExport={onExport}
    />
  );
}
