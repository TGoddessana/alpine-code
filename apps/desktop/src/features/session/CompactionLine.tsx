import type { CompactionItem } from '@alpine/protocol';
import { Collapse } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useState } from 'react';

import { Markdown } from '@/shared/components/markdown';
import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';

/**
 * The line where the conversation was tidied, the same for clearing old tool results and for summarizing the older
 * part. It opens to what happened: how many results were cleared, and the summary the model now reads instead.
 */
export function CompactionLine({ item }: { item: CompactionItem }) {
  const t = useMessages(messages);
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const line = t.compaction(format.number(item.beforeTokens), format.number(item.afterTokens));
  if (!item.cleared && !item.summary)
    return (
      <div className="flex items-center gap-3 text-meta text-fg-muted">
        <span className="h-px grow bg-line-subtle" />
        {line}
        <span className="h-px grow bg-line-subtle" />
      </div>
    );
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="group flex cursor-pointer items-center gap-3 text-meta text-fg-muted hover:text-fg"
      >
        <span className="h-px grow bg-line-subtle" />
        {line}
        <span aria-hidden="true" className={clsx('transition-transform', open && 'rotate-90')}>
          ›
        </span>
        <span className="h-px grow bg-line-subtle" />
      </button>
      <Collapse open={open}>
        <div className="mt-2 flex flex-col gap-2 rounded-md bg-canvas-sunken px-3 py-2.5 text-meta text-fg-muted">
          {item.cleared > 0 && <p>{t.compactionCleared(format.number(item.cleared))}</p>}
          {item.summary && (
            <section className="flex flex-col gap-1">
              <h3 className="font-semibold text-fg">{t.compactionSummary}</h3>
              <Markdown text={item.summary} streaming={false} />
            </section>
          )}
        </div>
      </Collapse>
    </div>
  );
}
