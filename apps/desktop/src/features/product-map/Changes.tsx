import type { FlowChange, FlowGetResult } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { mapOf } from './model';

const storageKey = (cwd: string) => `alpine:product-map:seen:${cwd}`;

/** A first visit counts only the last week as new, so older history does not all light up. */
const FIRST_VISIT_WINDOW = 7 * 24 * 60 * 60 * 1000;

/** The time of the user's last look at the changes. A first visit starts a week back, so recent work still shows as new. */
function readSeen(cwd: string) {
  const now = new Date(Date.now() - FIRST_VISIT_WINDOW).toISOString();
  try {
    const stored = globalThis.localStorage.getItem(storageKey(cwd));
    if (stored && !Number.isNaN(Date.parse(stored))) return stored;
    globalThis.localStorage.setItem(storageKey(cwd), now);
  } catch {
    // Storage can be blocked; changes then count from this visit only.
  }
  return now;
}

export function useLastSeen(cwd: string) {
  const [state, setState] = useState(() => ({ cwd, at: readSeen(cwd) }));
  if (state.cwd !== cwd) setState({ cwd, at: readSeen(cwd) });
  const mark = () => {
    const at = new Date().toISOString();
    try {
      globalThis.localStorage.setItem(storageKey(cwd), at);
    } catch {
      // Not remembering across visits is acceptable.
    }
    setState({ cwd, at });
  };
  return [state.at, mark] as const;
}

export function newChanges(changes: FlowChange[] | undefined, since: string) {
  const from = Date.parse(since);
  return (changes ?? []).filter((c) => Date.parse(c.at) > from);
}

/** Right-hand list of what changed, newest first, in plain words. */
export function Changes({
  board,
  since,
  onSelect,
  onClose,
}: {
  board: FlowGetResult;
  /** Changes after this time are marked as new. */
  since: string;
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}) {
  const t = useMessages(messages);
  const changes = board.changes ?? [];
  // Progress words come from the server as raw states ("planned -> built"); show them in the user's language.
  const phaseWord = (value: string) => (t as unknown as Record<string, unknown>)[value.trim()];
  const detailOf = (change: FlowChange) => {
    if (change.kind !== 'phase' && change.kind !== 'added' && change.kind !== 'removed') return change.detail ?? '';
    const words = (change.detail ?? '').split('->').map((part) => phaseWord(part));
    return words.every((word) => typeof word === 'string') ? words.join(' → ') : '';
  };
  const known = new Set((mapOf(board).nodes ?? []).map((n) => n.id));
  const from = Date.parse(since);
  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-line" aria-label={t.changesTitle}>
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-lead">{t.changesTitle}</h2>
        <Button aria-label={t.close} onClick={onClose}>
          <X size={14} />
        </Button>
      </div>
      {changes.length ? (
        <ul className="min-h-0 grow overflow-y-auto">
          {changes.map((change, index) => {
            const date = new Date(change.at);
            const fresh = Date.parse(change.at) > from;
            const clickable = known.has(change.nodeId);
            return (
              <li key={`${change.at}-${change.nodeId}-${index}`} className="border-b border-line-subtle">
                <button
                  disabled={!clickable}
                  onClick={() => onSelect(change.nodeId)}
                  className={clsx(
                    'flex w-full flex-col gap-0.5 px-4 py-2.5 text-left',
                    clickable ? 'cursor-pointer hover:bg-hover' : 'cursor-default',
                  )}
                >
                  <span className="flex items-center gap-2 text-body">
                    {fresh && (
                      <span
                        role="img"
                        aria-label={t.changesNew}
                        title={t.changesNew}
                        className="size-1.5 shrink-0 rounded-full bg-interactive"
                      />
                    )}
                    <span className={clsx(fresh && 'font-medium')}>
                      {t.changeDate(date.getMonth() + 1, date.getDate())} · {change.title} · {t.changeKind(change.kind)}
                    </span>
                  </span>
                  {detailOf(change) && <span className="text-meta text-fg-muted">{detailOf(change)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-4 text-body text-fg-muted">{t.changesEmpty}</p>
      )}
    </aside>
  );
}
