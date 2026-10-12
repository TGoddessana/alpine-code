import type { FlowGetResult, FlowNode, ProductFlow, SessionInfo } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode,
  Image,
  Maximize2,
  Minus,
  Plus,
  Workflow,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { CARD_HEIGHT, CARD_WIDTH, conditionResults, layoutFlow, nodeState } from './model';

const icons = { screen: Image, sdk: Code2, api: Code2, process: Workflow, data: FileCode };

export function FlowCanvas({
  board,
  sessions,
  selected,
  onSelect,
}: {
  board: FlowGetResult;
  sessions: SessionInfo[];
  selected: string | null;
  onSelect: (node: FlowNode, flow: ProductFlow) => void;
}) {
  const t = useMessages(messages);
  const marker = useId().replace(/:/g, '');
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const autoFit = useRef(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const document = board.document;
  const layouts = useMemo(() => {
    const flows = [...(document.flows ?? [])];
    const included = new Set(flows.flatMap((f) => f.nodeIds ?? []));
    const orphaned = (document.nodes ?? []).filter((n) => !included.has(n.id));
    if (orphaned.length) flows.push({ id: '__unassigned', title: t.noFlow, nodeIds: orphaned.map((n) => n.id) });
    let top = 26;
    return flows.map((flow) => {
      const graph = layoutFlow(flow, document);
      const height = collapsed.has(flow.id) ? 62 : graph.height + 54;
      const item = { flow, graph, top, height };
      top += height + 32;
      return item;
    });
  }, [document, collapsed, t.noFlow]);
  const width = Math.max(800, ...layouts.map((l) => l.graph.width + 64));
  const height = Math.max(500, ...layouts.map((l) => l.top + l.height + 32));
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (autoFit.current)
        setZoom(Math.max(0.3, Math.min(1, (el.clientWidth - 20) / width, (el.clientHeight - 60) / height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, height]);
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="relative min-h-0 min-w-0 grow">
      <div
        ref={viewport}
        className="h-full overflow-auto bg-canvas-sunken"
        aria-label={t.all}
        style={{
          backgroundImage: 'radial-gradient(var(--color-line) 1px, transparent 1px)',
          backgroundSize: '20px 20px',
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
          const el = event.currentTarget;
          drag.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop };
          el.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
          event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div className="relative origin-top-left" style={{ width, height, transform: `scale(${zoom})` }}>
            {layouts.map(({ flow, graph, top, height: frameHeight }) => {
              const nodes = graph.nodes.map((p) => p.node);
              const issues = nodes.filter((n) => nodeState(n, sessions) === 'issue').length;
              const working = nodes.filter((n) => nodeState(n, sessions) === 'working').length;
              const closed = collapsed.has(flow.id);
              return (
                <section
                  key={flow.id}
                  aria-label={flow.title}
                  className="absolute rounded-xl border border-line bg-canvas/80"
                  style={{ left: 26, top, width: graph.width, height: frameHeight }}
                >
                  <header className="flex h-14 items-center gap-3 px-5">
                    <button
                      className="flex min-w-0 cursor-pointer items-center gap-2 text-title font-semibold"
                      onClick={() => toggle(flow.id)}
                      aria-expanded={!closed}
                    >
                      {closed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                      {flow.title}
                    </button>
                    <span className="text-meta text-fg-muted">{t.features(nodes.length)}</span>
                    {issues > 0 && (
                      <span className="rounded-md bg-diff-removed px-2 py-0.5 text-meta text-danger">
                        {t.issueCount(issues)}
                      </span>
                    )}
                    {working > 0 && <span className="text-meta text-interactive">{t.workingCount(working)}</span>}
                  </header>
                  {!closed && (
                    <div className="relative" style={{ height: graph.height }}>
                      <svg
                        className="absolute inset-0"
                        width={graph.width}
                        height={graph.height}
                        aria-label={flow.title}
                      >
                        <defs>
                          <marker
                            id={`${marker}-${flow.id}`}
                            markerWidth="8"
                            markerHeight="8"
                            refX="7"
                            refY="4"
                            orient="auto"
                          >
                            <path d="M 0 0 L 8 4 L 0 8" fill="var(--color-fg-faint)" />
                          </marker>
                        </defs>
                        {graph.edges.map((edge) => (
                          <g key={`${edge.source}-${edge.target}`}>
                            <path
                              d={edge.path}
                              fill="none"
                              stroke="var(--color-fg-faint)"
                              strokeWidth="1.5"
                              strokeDasharray={edge.planned ? '6 5' : undefined}
                              markerEnd={`url(#${marker}-${flow.id})`}
                            />
                            {edge.label && (
                              <text
                                x={edge.x}
                                y={edge.y}
                                textAnchor="middle"
                                fill="var(--color-fg-muted)"
                                className="text-meta"
                              >
                                {edge.label}
                              </text>
                            )}
                          </g>
                        ))}
                      </svg>
                      {graph.nodes.map(({ node, x, y }) => {
                        const state = nodeState(node, sessions);
                        const results = conditionResults(node, board.staleConditions?.[node.id]);
                        const attention = results.find((item) => item.status === 'failed' || item.status === 'recheck');
                        const Icon = icons[node.kind ?? 'process'];
                        const shared = (document.flows ?? []).filter((f) => f.nodeIds?.includes(node.id)).length;
                        return (
                          <button
                            key={node.id}
                            onClick={() => onSelect(node, flow)}
                            aria-pressed={selected === node.id}
                            className={clsx(
                              'absolute flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-canvas-raised text-left shadow-overlay transition-shadow hover:ring-2 hover:ring-line',
                              node.phase === 'planned' && 'border-dashed',
                              state === 'issue' ? 'border-danger' : 'border-line',
                              selected === node.id && 'ring-2 ring-interactive',
                            )}
                            style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                          >
                            <div className="flex items-center gap-1.5 px-3 pt-2 text-meta text-fg-muted">
                              <Icon size={13} />
                              {t[node.kind ?? 'process']}
                              {shared > 1 && (
                                <span className="ml-auto" title={t.shared(shared)}>
                                  <ArrowUpRight size={13} />
                                </span>
                              )}
                            </div>
                            <div className="flex min-h-0 grow flex-col justify-center overflow-hidden px-3 py-2">
                              {board.previews?.[node.id] ? (
                                <img
                                  src={board.previews[node.id]}
                                  alt={node.title}
                                  className="h-full w-full rounded-md object-cover object-top"
                                />
                              ) : node.example ? (
                                <pre className="line-clamp-4 font-mono text-meta whitespace-pre-wrap text-fg-muted">
                                  {node.example}
                                </pre>
                              ) : (
                                <div className="flex h-full flex-col justify-center gap-2 rounded-md bg-canvas-sunken p-3">
                                  <Icon size={22} strokeWidth={1.2} className="text-fg-faint" />
                                  <p className="line-clamp-2 text-meta text-fg-muted">
                                    {node.description || (node.phase === 'planned' ? t.plannedPreview : t.noPreview)}
                                  </p>
                                </div>
                              )}
                            </div>
                            <div className="border-t border-line-subtle px-3 py-2">
                              <div className="truncate text-body font-medium">{node.title}</div>
                              <div
                                className={clsx(
                                  'text-meta',
                                  state === 'issue'
                                    ? 'text-danger'
                                    : state === 'working'
                                      ? 'text-interactive'
                                      : 'text-fg-muted',
                                )}
                              >
                                {t[state]}
                              </div>
                              <div className="truncate text-meta text-fg-muted">
                                {results.length
                                  ? t.coverage(
                                      results.filter((item) => item.status === 'passed').length,
                                      results.length,
                                    )
                                  : t.noPromises}
                              </div>
                              {attention && (
                                <div
                                  className="truncate text-meta text-attention"
                                  title={attention.condition.expectation}
                                >
                                  {attention.status === 'failed' ? t.conditionFailed : t.recheck} ·{' '}
                                  {attention.condition.expectation}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-line bg-canvas-raised p-1 shadow-overlay">
        <Button
          aria-label={t.zoomOut}
          onClick={() => {
            autoFit.current = false;
            setZoom((z) => Math.max(0.3, z - 0.1));
          }}
        >
          <Minus size={14} />
        </Button>
        <span className="min-w-11 text-center text-meta tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button
          aria-label={t.zoomIn}
          onClick={() => {
            autoFit.current = false;
            setZoom((z) => Math.min(1.5, z + 0.1));
          }}
        >
          <Plus size={14} />
        </Button>
        <Button
          onClick={() => {
            const el = viewport.current;
            if (el) {
              autoFit.current = true;
              setZoom(Math.max(0.3, Math.min(1, (el.clientWidth - 20) / width, (el.clientHeight - 60) / height)));
              el.scrollTo({ left: 0, top: 0 });
            }
          }}
        >
          <Maximize2 size={14} />
          {t.fit}
        </Button>
      </div>
    </div>
  );
}
