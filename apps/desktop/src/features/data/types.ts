export type DataType = 'text' | 'integer' | 'real' | 'boolean' | 'timestamp' | 'json';
export type DataValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface DataColumn {
  key: string;
  type: DataType;
  /** Part of the table's primary key: it names the row, so it is never edited by hand. */
  pk?: boolean;
  /** The table this column points into (a foreign key). */
  references?: string;
}

export interface DataRow {
  id: string;
  /** The primary key (column to value) that `DataWrites` names the row by; none when the table has no primary key. */
  key: Record<string, DataValue> | null;
  /** Arrived while I was looking: opens into place with a short highlight. */
  fresh?: boolean;
  cells: Record<string, DataValue>;
}

export interface DataTable {
  id: string;
  label: string;
  columns: DataColumn[];
  /** How many rows the table holds; `rows` may be fewer (the first ones) or not loaded yet. */
  count: number;
  /** Rows arrived since I last looked at this table. */
  fresh?: boolean;
  rows: DataRow[];
}

/** What the tab asks the practice database to do (the live one is read-only here). */
export interface DataWrites {
  save: (table: string, key: Record<string, DataValue> | null, cells: Record<string, DataValue>) => Promise<void>;
  remove: (table: string, key: Record<string, DataValue>) => Promise<void>;
}
