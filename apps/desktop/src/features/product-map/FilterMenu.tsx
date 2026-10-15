import { Popover } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Check, X } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { VERIFICATIONS, type Verification } from './model';
import { VerificationIcon } from './status';

export interface Filters {
  status: Verification | null;
  must: boolean;
  now: boolean;
}
export const activeCount = (filters: Filters) => Number(!!filters.status) + Number(filters.must) + Number(filters.now);

const row =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body hover:bg-hover disabled:cursor-default disabled:text-fg-faint disabled:hover:bg-transparent aria-pressed:bg-selected';

function Toggle({
  on,
  title,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={on} title={title} disabled={disabled} onClick={onClick} className={row}>
      {children}
      <Check size={13} aria-hidden className={clsx('ml-auto shrink-0 text-interactive', !on && 'invisible')} />
    </button>
  );
}

/** One "필터" button; the popover holds every filter, each toggled in place and shown again as a tag beside the button. */
export function FilterMenu({
  filters,
  counts,
  onChange,
}: {
  filters: Filters;
  counts: Record<Verification, number>;
  onChange: (next: Filters) => void;
}) {
  const t = useMessages(messages);
  const active = activeCount(filters);
  const meaning: Record<Verification, string> = {
    failed: t.meaningFailed,
    question: t.meaningQuestion,
    recheck: t.meaningRecheck,
    unconfirmed: t.meaningUnconfirmed,
    passed: t.meaningPassed,
    none: t.meaningNone,
  };
  return (
    <Popover.Root>
      <Popover.Trigger
        className={clsx(
          'inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 text-body whitespace-nowrap hover:bg-hover hover:text-fg data-popup-open:bg-hover',
          active ? 'bg-selected text-fg' : 'text-fg-muted',
        )}
      >
        {t.filterButton(active)}
      </Popover.Trigger>
      <Popover.Popup className="w-64 gap-0.5 p-2">
        <div role="group" aria-label={t.filterStatus} className="flex flex-col gap-0.5">
          <p aria-hidden className="px-2 py-1 text-meta font-medium text-fg-muted">
            {t.filterStatus}
          </p>
          {VERIFICATIONS.map((status) => (
            <Toggle
              key={status}
              on={filters.status === status}
              title={meaning[status]}
              disabled={!counts[status] && filters.status !== status}
              onClick={() => onChange({ ...filters, status: filters.status === status ? null : status })}
            >
              <VerificationIcon status={status} size={13} />
              {t[status]} <span className="text-meta text-fg-muted tabular-nums">{counts[status]}</span>
            </Toggle>
          ))}
        </div>
        <div className="my-1 border-t border-line-subtle" />
        <div role="group" aria-label={t.filterPlan} className="flex flex-col gap-0.5">
          <p aria-hidden className="px-2 py-1 text-meta font-medium text-fg-muted">
            {t.filterPlan}
          </p>
          <Toggle on={filters.must} onClick={() => onChange({ ...filters, must: !filters.must })}>
            {t.filterMust}
          </Toggle>
          <Toggle on={filters.now} onClick={() => onChange({ ...filters, now: !filters.now })}>
            {t.filterNow}
          </Toggle>
        </div>
      </Popover.Popup>
    </Popover.Root>
  );
}

/** The filters in force, each removable, so nothing dims the map without saying why. */
export function ActiveFilters({ filters, onChange }: { filters: Filters; onChange: (next: Filters) => void }) {
  const t = useMessages(messages);
  const tags: [string, Filters][] = [];
  if (filters.status) tags.push([t[filters.status], { ...filters, status: null }]);
  if (filters.must) tags.push([t.filterMust, { ...filters, must: false }]);
  if (filters.now) tags.push([t.filterNow, { ...filters, now: false }]);
  if (!tags.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label={t.activeFilters}>
      {tags.map(([label, next]) => (
        <li
          key={label}
          className="flex items-center gap-1 rounded-md bg-selected py-0.5 pr-1 pl-2 text-meta text-interactive"
        >
          {label}
          <button
            type="button"
            aria-label={t.removeFilter(label)}
            onClick={() => onChange(next)}
            className="grid size-4 cursor-pointer place-items-center rounded-md hover:bg-hover"
          >
            <X size={11} aria-hidden />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={() => onChange({ status: null, must: false, now: false })}
          className="cursor-pointer px-1 text-meta text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        >
          {t.clearFilters}
        </button>
      </li>
    </ul>
  );
}
