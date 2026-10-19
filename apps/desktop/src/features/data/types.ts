export type DataType = 'text' | 'integer' | 'real' | 'boolean' | 'timestamp' | 'json';
export type DataValue = string | number | boolean | null | Record<string, unknown> | unknown[];

export interface DataColumn {
  key: string;
  type: DataType;
  /** The table this column points into (a foreign key). */
  references?: string;
}

export interface DataRow {
  id: string;
  /** Arrived while I was looking: opens into place with a short highlight. */
  fresh?: boolean;
  cells: Record<string, DataValue>;
}

export interface DataTable {
  id: string;
  label: string;
  columns: DataColumn[];
  rows: DataRow[];
}

/** What the tab asks the live database to do. Every write takes a restore point first (decision 16). */
export interface DataWrites {
  save: (table: string, row: string | null, cells: Record<string, DataValue>) => Promise<void>;
  remove: (table: string, row: string) => Promise<void>;
}
