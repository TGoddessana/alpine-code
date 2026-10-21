import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { useProductMap } from '@/shared/server';

import { toTreeMap } from './flowTreeData';
import { flowTreeMessages } from './flowTreeMessages';
import { messages } from './messages';
import { mapOf } from './model';
import { bounds, layoutTree, type LaidNode } from './treeLayout';

const FOLDED_KEY = 'alpine.mini-map.folded';
const MAX_HEIGHT = 160;

/**
 * The project's map, small, at the top of the dock: the same people, journeys and steps as the canvas, laid out the
 * same way, without words. Pressing it opens the map. It can be folded to one line, and that is remembered.
 */
export function MiniMap({ cwd, onOpen }: { cwd: string; onOpen: () => void }) {
  const t = useMessages(messages);
  const words = useMessages(flowTreeMessages);
  const format = useFormat();
  const board = useProductMap(cwd);
  const [folded, setFolded] = useState(() => {
    try {
      return localStorage.getItem(FOLDED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const fold = (next: boolean) => {
    setFolded(next);
    try {
      localStorage.setItem(FOLDED_KEY, String(next));
    } catch {
      // Not remembered, but it still folds.
    }
  };
  const drawn = useMemo(() => {
    if (!board.data) return null;
    const document = mapOf(board.data);
    if (!document.nodes?.length && !document.flows?.length) return { empty: true as const };
    // The small map draws no "being checked" state, so no session ever redraws it.
    const map = toTreeMap(board.data, new Set(), cwd.split('/').pop() ?? cwd, {
      unnamed: { ko: words.unnamed, en: words.unnamed },
      unnamedRole: { ko: words.unnamedRole, en: words.unnamedRole },
    });
    const layout = layoutTree(map, new Set());
    const nodes = layout.nodes.filter((node) => node.kind !== 'addJourney' && node.kind !== 'addPerson');
    const recheck = new Set(
      nodes.filter((node) => node.status === 'recheck' || node.status === 'failed').map((node) => node.cardId),
    ).size;
    return {
      empty: false as const,
      nodes,
      edges: layout.edges,
      recheck,
      flows: document.flows?.length ?? 0,
      cards: document.nodes?.length ?? 0,
    };
  }, [board.data, cwd, words.unnamed, words.unnamedRole]);

  if (!drawn) return null;
  if (drawn.empty) {
    return (
      <div className="mx-3 mb-2 flex items-center justify-between rounded-lg border border-line px-3 py-2 text-meta text-fg-muted">
        <span>{t.miniEmpty}</span>
        <button type="button" onClick={onOpen} className="cursor-pointer text-interactive hover:underline">
          {t.discover}
        </button>
      </div>
    );
  }
  const box = bounds(drawn.nodes);
  const byId = new Map(drawn.nodes.map((node) => [node.id, node]));
  return (
    <section aria-label={t.title} className="mx-3 mb-2 shrink-0 rounded-lg border border-line bg-canvas-raised">
      <div className="flex h-8 items-center gap-2 pr-1 pl-3 text-meta text-fg-muted">
        <span className="min-w-0 grow truncate">
          {t.miniCounts(format.number(drawn.flows), format.number(drawn.cards))}
          {drawn.recheck > 0 && (
            <span className="text-attention"> · {t.miniRecheck(format.number(drawn.recheck))}</span>
          )}
        </span>
        <button
          type="button"
          aria-expanded={!folded}
          aria-label={folded ? t.miniUnfold : t.miniFold}
          onClick={() => fold(!folded)}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md hover:bg-hover hover:text-fg"
        >
          <ChevronDown size={14} aria-hidden className={folded ? '-rotate-90' : undefined} />
        </button>
      </div>
      {!folded && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={t.miniOpen}
          className="block w-full cursor-pointer rounded-b-lg px-2 pb-2 outline-none hover:bg-hover/40 focus-visible:ring-2 focus-visible:ring-interactive"
        >
          <svg
            viewBox={`${box.x - 16} ${box.y - 16} ${box.w + 32} ${box.h + 32}`}
            preserveAspectRatio="xMidYMid meet"
            // As tall as the map's shape asks, up to a limit, so a wide map leaves no empty band.
            style={{ aspectRatio: `${box.w + 32} / ${box.h + 32}`, maxHeight: MAX_HEIGHT }}
            className="w-full"
            aria-hidden
          >
            {drawn.edges.map((edge) => {
              const from = byId.get(edge.from);
              const to = byId.get(edge.to);
              if (!from || !to || from.kind === 'band' || to.kind === 'band') return null;
              const x1 = from.x + from.w;
              const y1 = from.y + 22;
              const x2 = to.x;
              const y2 = to.y + 22;
              const mid = (x1 + x2) / 2;
              return (
                <path
                  key={edge.id}
                  d={`M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`}
                  fill="none"
                  className="stroke-line"
                  strokeWidth={6}
                />
              );
            })}
            {drawn.nodes.map((node) => (
              <MiniNode key={node.id} node={node} />
            ))}
          </svg>
        </button>
      )}
    </section>
  );
}

function MiniNode({ node }: { node: LaidNode }) {
  if (node.kind === 'band') {
    return <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={24} className="fill-canvas-sunken/60" />;
  }
  const tone =
    node.kind === 'start'
      ? 'fill-avatar-2 stroke-avatar-2'
      : node.status === 'failed'
        ? 'fill-canvas-raised stroke-danger'
        : node.status === 'recheck'
          ? 'fill-canvas-raised stroke-attention'
          : 'fill-canvas-raised stroke-line';
  return (
    <rect
      x={node.x}
      y={node.y}
      width={node.w}
      height={Math.min(node.h, 120)}
      rx={16}
      strokeWidth={5}
      className={tone}
    />
  );
}
