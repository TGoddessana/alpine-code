import type { UnmappedPart } from '@alpine/protocol';
import { Button, Popover } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { lookRow } from './Focus';
import { messages } from './messages';

/**
 * What the AI knows exists but has not mapped yet (map.json `unmapped`), as one more "봐야 할 것" row. Its popover
 * lists each part with why and where, and continues the map from them.
 */
export function Unmapped({
  parts,
  disabled,
  onContinue,
}: {
  parts: UnmappedPart[];
  disabled: boolean;
  onContinue: () => void;
}) {
  const t = useMessages(messages);
  if (!parts.length) return null;
  return (
    <li>
      <Popover.Root>
        <Popover.Trigger className={clsx(lookRow, 'data-popup-open:bg-selected')}>
          <span className="min-w-0 grow truncate">{t.lookUnmapped}</span>
          <span className="shrink-0 text-meta tabular-nums">{parts.length}</span>
          <ChevronRight size={13} aria-hidden className="shrink-0 text-fg-muted" />
        </Popover.Trigger>
        <Popover.Popup align="end" className="w-96 gap-2 p-3">
          <p className="text-meta text-fg-muted">{t.unmappedLead}</p>
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {parts.map((part) => (
              <li key={part.title} className="flex flex-col gap-0.5">
                <span className="text-body">{part.title}</span>
                {part.why && <span className="text-meta text-fg-muted">{part.why}</span>}
                {!!part.paths?.length && (
                  <span className="font-mono text-meta break-all text-fg-muted">{part.paths.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
          <div>
            <Button variant="primary" disabled={disabled} onClick={onContinue}>
              {t.continueMapping}
            </Button>
          </div>
        </Popover.Popup>
      </Popover.Root>
    </li>
  );
}
