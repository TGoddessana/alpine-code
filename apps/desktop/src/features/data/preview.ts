import { useEffect, useMemo, useState } from 'react';

import type { DataRow, DataTable, DataValue, DataWrites } from './types';

/**
 * A stand-in for the live database of a published app (docs/alpine-cloud.md decision 15), shaped the way a real one
 * is: English column names, ids, foreign keys, timestamps, empty values and a JSON column. A friend's booking arrives
 * a moment after the tab opens.
 */
export const BOOKING_TABLES: DataTable[] = [
  {
    id: 'bookings',
    label: 'bookings',
    columns: [
      { key: 'id', type: 'text' },
      { key: 'customer_name', type: 'text' },
      { key: 'email', type: 'text' },
      { key: 'class_id', type: 'integer', references: 'classes' },
      { key: 'starts_at', type: 'timestamp' },
      { key: 'status', type: 'text' },
      { key: 'paid', type: 'boolean' },
      { key: 'amount', type: 'integer' },
      { key: 'memo', type: 'text' },
      { key: 'meta', type: 'json' },
      { key: 'created_at', type: 'timestamp' },
    ],
    rows: [
      row(
        'b_8c1f',
        '박지윤',
        'jiyun@example.com',
        1,
        '2026-10-24T02:00:00Z',
        'confirmed',
        true,
        55000,
        '물레 체험 희망',
        {
          utm: 'instagram',
        },
      ),
      row('b_77d2', '최민호', 'minho@example.com', 2, '2026-10-23T10:30:00Z', 'confirmed', false, 48000, null, null),
      row('b_51a9', '정다은', 'daeun@example.com', 1, '2026-10-24T02:00:00Z', 'cancelled', false, 55000, '일정 변경', {
        utm: 'kakao',
        coupon: 'FALL10',
      }),
    ],
  },
  {
    id: 'classes',
    label: 'classes',
    columns: [
      { key: 'id', type: 'integer' },
      { key: 'title', type: 'text' },
      { key: 'seats', type: 'integer' },
      { key: 'booked', type: 'integer' },
      { key: 'price', type: 'integer' },
      { key: 'is_open', type: 'boolean' },
    ],
    rows: [
      { id: '1', cells: { id: 1, title: '도자기 원데이', seats: 8, booked: 6, price: 55000, is_open: true } },
      { id: '2', cells: { id: 2, title: '가죽 카드지갑', seats: 6, booked: 3, price: 48000, is_open: true } },
      { id: '3', cells: { id: 3, title: '캔들 만들기', seats: 10, booked: 0, price: 35000, is_open: false } },
    ],
  },
  {
    id: 'waitlist',
    label: 'waitlist',
    columns: [
      { key: 'id', type: 'integer' },
      { key: 'booking_id', type: 'text', references: 'bookings' },
      { key: 'position', type: 'integer' },
      { key: 'notified_at', type: 'timestamp' },
    ],
    rows: [],
  },
];

function row(
  id: string,
  name: string,
  email: string,
  classId: number,
  startsAt: string,
  status: string,
  paid: boolean,
  amount: number,
  memo: string | null,
  meta: Record<string, string> | null,
): DataRow {
  return {
    id,
    cells: {
      id,
      customer_name: name,
      email,
      class_id: classId,
      starts_at: startsAt,
      status,
      paid,
      amount,
      memo,
      meta,
      created_at: '2026-10-18T09:12:44Z',
    },
  };
}

export const ARRIVING: { table: string; row: DataRow } = {
  table: 'bookings',
  row: {
    ...row('b_c4e0', '이서준', 'seojun@example.com', 1, '2026-10-24T05:00:00Z', 'pending', false, 55000, null, {
      utm: 'friend-link',
    }),
    fresh: true,
  },
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The tables held in memory with writes that land after a short wait, as the live database would answer. `arriving`
 * is added on top of its table after `delay` ms (never, when `delay` is omitted).
 */
export function useEditableTables(
  initial: DataTable[],
  arriving: { table: string; row: DataRow } | null = null,
  delay = 2200,
): [DataTable[], DataWrites] {
  const [tables, setTables] = useState(initial);
  useEffect(() => {
    if (!arriving) return;
    const timer = setTimeout(
      () =>
        setTables((last) =>
          last.map((table) =>
            table.id === arriving.table ? { ...table, rows: [arriving.row, ...table.rows] } : table,
          ),
        ),
      delay,
    );
    return () => clearTimeout(timer);
  }, [arriving, delay]);
  const writes = useMemo<DataWrites>(
    () => ({
      save: async (tableId, rowId, cells) => {
        await wait(500);
        setTables((last) =>
          last.map((table) => {
            if (table.id !== tableId) return table;
            if (rowId)
              return {
                ...table,
                rows: table.rows.map((row) =>
                  row.id === rowId ? { ...row, fresh: false, cells: { ...row.cells, ...cells } } : row,
                ),
              };
            const id = nextId(table);
            const row: DataRow = { id: String(id), fresh: true, cells: { id, ...cells } as Record<string, DataValue> };
            return { ...table, rows: [row, ...table.rows] };
          }),
        );
      },
      remove: async (tableId, rowId) => {
        await wait(500);
        setTables((last) =>
          last.map((table) =>
            table.id === tableId ? { ...table, rows: table.rows.filter((row) => row.id !== rowId) } : table,
          ),
        );
      },
    }),
    [],
  );
  return [tables, writes];
}

function nextId(table: DataTable): number | string {
  const numbers = table.rows.map((row) => row.cells.id).filter((id): id is number => typeof id === 'number');
  return numbers.length > 0 ? Math.max(...numbers) + 1 : `r_${Math.random().toString(36).slice(2, 6)}`;
}

/** A busy app's table: `count` events, to see paging and filtering hold up. */
export function eventsTable(count: number): DataTable {
  const kinds = ['page_view', 'booking_started', 'booking_done', 'signup', 'payment_failed'];
  const pages = ['/', '/classes', '/classes/1', '/classes/2', '/book', '/me'];
  const start = Date.UTC(2026, 9, 1);
  return {
    id: 'events',
    label: 'events',
    columns: [
      { key: 'id', type: 'integer' },
      { key: 'kind', type: 'text' },
      { key: 'path', type: 'text' },
      { key: 'duration_ms', type: 'integer' },
      { key: 'ok', type: 'boolean' },
      { key: 'at', type: 'timestamp' },
    ],
    rows: Array.from({ length: count }, (_, index) => {
      const id = count - index;
      return {
        id: String(id),
        cells: {
          id,
          kind: kinds[id % kinds.length] ?? 'page_view',
          path: pages[(id * 7) % pages.length] ?? '/',
          duration_ms: (id * 37) % 2400,
          ok: id % 11 !== 0,
          at: new Date(start + id * 97_000).toISOString().replace('.000Z', 'Z'),
        },
      };
    }),
  };
}
