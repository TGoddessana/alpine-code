import { Button, Input, LinkButton, NativeSelect } from '@alpine/ui/primitives';
import { ListFilter, X } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import type { DataColumn } from './types';
import { needsValue, type Filter, type FilterOp } from './values';

/**
 * Column filters as chips ("status 같음 waitlisted ×"), all applied together. A new one is written in one line under
 * them and applied with Enter.
 */
export function Filters({
  columns,
  filters,
  onChange,
}: {
  columns: DataColumn[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const t = useMessages(messages);
  const [draft, setDraft] = useState<Filter | null>(null);
  const ops: { value: FilterOp; label: string }[] = [
    { value: 'is', label: t.opIs },
    { value: 'contains', label: t.opContains },
    { value: 'empty', label: t.opEmpty },
    { value: 'filled', label: t.opFilled },
    { value: 'gt', label: t.opGt },
    { value: 'lt', label: t.opLt },
  ];
  const label = (filter: Filter) =>
    [filter.column, ops.find((op) => op.value === filter.op)?.label, needsValue(filter.op) ? filter.value : '']
      .filter(Boolean)
      .join(' ');
  const ready = draft && (!needsValue(draft.op) || draft.value.trim() !== '');
  const apply = () => {
    if (!draft || !ready) return;
    onChange([...filters, draft]);
    setDraft(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {filters.map((filter, index) => (
          <span
            key={`${label(filter)}-${index}`}
            className="motion-step inline-flex items-center gap-1 rounded-full border border-interactive bg-selected py-0.5 pr-1 pl-2.5 text-meta text-fg"
          >
            <span className="font-mono">{filter.column}</span>
            <span className="text-fg-muted">{ops.find((op) => op.value === filter.op)?.label}</span>
            {needsValue(filter.op) && <span>{filter.value}</span>}
            <button
              type="button"
              aria-label={t.removeFilter(label(filter))}
              onClick={() => onChange(filters.filter((_, at) => at !== index))}
              className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:bg-hover hover:text-fg"
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        {!draft && (
          <LinkButton
            onClick={() =>
              setDraft({
                column: columns.find((c) => c.key !== 'id')?.key ?? columns[0]?.key ?? '',
                op: 'is',
                value: '',
              })
            }
            className="gap-1"
          >
            <ListFilter size={12} aria-hidden="true" />
            {t.addFilter}
          </LinkButton>
        )}
      </div>
      {draft && (
        <form
          className="motion-step flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <label className="w-36 shrink-0">
            <span className="sr-only">{t.filterColumn}</span>
            <NativeSelect
              value={draft.column}
              onChange={(event) => setDraft({ ...draft, column: event.target.value })}
              className="font-mono text-meta"
            >
              {columns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.key}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="w-32 shrink-0">
            <span className="sr-only">{t.filterOp}</span>
            <NativeSelect
              value={draft.op}
              onChange={(event) => setDraft({ ...draft, op: event.target.value as FilterOp })}
            >
              {ops.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </NativeSelect>
          </label>
          {needsValue(draft.op) && (
            <label className="min-w-0 grow">
              <span className="sr-only">{t.filterValue}</span>
              <Input
                autoFocus
                value={draft.value}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}
              />
            </label>
          )}
          <Button type="submit" variant="primary" disabled={!ready}>
            {t.apply}
          </Button>
          <Button onClick={() => setDraft(null)}>{t.cancel}</Button>
        </form>
      )}
    </div>
  );
}
