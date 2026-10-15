import type { ProductFlow } from '@alpine/protocol';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';

import { useMessages } from '@/shared/i18n';

import { lookRow } from './Focus';
import { messages } from './messages';

/**
 * The map's table of contents, and where it says what needs a look: one row per flow, marked "봐야 할 것 N" when some
 * of its features need one. Picking a flow brings it into view, dims every card outside it and tags the cards that need
 * a look with why; picking it again lets the whole map show. `extra` rows (code changes not on the map) sit below.
 */
export function FlowList({
  flows,
  looks,
  active,
  onToggle,
  extra,
}: {
  flows: ProductFlow[];
  looks: { nodeId: string }[];
  active: string | null;
  onToggle: (flowId: string) => void;
  extra?: React.ReactNode;
}) {
  const t = useMessages(messages);
  if (!flows.length && !extra) return null;
  const needing = new Set(looks.map((look) => look.nodeId));
  return (
    <section aria-label={t.flowListTitle} className="flex flex-col">
      <h2 className="px-2 pb-1 text-meta text-fg-muted">{t.flowListTitle}</h2>
      <ol className="flex flex-col border-b border-line-subtle">
        {flows.map((flow, index) => {
          const on = active === flow.id;
          const toLook = (flow.nodeIds ?? []).filter((id) => needing.has(id)).length;
          return (
            <li key={flow.id} className={clsx(on && 'bg-selected')}>
              <button
                type="button"
                aria-pressed={on}
                title={flow.description || undefined}
                onClick={() => onToggle(flow.id)}
                className={lookRow}
              >
                <span className="w-4 shrink-0 text-meta text-fg-muted tabular-nums">{index + 1}</span>
                <span className="min-w-0 grow truncate">{flow.title}</span>
                {toLook > 0 && <span className="shrink-0 text-meta tabular-nums">{t.toLookCount(toLook)}</span>}
                {on ? (
                  <span className="shrink-0 text-meta text-fg-muted">{t.lookStop}</span>
                ) : (
                  <ChevronRight size={13} aria-hidden className="shrink-0 text-fg-muted" />
                )}
              </button>
            </li>
          );
        })}
        {extra}
      </ol>
    </section>
  );
}
