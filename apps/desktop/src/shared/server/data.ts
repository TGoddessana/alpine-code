import type { DataSource } from '@alpine/protocol';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

export type DataSourceKind = DataSource['kind'];

/** The most rows of one table the tab asks for at once (the API's own limit); a larger table shows its first rows. */
export const DATA_ROW_LIMIT = 500;

/** How often the open tab looks again, so a friend's booking shows up by itself. */
const POLL_MS = 5_000;

const dataKey = (cwd: string, source: DataSourceKind) => ['data', cwd, source] as const;
const sourcesKey = (cwd: string) => ['data', cwd, 'sources'] as const;

/** Which data this project has: the practice database on this Mac, and the live one once the app is online. */
export function useDataSources(cwd: string, enabled = true) {
  const server = useServer();
  return useQuery({
    queryKey: sourcesKey(cwd),
    queryFn: () => server.request('data/sources', { cwd }),
    enabled,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Every table with its columns and row count, looked at again every 5 seconds while the caller is mounted. */
export function useDataTables(cwd: string, source: DataSourceKind) {
  const server = useServer();
  return useQuery({
    queryKey: [...dataKey(cwd, source), 'tables'],
    queryFn: () => server.request('data/tables', { cwd, source }),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** One table to read and the order to read it in. */
export interface RowRequest {
  table: string;
  order: { column: string; dir: 'asc' | 'desc' } | null;
}

/**
 * The first rows of each requested table, in the given order. Only `polling` is looked at again every 5 seconds: the
 * table on screen. The others (tables it points into) are read once, to name what a value points at.
 */
export function useDataRows(cwd: string, source: DataSourceKind, requests: RowRequest[], polling: string | null) {
  const server = useServer();
  return useQueries({
    queries: requests.map(({ table, order }) => ({
      queryKey: [...dataKey(cwd, source), 'rows', table, order?.column ?? null, order?.dir ?? null],
      queryFn: () =>
        server.request('data/rows', {
          cwd,
          source,
          table,
          limit: DATA_ROW_LIMIT,
          ...(order ? { order: order.column, dir: order.dir } : {}),
        }),
      refetchInterval: table === polling ? POLL_MS : (false as const),
      refetchIntervalInBackground: false,
      retry: false,
    })),
  });
}

/** What the AI read from the live data, newest first. */
export function useDataReads(cwd: string, enabled: boolean) {
  const server = useServer();
  return useQuery({
    queryKey: ['data', cwd, 'reads'],
    queryFn: () => server.request('data/reads', { cwd }),
    enabled,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/**
 * Edits of the practice data (`data/save`, `data/delete`). The live data is read-only here: the server answers
 * `read_only`, and the tab does not offer the controls. Both refresh what is shown when they are done.
 */
export function useDataWrites(cwd: string, source: DataSourceKind) {
  const server = useServer();
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: dataKey(cwd, source) });
  const save = useMutation({
    mutationFn: (args: { table: string; key: Record<string, unknown> | null; cells: Record<string, unknown> }) =>
      server.request('data/save', { cwd, source, ...args }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (args: { table: string; key: Record<string, unknown> }) =>
      server.request('data/delete', { cwd, source, ...args }),
    onSuccess: refresh,
  });
  return { save: save.mutateAsync, remove: remove.mutateAsync };
}
