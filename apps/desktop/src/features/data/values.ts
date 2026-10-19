import type { DataColumn, DataRow, DataTable, DataType, DataValue } from './types';

export const numeric = (type: DataType) => type === 'integer' || type === 'real';

/** The column a table's rows are known by; never edited by hand. */
export const isKey = (column: DataColumn) => column.key === 'id';

export function plain(value: DataValue | undefined): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function compare(a: DataValue | undefined, b: DataValue | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return plain(a).localeCompare(plain(b));
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-24 11:00` in this computer's time zone: exact like the stored value, readable unlike it. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** For a `datetime-local` field and back. */
export function toLocalInput(iso: string): string {
  return localTime(iso).replace(' ', 'T');
}
export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().replace('.000Z', 'Z');
}

/** The first text value of a row, to name a row another table points at. */
export function firstText(table: DataTable, row: DataRow): string {
  const column = table.columns.find((candidate) => candidate.type === 'text' && !isKey(candidate));
  return column ? plain(row.cells[column.key]) : row.id;
}

export type FilterOp = 'is' | 'contains' | 'empty' | 'filled' | 'gt' | 'lt';

export interface Filter {
  column: string;
  op: FilterOp;
  value: string;
}

export const needsValue = (op: FilterOp) => op !== 'empty' && op !== 'filled';

export function matches(row: DataRow, filter: Filter): boolean {
  const value = row.cells[filter.column];
  const text = plain(value);
  switch (filter.op) {
    case 'empty':
      return value === null || value === undefined || text === '';
    case 'filled':
      return !(value === null || value === undefined || text === '');
    case 'is':
      return text.toLowerCase() === filter.value.toLowerCase();
    case 'contains':
      return text.toLowerCase().includes(filter.value.toLowerCase());
    case 'gt':
    case 'lt': {
      const a = typeof value === 'number' ? value : Number.parseFloat(text);
      const b = Number.parseFloat(filter.value);
      if (Number.isNaN(a) || Number.isNaN(b)) return filter.op === 'gt' ? text > filter.value : text < filter.value;
      return filter.op === 'gt' ? a > b : a < b;
    }
  }
}

/** RFC 4180 CSV of the rows as stored: column names first, times as written, JSON as text. */
export function toCsv(table: DataTable, rows: DataRow[]): string {
  const cell = (value: DataValue | undefined) => {
    const text = plain(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [table.columns.map((column) => cell(column.key)).join(',')];
  for (const row of rows) lines.push(table.columns.map((column) => cell(row.cells[column.key])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}
