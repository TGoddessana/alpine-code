import type { MemorySuggestionInfo } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { ServerError, useApproveMemory, useRejectMemory } from '@/shared/server';

import { Headline } from './Headline';
import { messages } from './messages';
import { useMemoryWords } from './words';

/**
 * A memory waiting for my answer: what it would remember, where it came from, and keep or decline. The details
 * (the reason and examples the agent wrote) open on a click. A suggestion to remove a memory shows that memory and
 * why (for the harness's, the paths that are gone), and removes it or keeps it.
 */
export function SuggestionCard({ cwd, suggestion }: { cwd: string; suggestion: MemorySuggestionInfo }) {
  const t = useMessages(messages);
  const format = useFormat();
  const words = useMemoryWords();
  const approve = useApproveMemory();
  const reject = useRejectMemory();
  const [open, setOpen] = useState(false);

  const quote = suggestion.evidence.at(-1)?.quote;
  const busy = approve.isPending || reject.isPending;
  const error = approve.error ?? reject.error;
  const full = error instanceof ServerError && error.data?.reason === 'memory_full';
  const answer = { cwd, suggestionId: suggestion.id };

  return (
    <section
      aria-label={t.suggestionLabel}
      className="flex flex-col gap-3 rounded-xl border border-line bg-canvas-raised p-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 grow flex-col gap-1">
          <p className="text-meta text-fg-muted">
            {suggestion.remove ? t.askRemove : t.ask} · {words.kind(suggestion.kind)}
          </p>
          <p className="text-body">
            <Headline text={suggestion.headline} />
          </p>
        </div>
        <span className="shrink-0 text-meta text-fg-muted">{words.scope(suggestion.scope)}</span>
      </div>
      {(quote || (!suggestion.remove && suggestion.replaces.length > 0)) && (
        <div className="flex flex-col gap-0.5 text-meta text-fg-muted">
          {quote &&
            (suggestion.source === 'missing_paths' ? (
              <p className="break-all">
                {t.missing} <span className="font-mono">{quote}</span>
              </p>
            ) : (
              <p className="line-clamp-2">{t.from(quote)}</p>
            ))}
          {!suggestion.remove && suggestion.replaces.length > 0 && (
            <p>{t.changes(format.number(suggestion.replaces.length))}</p>
          )}
        </div>
      )}
      {open && (
        <p className="rounded-lg bg-canvas-sunken px-3 py-2 text-body whitespace-pre-wrap text-fg-muted">
          {suggestion.body}
        </p>
      )}
      {error && (
        <p role="alert" className="text-meta text-danger">
          {full ? t.full : t.failed}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={busy} onClick={() => approve.mutate(answer)}>
          {suggestion.remove ? t.remove : t.keep}
        </Button>
        <Button disabled={busy} onClick={() => reject.mutate(answer)}>
          {suggestion.remove ? t.keepIt : t.decline}
        </Button>
        <span className="grow" />
        {suggestion.body && (
          <LinkButton aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t.hideBody : t.showBody}
            <span aria-hidden="true" className={clsx('ml-1 inline-block transition-transform', open && 'rotate-90')}>
              ›
            </span>
          </LinkButton>
        )}
      </div>
    </section>
  );
}
