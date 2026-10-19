import type { DataColumn as WireColumn, DataTable as WireTable } from '@alpine/protocol';

import type { DataColumn, DataRow, DataTable, DataType, DataValue } from './types';

/** The practice and live databases are SQLite and the API's mask for secret-looking columns. */
export const MASK = '••••';

/**
 * SQLite stores what the column was declared as, in any words (`INTEGER`, `varchar(80)`, `DATETIME`, `BOOLEAN`).
 * The tab's own kinds come from the declared name; what no rule knows is text.
 */
export function dataType(declared: string): DataType {
  const name = declared.toLowerCase();
  if (name.includes('bool')) return 'boolean';
  if (name.includes('json')) return 'json';
  if (name.includes('time') || name.includes('date')) return 'timestamp';
  if (name.includes('int')) return 'integer';
  if (/real|floa|doub|numeric|decimal/.test(name)) return 'real';
  return 'text';
}

/** A foreign key arrives as `table` or `table.column`; the tab follows it by table. */
const target = (references: string | null | undefined) => references?.split('.')[0] || undefined;

export function columnsOf(columns: WireColumn[]): DataColumn[] {
  return columns.map((column) => ({
    key: column.name,
    type: dataType(column.type),
    ...(column.pk ? { pk: true } : {}),
    ...(target(column.references) ? { references: target(column.references) } : {}),
  }));
}

/** SQLite holds a boolean as 0 or 1 and JSON and times as text; the tab shows them as what they mean. */
export function fromWire(type: DataType, value: unknown): DataValue {
  if (value === null || value === undefined) return null;
  if (value === MASK) return MASK;
  if (type === 'boolean' && (value === 0 || value === 1)) return value === 1;
  if (type === 'json' && typeof value === 'string') {
    try {
      return JSON.parse(value) as DataValue;
    } catch {
      return value;
    }
  }
  return value as DataValue;
}

/** The other way, for a save: a boolean is 0 or 1 and JSON is its text. */
export function toWire(type: DataType, value: DataValue): unknown {
  if (value === null) return null;
  if (type === 'boolean' && typeof value === 'boolean') return value ? 1 : 0;
  if (type === 'json' && typeof value !== 'string') return JSON.stringify(value);
  return value;
}

/** The table before any row has arrived: its name, columns and how many rows it holds. */
export function tableOf(wire: WireTable): DataTable {
  return { id: wire.name, label: wire.name, columns: columnsOf(wire.columns), count: wire.rows, rows: [] };
}

/** Rows as the API sends them (arrays in column order) to the tab's rows, named by their primary key. */
export function rowsOf(table: DataTable, columns: string[], wire: unknown[][]): DataRow[] {
  const types = new Map(table.columns.map((column) => [column.key, column.type]));
  const keys = table.columns.filter((column) => column.pk).map((column) => column.key);
  return wire.map((values, index) => {
    const cells: Record<string, DataValue> = {};
    columns.forEach((name, at) => {
      cells[name] = fromWire(types.get(name) ?? 'text', values[at]);
    });
    const key = keys.length > 0 ? Object.fromEntries(keys.map((name) => [name, cells[name] ?? null])) : null;
    return { id: key ? keys.map((name) => String(cells[name])).join('/') : `#${index}`, key, cells };
  });
}
