import type { MapCoverage } from '@alpine/protocol';
import { Button, Popover } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { lookRow } from './Focus';
import { messages } from './messages';

function Folded({ label, lead, items = [] }: { label: string; lead: string; items?: string[] }) {
  return (
    <details className="text-meta text-fg-muted">
      <summary className="cursor-pointer">{label}</summary>
      <p className="mt-0.5">{lead}</p>
      {items.length > 0 && (
        <ul className="mt-1 max-h-32 overflow-y-auto font-mono break-all">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

/**
 * What changed in the project that the map does not cover, as one more "봐야 할 것" row. Its popover lists the files
 * and, folded under them, the changes not counted (outside the scope or left out by the AI).
 */
export function Coverage({
  coverage,
  exclude = [],
  disabled,
  onSync,
}: {
  coverage: MapCoverage;
  /** The AI's `exclude` patterns, shown under the changes they hide. */
  exclude?: string[];
  disabled: boolean;
  onSync: () => void;
}) {
  const t = useMessages(messages);
  const uncovered = coverage.git ? (coverage.uncoveredCount ?? 0) : 0;
  const files = coverage.uncovered ?? [];
  if (!uncovered) return null;
  return (
    <li>
      <Popover.Root>
        <Popover.Trigger className={clsx(lookRow, 'data-popup-open:bg-selected')}>
          <span className="min-w-0 grow truncate">{t.lookUncovered}</span>
          <span className="shrink-0 text-meta tabular-nums">{uncovered}</span>
          <ChevronRight size={13} aria-hidden className="shrink-0 text-fg-muted" />
        </Popover.Trigger>
        <Popover.Popup align="end" className="w-96 gap-2 p-3">
          <p className="text-meta text-fg-muted">{t.uncoveredLead}</p>
          <ul className="max-h-60 overflow-y-auto font-mono text-meta break-all">
            {files.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {uncovered > files.length && (
            <p className="text-meta text-fg-muted">{t.uncoveredMore(uncovered - files.length)}</p>
          )}
          {!!coverage.outOfScope && <Folded label={t.outOfScope(coverage.outOfScope)} lead={t.outOfScopeLead} />}
          {!!coverage.excluded && (
            <Folded label={t.excludedChanges(coverage.excluded)} lead={t.excludedLead} items={exclude} />
          )}
          <div>
            <Button variant="primary" disabled={disabled} onClick={onSync}>
              {t.syncMap}
            </Button>
          </div>
        </Popover.Popup>
      </Popover.Root>
    </li>
  );
}
