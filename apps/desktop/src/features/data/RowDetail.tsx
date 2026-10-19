import { Button, Input, LinkButton, NativeSelect } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { DataColumn, DataRow, DataTable, DataValue, DataWrites } from './types';
import { Value } from './Value';
import { firstText, fromLocalInput, isKey, plain, toLocalInput } from './values';

type Draft = Record<string, string | null>;

/**
 * One row with every field, its column name and type. 고치기 turns the fields into inputs that fit their type; a
 * value pointing into another table opens that row. A new row (`row` null) starts in the same form, empty. Saving and
 * deleting go through `writes`, which takes a restore point first.
 */
export function RowDetail({
  table,
  row,
  tables,
  writes,
  onBack,
  onFollow,
  onDone,
}: {
  table: DataTable;
  row: DataRow | null;
  tables: DataTable[];
  writes: DataWrites;
  onBack: () => void;
  onFollow: (table: string, row: string) => void;
  /** After a save or delete, with what to tell me. A deleted or new row closes. */
  onDone: (note: string, closed: boolean) => void;
}) {
  const t = useMessages(messages);
  const [draft, setDraft] = useState<Draft | null>(row ? null : draftOf(table, null));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const save = () => {
    if (!draft) return;
    const cells: Record<string, DataValue> = {};
    for (const column of table.columns) {
      if (isKey(column)) continue;
      const parsed = parse(column, draft[column.key] ?? null);
      if (parsed === INVALID) {
        setError(t.badJson);
        return;
      }
      cells[column.key] = parsed;
    }
    setBusy(true);
    void writes.save(table.id, row?.id ?? null, cells).then(() => {
      setBusy(false);
      setDraft(null);
      onDone(t.saved, row === null);
    });
  };

  const remove = () => {
    if (!row) return;
    setBusy(true);
    void writes.remove(table.id, row.id).then(() => onDone(t.removed, true));
  };

  return (
    <div className="motion-step flex min-h-0 grow flex-col">
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <LinkButton autoFocus={!draft} onClick={onBack} className="font-mono">
          {t.back(table.label)}
        </LinkButton>
        {row ? (
          !draft && (
            <Button className="min-h-7" onClick={() => setDraft(draftOf(table, row))}>
              {t.edit}
            </Button>
          )
        ) : (
          <span className="text-meta text-fg-muted">{t.newRow(table.label)}</span>
        )}
      </div>

      <dl className="min-h-0 grow overflow-y-auto px-3 pb-3">
        {table.columns.map((column) => {
          const value = row?.cells[column.key];
          return (
            <Field key={column.key} column={column}>
              {draft ? (
                <Editor
                  column={column}
                  value={draft[column.key] ?? null}
                  fixed={isKey(column) ? (row ? plain(value) : t.auto) : null}
                  onChange={(next) => {
                    setError(null);
                    setDraft({ ...draft, [column.key]: next });
                  }}
                />
              ) : (
                <Shown column={column} value={value} tables={tables} onFollow={onFollow} />
              )}
            </Field>
          );
        })}
      </dl>

      {draft && (
        <div className="motion-step flex flex-col gap-2 border-t border-line-subtle px-3 py-2.5">
          {error && (
            <p role="alert" className="text-meta text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-meta text-fg-muted">{t.restoreNote}</p>
            <div className="flex shrink-0 gap-2">
              <Button onClick={() => (row ? setDraft(null) : onBack())}>{t.cancel}</Button>
              <Button variant="primary" disabled={busy} onClick={save}>
                {busy ? t.saving : t.save}
              </Button>
            </div>
          </div>
        </div>
      )}

      {row && !draft && (
        <div className="flex flex-col gap-2 border-t border-line-subtle px-3 py-2">
          {asking ? (
            <div className="motion-step flex flex-col gap-2">
              <p className="text-body text-fg">{t.removeAsk}</p>
              <div className="flex justify-end gap-2">
                <Button onClick={() => setAsking(false)}>{t.cancel}</Button>
                <Button variant="danger" disabled={busy} onClick={remove}>
                  {t.removeConfirm}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <LinkButton onClick={() => setAsking(true)} className="-ml-1 text-danger hover:text-danger-hover">
                {t.remove}
              </LinkButton>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ column, children }: { column: DataColumn; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line-subtle py-2.5 last:border-b-0">
      <dt className="flex items-baseline gap-1.5">
        <span className="font-mono text-meta text-fg">{column.key}</span>
        <span className="text-meta text-fg-faint">{column.type}</span>
        {column.references && <span className="font-mono text-meta text-fg-faint">→ {column.references}</span>}
      </dt>
      <dd className="text-body text-fg">{children}</dd>
    </div>
  );
}

function Shown({
  column,
  value,
  tables,
  onFollow,
}: {
  column: DataColumn;
  value: DataValue | undefined;
  tables: DataTable[];
  onFollow: (table: string, row: string) => void;
}) {
  const target = column.references ? tables.find((candidate) => candidate.id === column.references) : undefined;
  const pointed =
    target && value !== null && value !== undefined
      ? target.rows.find((candidate) => String(candidate.cells.id) === String(value))
      : undefined;
  if (target && pointed)
    return (
      <button
        type="button"
        onClick={() => onFollow(target.id, pointed.id)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-canvas-raised px-2 py-0.5 hover:bg-hover"
      >
        <span className="tabular-nums">{String(value)}</span>
        <span className="text-meta text-fg-muted">
          {target.label} · {firstText(target, pointed)}
        </span>
        <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" className="text-fg-muted" />
      </button>
    );
  return (
    <>
      <Value value={value} type={column.type} full />
      {column.type === 'timestamp' && typeof value === 'string' && (
        <span className="mt-0.5 block font-mono text-meta text-fg-faint">{value}</span>
      )}
    </>
  );
}

/** An input that fits the column's type. `null` is "비어 있음"; 비우기 sets it. The key column cannot be edited. */
function Editor({
  column,
  value,
  fixed,
  onChange,
}: {
  column: DataColumn;
  value: string | null;
  fixed: string | null;
  onChange: (value: string | null) => void;
}) {
  const t = useMessages(messages);
  if (fixed !== null) return <span className="font-mono text-meta text-fg-muted">{fixed}</span>;
  const label = `${column.key} (${column.type})`;
  let input: ReactNode;
  switch (column.type) {
    case 'boolean':
      input = (
        <NativeSelect aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)}>
          <option value="">{t.nothing}</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </NativeSelect>
      );
      break;
    case 'timestamp':
      input = (
        <Input
          aria-label={label}
          type="datetime-local"
          value={value ? toLocalInput(value) : ''}
          onChange={(event) => onChange(fromLocalInput(event.target.value))}
        />
      );
      break;
    case 'json':
      input = (
        <textarea
          aria-label={label}
          rows={4}
          value={value ?? ''}
          placeholder={t.nothing}
          onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
          className="w-full rounded-md border border-line bg-canvas-raised px-2 py-1.5 font-mono text-meta text-fg outline-none placeholder:text-fg-faint focus:border-interactive focus:ring-1 focus:ring-interactive"
        />
      );
      break;
    default:
      input = (
        <Input
          aria-label={label}
          type={column.type === 'integer' || column.type === 'real' ? 'number' : 'text'}
          value={value ?? ''}
          placeholder={value === null ? t.nothing : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0 grow">{input}</div>
      <LinkButton
        onClick={() => onChange(null)}
        className={clsx('shrink-0', value === null && 'invisible')}
        tabIndex={value === null ? -1 : 0}
      >
        {t.clear}
      </LinkButton>
    </div>
  );
}

function draftOf(table: DataTable, row: DataRow | null): Draft {
  const draft: Draft = {};
  for (const column of table.columns) {
    const value = row?.cells[column.key];
    draft[column.key] =
      value === null || value === undefined
        ? null
        : column.type === 'json' || typeof value === 'object'
          ? JSON.stringify(value, null, 2)
          : String(value);
  }
  return draft;
}

const INVALID = Symbol('invalid');

function parse(column: DataColumn, text: string | null): DataValue | typeof INVALID {
  if (text === null) return null;
  switch (column.type) {
    case 'integer':
    case 'real': {
      if (text.trim() === '') return null;
      const number = Number(text);
      return Number.isNaN(number) ? null : column.type === 'integer' ? Math.trunc(number) : number;
    }
    case 'boolean':
      return text === 'true';
    case 'json':
      try {
        return JSON.parse(text) as DataValue;
      } catch {
        return INVALID;
      }
    default:
      return text;
  }
}
