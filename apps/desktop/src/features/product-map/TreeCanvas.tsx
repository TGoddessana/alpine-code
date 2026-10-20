import clsx from 'clsx';
import { Maximize, Minus, Plus } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useMessages } from '@/shared/i18n';

import { flowTreeMessages as messages } from './flowTreeMessages';
import { BRANCH_X, bounds, type LaidNode } from './treeLayout';

/** A node as drawn this frame: where it is on its way to its laid-out place, and how visible. */
export interface ShownNode extends LaidNode {
  opacity: number;
  leaving: boolean;
}

interface View {
  x: number;
  y: number;
  k: number;
}

export interface TreeCanvasHandle {
  /** Brings a node into view, centred, unless it is already well inside. */
  reveal: (id: string) => void;
  fit: () => void;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 1.6;
const DURATION = 380;
/** Close to the app's --motion-ease (0.22, 1, 0.36, 1). */
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * A pannable, zoomable canvas for the tree. Nodes glide to their new place when the layout changes, new ones grow out
 * of their parent and closed ones fold back into it; lines are drawn every frame from where the nodes are, so they
 * follow. Drag the empty canvas to move, scroll to move, pinch or Ctrl/⌘+scroll to zoom.
 */
export const TreeCanvas = forwardRef<
  TreeCanvasHandle,
  {
    nodes: LaidNode[];
    highlight: Set<string>;
    renderNode: (node: ShownNode) => ReactNode;
    /** Ids whose subtree should fit the first view. */
    initialFocus?: string[];
    overlay?: ReactNode;
  }
>(function TreeCanvas({ nodes, highlight, renderNode, initialFocus, overlay }, ref) {
  const t = useMessages(messages);
  const viewport = useRef<HTMLDivElement>(null);
  const shown = useTweenedNodes(nodes);
  const [view, setView] = useState<View>({ x: 48, y: 48, k: 0.85 });
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const viewAnimation = useRef<number | null>(null);

  const animateView = useCallback((to: View) => {
    if (viewAnimation.current) cancelAnimationFrame(viewAnimation.current);
    const from = viewRef.current;
    if (reducedMotion()) return setView(to);
    const start = performance.now();
    const step = (now: number) => {
      const p = ease(Math.min(1, (now - start) / DURATION));
      setView({ x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, k: from.k + (to.k - from.k) * p });
      viewAnimation.current = p < 1 ? requestAnimationFrame(step) : null;
    };
    viewAnimation.current = requestAnimationFrame(step);
  }, []);

  const fitTo = useCallback(
    (targets: LaidNode[], animate = true) => {
      const element = viewport.current;
      if (!element || !targets.length) return;
      const box = bounds(targets);
      const width = element.clientWidth;
      const height = element.clientHeight;
      const k = clamp(Math.min((width - 96) / box.w, (height - 96) / box.h, 1), MIN_ZOOM, 1);
      const next = { k, x: (width - box.w * k) / 2 - box.x * k, y: Math.max(48, (height - box.h * k) / 2) - box.y * k };
      if (animate) animateView(next);
      else setView(next);
    },
    [animateView],
  );

  const nodesRef = useRef(nodes);
  useLayoutEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useImperativeHandle(
    ref,
    () => ({
      fit: () => fitTo(nodesRef.current),
      reveal: (id) => {
        const element = viewport.current;
        const node = nodesRef.current.find((candidate) => candidate.id === id);
        if (!element || !node) return;
        const { x, y, k } = viewRef.current;
        const left = node.x * k + x;
        const top = node.y * k + y;
        const margin = 64;
        const inside =
          left > margin &&
          top > margin &&
          left + node.w * k < element.clientWidth - margin &&
          top + node.h * k < element.clientHeight - margin;
        if (inside) return;
        animateView({
          k,
          x: element.clientWidth / 2 - (node.x + node.w / 2) * k,
          y: element.clientHeight / 2 - (node.y + node.h / 2) * k,
        });
      },
    }),
    [animateView, fitTo],
  );

  // The first view: the product, its people and the open person, at a zoom that fits.
  const fitted = useRef(false);
  useLayoutEffect(() => {
    if (fitted.current || !nodes.length) return;
    fitted.current = true;
    const focus = initialFocus ? nodes.filter((node) => initialFocus.some((id) => node.id.startsWith(id))) : nodes;
    fitTo(focus.length ? focus : nodes, false);
  }, [nodes, initialFocus, fitTo]);

  // Scroll moves; pinch or Ctrl/⌘ + scroll zooms around the pointer. Not passive, so the page itself never scrolls.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (viewAnimation.current) cancelAnimationFrame(viewAnimation.current);
      const current = viewRef.current;
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const k = clamp(current.k * Math.exp(-event.deltaY * 0.008), MIN_ZOOM, MAX_ZOOM);
        setView({ k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k });
      } else setView({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const zoomBy = (factor: number) => {
    const element = viewport.current;
    if (!element) return;
    const { x, y, k } = viewRef.current;
    const next = clamp(k * factor, MIN_ZOOM, MAX_ZOOM);
    const cx = element.clientWidth / 2;
    const cy = element.clientHeight / 2;
    animateView({ k: next, x: cx - ((cx - x) * next) / k, y: cy - ((cy - y) * next) / k });
  };

  const byId = new Map(shown.map((node) => [node.id, node]));
  const grid = 24 * view.k;

  return (
    <div className="relative min-w-0 grow overflow-hidden">
      <div
        ref={viewport}
        role="presentation"
        className={clsx('absolute inset-0 touch-none select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        style={{
          backgroundImage: 'radial-gradient(var(--color-line) 1px, transparent 1px)',
          backgroundSize: `${grid}px ${grid}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-node]')) return;
          if (viewAnimation.current) cancelAnimationFrame(viewAnimation.current);
          drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          drag.current = { ...start, x: event.clientX, y: event.clientY };
          setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}
        >
          <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
            {shown.map((node) => {
              const parent = node.parent ? byId.get(node.parent) : undefined;
              if (!parent) return null;
              return (
                <Edge
                  key={node.id}
                  parent={parent}
                  child={node}
                  on={highlight.has(node.id)}
                  opacity={Math.min(node.opacity, parent.opacity)}
                />
              );
            })}
          </svg>
          {shown.map((node) => (
            <div
              key={node.id}
              data-node
              className="absolute top-0 left-0"
              style={{
                width: node.w,
                height: node.h,
                transform: `translate(${node.x}px, ${node.y}px)`,
                opacity: node.opacity,
                pointerEvents: node.leaving ? 'none' : undefined,
              }}
            >
              {renderNode(node)}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-0.5 rounded-lg border border-line bg-canvas-raised p-0.5 shadow-overlay">
        <CanvasButton label={t.zoomOut} onClick={() => zoomBy(1 / 1.25)}>
          <Minus size={14} aria-hidden />
        </CanvasButton>
        <span className="w-11 text-center text-meta text-fg-muted tabular-nums">{Math.round(view.k * 100)}%</span>
        <CanvasButton label={t.zoomIn} onClick={() => zoomBy(1.25)}>
          <Plus size={14} aria-hidden />
        </CanvasButton>
        <span className="mx-0.5 h-4 border-l border-line-subtle" aria-hidden />
        <CanvasButton label={t.fit} onClick={() => fitTo(nodesRef.current)}>
          <Maximize size={13} aria-hidden />
          <span className="text-meta">{t.fit}</span>
        </CanvasButton>
      </div>
      {overlay}
    </div>
  );
});

function CanvasButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1.5 rounded-md px-1.5 text-fg-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

/**
 * A line into a node. Between the product, people and journeys, and along a journey's steps, a curve from the right
 * edge to the left edge (straight when the two sit level). Into a promise, a branch down the step's gutter: solid once
 * the promise is known to hold, dashed while nobody checked it, red when broken, and running while it is checked.
 */
function Edge({ parent, child, on, opacity }: { parent: ShownNode; child: ShownNode; on: boolean; opacity: number }) {
  if (child.kind === 'promise' || child.kind === 'addPromise') {
    const x = parent.x + BRANCH_X;
    const top = parent.y + parent.h;
    const y = child.y + child.h / 2;
    const r = 10;
    const d = `M ${x} ${top} L ${x} ${y - r} Q ${x} ${y} ${x + r} ${y} L ${child.x} ${y}`;
    const status = child.status;
    return (
      <path
        d={d}
        fill="none"
        strokeWidth={on ? 2 : 1.5}
        strokeLinecap="round"
        opacity={opacity}
        className={clsx(
          'transition-[stroke] duration-(--motion-fast)',
          child.kind === 'addPromise'
            ? 'stroke-line'
            : status === 'failed'
              ? 'stroke-danger'
              : status === 'blocked'
                ? 'stroke-attention'
                : on || status === 'checking'
                  ? 'stroke-interactive'
                  : status === 'passed'
                    ? 'stroke-fg-faint'
                    : 'stroke-line',
          (child.kind === 'addPromise' || status === 'unconfirmed' || status === 'planned' || status === 'blocked') &&
            '[stroke-dasharray:4_5]',
          status === 'checking' && 'motion-flow [stroke-dasharray:6_6]',
        )}
      />
    );
  }
  const x1 = parent.x + parent.w;
  const y1 = parent.y + parent.h / 2;
  const x2 = child.x;
  const y2 = child.y + child.h / 2;
  const mid = (x1 + x2) / 2;
  const d =
    Math.abs(y1 - y2) < 0.5 ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} C ${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
  const ghost = child.kind === 'addJourney' || child.kind === 'addPerson';
  return (
    <path
      d={d}
      fill="none"
      strokeWidth={on ? 2.5 : child.kind === 'step' ? 2 : 1.5}
      strokeLinecap="round"
      opacity={opacity}
      className={clsx(
        'transition-[stroke] duration-(--motion-fast)',
        on ? 'stroke-interactive' : ghost ? 'stroke-line' : 'stroke-fg-faint',
        ghost && '[stroke-dasharray:4_5]',
        !on && !ghost && 'opacity-60',
      )}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Follows the laid-out nodes with motion: each frame every node moves a step toward its place. A new node starts at
 * its parent's current place, invisible; a node that left the layout goes back into its parent and fades, then is
 * dropped. A change in the middle of a motion starts from wherever things are.
 */
function useTweenedNodes(target: LaidNode[]): ShownNode[] {
  const [shown, setShown] = useState<ShownNode[]>(() =>
    target.map((node) => ({ ...node, opacity: 1, leaving: false })),
  );
  const current = useRef(shown);
  useLayoutEffect(() => {
    current.current = shown;
  }, [shown]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    const now = new Map(current.current.map((node) => [node.id, node]));
    const wanted = new Map(target.map((node) => [node.id, node]));
    const originOf = (node: LaidNode): { x: number; y: number } => {
      let parent = node.parent;
      while (parent) {
        const shownParent = now.get(parent);
        if (shownParent) return { x: shownParent.x, y: shownParent.y };
        parent = wanted.get(parent)?.parent ?? null;
      }
      return { x: node.x, y: node.y };
    };
    const tracks = [
      ...target.map((node) => {
        const from = now.get(node.id) ?? { ...node, ...originOf(node), opacity: 0 };
        return {
          node,
          from: { x: from.x, y: from.y, opacity: now.has(node.id) ? from.opacity : 0 },
          to: { x: node.x, y: node.y, opacity: 1 },
          leaving: false,
        };
      }),
      ...[...now.values()]
        .filter((node) => !wanted.has(node.id))
        .map((node) => {
          const parent = node.parent ? (wanted.get(node.parent) ?? now.get(node.parent)) : undefined;
          return {
            node: node as LaidNode,
            from: { x: node.x, y: node.y, opacity: node.opacity },
            to: { x: parent?.x ?? node.x, y: parent?.y ?? node.y, opacity: 0 },
            leaving: true,
          };
        }),
    ];
    if (reducedMotion()) {
      frame.current = requestAnimationFrame(() =>
        setShown(target.map((node) => ({ ...node, opacity: 1, leaving: false }))),
      );
      return;
    }
    const start = performance.now();
    const tick = (time: number) => {
      const p = ease(Math.min(1, (time - start) / DURATION));
      const next = tracks
        .filter((track) => !(track.leaving && p >= 1))
        .map(({ node, from, to, leaving }) => ({
          ...node,
          x: from.x + (to.x - from.x) * p,
          y: from.y + (to.y - from.y) * p,
          opacity: from.opacity + (to.opacity - from.opacity) * (leaving ? Math.min(1, p * 1.6) : p),
          leaving,
        }));
      setShown(next);
      frame.current = p < 1 ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target]);

  return shown;
}
