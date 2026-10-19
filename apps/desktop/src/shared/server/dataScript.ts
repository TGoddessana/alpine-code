import type { DataRead } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

export interface DataScriptOptions {
  /**
   * What the project has to show: the practice database on this Mac, the live one of the published app, both, or
   * neither (the default, so the dock of other stories has no 데이터 tab).
   */
  data?: 'none' | 'practice' | 'live' | 'both';
  /** A friend's booking lands in the live data this many ms after the tables were first asked for (never when omitted). */
  bookingArrivesMs?: number;
  /** Every table is empty. */
  empty?: boolean;
  /** One more table, `events`, with this many rows (a big table: only the first 500 are asked for). */
  eventRows?: number;
  /** The AI has read the live data this many times (the read log); defaults to 2. */
  aiReads?: number;
}

type Cell = string | number | null;
interface Column {
  name: string;
  type: string;
  pk?: boolean;
  references?: string;
}
interface Table {
  name: string;
  columns: Column[];
  rows: Cell[][];
}

const BOOKINGS: Column[] = [
  { name: 'id', type: 'INTEGER', pk: true },
  { name: 'customer_name', type: 'TEXT' },
  { name: 'email', type: 'TEXT' },
  { name: 'class_id', type: 'INTEGER', references: 'classes.id' },
  { name: 'starts_at', type: 'DATETIME' },
  { name: 'status', type: 'TEXT' },
  { name: 'paid', type: 'BOOLEAN' },
  { name: 'amount', type: 'INTEGER' },
  { name: 'memo', type: 'TEXT' },
  { name: 'meta', type: 'JSON' },
  { name: 'api_token', type: 'TEXT' },
  { name: 'created_at', type: 'DATETIME' },
];

const booking = (
  id: number,
  name: string,
  classId: number,
  startsAt: string,
  status: string,
  paid: 0 | 1,
  amount: number,
  memo: string | null,
  meta: object | null,
): Cell[] => [
  id,
  name,
  `${name.length}@example.com`,
  classId,
  startsAt,
  status,
  paid,
  amount,
  memo,
  meta ? JSON.stringify(meta) : null,
  '••••',
  '2026-10-18T09:12:44Z',
];

const CLASSES: Column[] = [
  { name: 'id', type: 'INTEGER', pk: true },
  { name: 'title', type: 'TEXT' },
  { name: 'seats', type: 'INTEGER' },
  { name: 'booked', type: 'INTEGER' },
  { name: 'price', type: 'INTEGER' },
  { name: 'is_open', type: 'BOOLEAN' },
];

const EVENT_KINDS = ['page_view', 'click', 'booking_started', 'booking_done'];

function tables(kind: 'practice' | 'live', options: DataScriptOptions): Table[] {
  const practice = kind === 'practice';
  const made: Table[] = [
    {
      name: 'bookings',
      columns: BOOKINGS,
      rows: practice
        ? [booking(1, '시험 손님', 1, '2026-10-24T02:00:00Z', 'confirmed', 0, 55000, '연습으로 넣은 예약', null)]
        : [
            booking(1, '박지윤', 1, '2026-10-24T02:00:00Z', 'confirmed', 1, 55000, '물레 체험 희망', {
              utm: 'instagram',
            }),
            booking(2, '최민호', 2, '2026-10-23T10:30:00Z', 'confirmed', 0, 48000, null, null),
            booking(3, '정다은', 1, '2026-10-24T02:00:00Z', 'cancelled', 0, 55000, '일정 변경', { utm: 'kakao' }),
          ],
    },
    {
      name: 'classes',
      columns: CLASSES,
      rows: [
        [1, '도자기 원데이', 8, practice ? 1 : 6, 55000, 1],
        [2, '가죽 카드지갑', 6, practice ? 0 : 3, 48000, 1],
        [3, '캔들 만들기', 10, 0, 35000, 0],
      ],
    },
    {
      name: 'waitlist',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'booking_id', type: 'INTEGER', references: 'bookings.id' },
        { name: 'position', type: 'INTEGER' },
        { name: 'notified_at', type: 'DATETIME' },
      ],
      rows: [],
    },
  ];
  if (options.eventRows)
    made.push({
      name: 'events',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true },
        { name: 'kind', type: 'TEXT' },
        { name: 'duration_ms', type: 'INTEGER' },
        { name: 'ok', type: 'BOOLEAN' },
      ],
      rows: Array.from({ length: options.eventRows }, (_, index) => [
        index + 1,
        EVENT_KINDS[index % EVENT_KINDS.length] ?? 'page_view',
        (index * 37) % 2400,
        index % 11 === 0 ? 0 : 1,
      ]),
    });
  return options.empty ? made.map((table) => ({ ...table, rows: [] })) : made;
}

const ARRIVING = booking(4, '이서준', 1, '2026-10-24T05:00:00Z', 'pending', 0, 55000, null, { utm: 'friend-link' });

const READS: DataRead[] = [
  {
    at: new Date(Date.now() - 12 * 60_000).toISOString(),
    session: 'session-1',
    sql: 'SELECT status, count(*) AS n FROM bookings GROUP BY status',
    tables: ['bookings'],
    rows: 2,
  },
  {
    at: new Date(Date.now() - 26 * 3_600_000).toISOString(),
    session: 'session-1',
    sql: 'SELECT b.customer_name, c.title FROM bookings b JOIN classes c ON c.id = b.class_id WHERE b.paid = 0',
    tables: ['bookings', 'classes'],
    rows: 2,
  },
];

/**
 * `data/*` for the 데이터 tab: SQLite-shaped tables (declared types, 0 and 1 for booleans, JSON as text, a masked
 * token column) held in memory for the practice and the live data. Practice rows can be saved and deleted; the live
 * data answers `read_only`. A scripted stand-in for the server, like the rest of `cloudScript`.
 */
export function dataResults(options: DataScriptOptions): NonNullable<Script['results']> {
  const mode = options.data ?? 'none';
  const state = { practice: tables('practice', options), live: tables('live', options) };
  let arrival: ReturnType<typeof setTimeout> | undefined;
  const find = (kind: 'practice' | 'live', name: string) => {
    const table = state[kind].find((candidate) => candidate.name === name);
    if (!table) throw new ServerError(-32000, `There is no table ${name}.`, { reason: 'not_found' });
    return table;
  };
  const keyIndexes = (table: Table) => table.columns.flatMap((column, index) => (column.pk ? [index] : []));
  const sameKey = (table: Table, row: Cell[], key: Record<string, unknown>) =>
    keyIndexes(table).every((index) => row[index] === key[table.columns[index]?.name ?? '']);
  const writable = (kind: 'practice' | 'live') => {
    if (kind !== 'practice')
      throw new ServerError(-32000, 'Live data cannot be changed here. Ask the AI, which asks you first.', {
        reason: 'read_only',
      });
  };
  return {
    'data/sources': () => ({
      sources: [
        { kind: 'practice', available: mode === 'practice' || mode === 'both' },
        { kind: 'live', available: mode === 'live' || mode === 'both' },
      ],
    }),
    'data/tables': ({ source }) => {
      if (options.bookingArrivesMs !== undefined && arrival === undefined && source === 'live')
        arrival = setTimeout(() => find('live', 'bookings').rows.push(ARRIVING), options.bookingArrivesMs);
      return {
        tables: state[source].map((table) => ({
          name: table.name,
          rows: table.rows.length,
          columns: table.columns.map((column) => ({
            name: column.name,
            type: column.type,
            pk: column.pk ?? false,
            nullable: !column.pk,
            references: column.references ?? null,
          })),
        })),
      };
    },
    'data/rows': ({ source, table: name, limit = 100, offset = 0, order, dir }) => {
      const table = find(source, name);
      const at = order ? table.columns.findIndex((column) => column.name === order) : -1;
      const sorted =
        at < 0
          ? [...table.rows]
          : [...table.rows].sort((a, b) => {
              const x = a[at] ?? '';
              const y = b[at] ?? '';
              return (x < y ? -1 : x > y ? 1 : 0) * (dir === 'desc' ? -1 : 1);
            });
      return {
        columns: table.columns.map((column) => column.name),
        rows: sorted.slice(offset, offset + limit).map((row) => [...row]),
        total: table.rows.length,
      };
    },
    'data/save': ({ source, table: name, key, cells }) => {
      writable(source);
      const table = find(source, name);
      const names = table.columns.map((column) => column.name);
      if (key) {
        const row = table.rows.find((candidate) => sameKey(table, candidate, key));
        if (!row) throw new ServerError(-32000, 'That row is gone.', { reason: 'not_found' });
        for (const [column, value] of Object.entries(cells)) row[names.indexOf(column)] = value as Cell;
      } else {
        const index = keyIndexes(table)[0];
        const next = Math.max(0, ...table.rows.map((row) => Number(row[index ?? 0]) || 0)) + 1;
        table.rows.push(names.map((column, at) => (cells[column] as Cell | undefined) ?? (at === index ? next : null)));
      }
      return {};
    },
    'data/delete': ({ source, table: name, key }) => {
      writable(source);
      const table = find(source, name);
      const at = table.rows.findIndex((row) => sameKey(table, row, key));
      if (at < 0) throw new ServerError(-32000, 'That row is gone.', { reason: 'not_found' });
      table.rows.splice(at, 1);
      return {};
    },
    'data/reads': () => ({ reads: READS.slice(0, options.aiReads ?? READS.length) }),
  };
}
