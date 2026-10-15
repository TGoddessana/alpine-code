import type { FlowGetResult, FlowNode, ProductFlow, SessionInfo } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, ImageOff, Maximize2, Minus, Play, Plus, Workflow } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import {
  calledFlow,
  CARD_HEIGHT,
  CARD_WIDTH,
  captureState,
  isWorking,
  layoutFlow,
  mapOf,
  newestCheckAt,
  verification,
} from './model';
import { kindIcons, PhaseTag, VerificationIcon } from './status';

export function FlowCanvas({
  board,
  sessions,
  selected,
  selectedFlow = null,
  numbered,
  matched = null,
  reveal = null,
  revealFlow = null,
  tags = null,
  onSelect,
  onVerifyFlow,
  verifyDisabled = false,
}: {
  board: FlowGetResult;
  sessions: SessionInfo[];
  selected: string | null;
  /** The flow whose card was picked, so a feature shared by several flows centres on that one. */
  selectedFlow?: string | null;
  /** Card numbers in canvas order: flow by flow, then cards in no flow. */
  numbered: Map<string, string>;
  /** Features that pass the search and filters; every other card is dimmed (never removed). Null means no filter. */
  matched?: Set<string> | null;
  /** Asks the canvas to centre one card (search result or opened flow); `seq` makes repeated asks distinct. */
  reveal?: { node: string; flow: string; seq: number } | null;
  /** Asks the canvas to bring one whole flow into view (picked from the flow list); `seq` makes repeats distinct. */
  revealFlow?: { flow: string; seq: number } | null;
  /** Why a card is on the look-first list (short tag on the card, full reason as its title); null when that mode is off. */
  tags?: Map<string, { short: string; full: string }> | null;
  onSelect: (node: FlowNode, flow: ProductFlow) => void;
  onVerifyFlow?: (flow: ProductFlow) => void;
  /** A run is going on in this project, so starting another check waits. */
  verifyDisabled?: boolean;
}) {
  const t = useMessages(messages);
  const marker = useId().replace(/:/g, '');
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const document = mapOf(board);
  const [now] = useState(() => Date.now());
  const layouts = useMemo(() => {
    const flows = [...(document.flows ?? [])];
    const included = new Set(flows.flatMap((f) => f.nodeIds ?? []));
    const orphaned = (document.nodes ?? []).filter((n) => !included.has(n.id));
    if (orphaned.length) flows.push({ id: '__unassigned', title: t.noFlow, nodeIds: orphaned.map((n) => n.id) });
    // One header height for every flow, so titles and sentences line up even where a flow has no sentence.
    const header = flows.some((f) => f.description) ? 72 : 48;
    let top = 24;
    return flows.map((flow) => {
      const graph = layoutFlow(flow, document);
      const height = collapsed.has(flow.id) ? header + 4 : graph.height + header;
      const item = { flow, graph, top, height, header };
      top += height + 24;
      return item;
    });
  }, [document, collapsed, t.noFlow]);
  const occurrences = useMemo(
    () =>
      selected
        ? layouts.filter((l) => l.flow.id !== '__unassigned' && l.flow.nodeIds?.includes(selected)).map((l) => l.flow)
        : [],
    [layouts, selected],
  );
  const cycle = useRef(0);
  const open = (flowId: string) =>
    setCollapsed((c) => {
      if (!c.has(flowId)) return c;
      const next = new Set(c);
      next.delete(flowId);
      return next;
    });
  // Scrolls a card to the middle of the view unless it is already fully visible.
  const centre = (nodeId: string, flowId: string, force = false) =>
    requestAnimationFrame(() => {
      const view = viewport.current;
      const card = view?.querySelector(`[data-flow="${CSS.escape(flowId)}"] [data-node="${CSS.escape(nodeId)}"]`);
      if (!view || !card) return;
      const box = view.getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      const visible =
        rect.top >= box.top && rect.bottom <= box.bottom && rect.left >= box.left && rect.right <= box.right;
      if (force || !visible) card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    });
  // Selected feature follows you: centre the card in the flow that was picked, else in the first open flow holding it.
  useEffect(() => {
    cycle.current = 0;
    if (!selected) return;
    const holding = layouts.filter((l) => l.flow.nodeIds?.includes(selected));
    const asked = holding.find((l) => l.flow.id === selectedFlow);
    if (asked && collapsed.has(asked.flow.id)) {
      // An asked-for flow that is folded away opens first, so the card exists to be centred.
      const frame = requestAnimationFrame(() => {
        open(asked.flow.id);
        centre(selected, asked.flow.id, true);
      });
      return () => cancelAnimationFrame(frame);
    }
    const pick = asked ?? holding.find((l) => !collapsed.has(l.flow.id));
    if (!pick || collapsed.has(pick.flow.id)) return;
    const frame = centre(selected, pick.flow.id);
    return () => cancelAnimationFrame(frame);
  }, [selected, selectedFlow]); // eslint-disable-line react-hooks/exhaustive-deps
  // A search result is centred even when it is already visible, so the eye can follow the cycle.
  useEffect(() => {
    if (!reveal) return;
    const frame = requestAnimationFrame(() => {
      open(reveal.flow);
      centre(reveal.node, reveal.flow, true);
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  const nextOccurrence = () => {
    if (!selected || occurrences.length < 2) return;
    cycle.current = (cycle.current + 1) % occurrences.length;
    const flow = occurrences[cycle.current]!;
    open(flow.id);
    // Wait two frames so a flow that was just expanded has its cards in place.
    requestAnimationFrame(() => centre(selected, flow.id, true));
  };
  const goToFlow = (id: string) =>
    viewport.current
      ?.querySelector(`[data-flow="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'start' });
  // A flow picked from the list opens if folded and scrolls to its top-left corner.
  useEffect(() => {
    if (!revealFlow) return;
    const frame = requestAnimationFrame(() => {
      open(revealFlow.flow);
      requestAnimationFrame(() => goToFlow(revealFlow.flow));
    });
    return () => cancelAnimationFrame(frame);
  }, [revealFlow]);
  const width = Math.max(720, ...layouts.map((l) => l.graph.width + 48));
  const frame = width - 48; // every flow shares one width so the stack reads as one aligned map
  const height = Math.max(400, ...layouts.map((l) => l.top + l.height + 24));
  const fitZoom = (smallest: number) => {
    const el = viewport.current;
    if (el) setZoom(Math.max(smallest, Math.min(1, (el.clientWidth - 16) / width)));
  };
  // Fit when the map's content changes size, never when a side panel opens: the view must not jump on select.
  // Automatic fitting stops where card text stays readable; "Fit all" may shrink further for an overview.
  useEffect(() => fitZoom(0.7), [width]); // eslint-disable-line react-hooks/exhaustive-deps
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
        aria-label={t.flows}
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
            {layouts.map(({ flow, graph, top, height: frameHeight, header }) => {
              const nodes = graph.nodes.map((p) => p.node);
              const failed = nodes.filter((n) => verification(n, board.states?.[n.id]).status === 'failed').length;
              const closed = collapsed.has(flow.id);
              const noneMatch = !!matched && !nodes.some((n) => matched.has(n.id));
              return (
                <section
                  key={flow.id}
                  aria-label={flow.title}
                  data-flow={flow.id}
                  className="absolute rounded-xl border border-line bg-canvas/85"
                  style={{ left: 24, top, width: frame, height: frameHeight }}
                >
                  <header className="flex flex-col justify-center px-4" style={{ height: header }}>
                    <div className="flex items-center gap-3">
                      <button
                        className="flex min-w-0 cursor-pointer items-center gap-2 text-lead font-semibold"
                        onClick={() => toggle(flow.id)}
                        aria-expanded={!closed}
                      >
                        {closed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                        {flow.title}
                      </button>
                      <span className="text-meta text-fg-muted">{t.featureTotal(nodes.length)}</span>
                      {noneMatch && <span className="text-meta text-fg-faint">{t.noMatchInFlow}</span>}
                      {failed > 0 && (
                        <span className="inline-flex items-center gap-1 text-meta text-danger">
                          <VerificationIcon status="failed" size={12} />
                          {t.failed} {failed}
                        </span>
                      )}
                      {onVerifyFlow && flow.id !== '__unassigned' && (
                        <Button className="ml-auto" disabled={verifyDisabled} onClick={() => onVerifyFlow(flow)}>
                          {t.verifyFlow}
                        </Button>
                      )}
                    </div>
                    {flow.description && (
                      <p className="mt-1 truncate pl-6 text-body text-fg-muted" title={flow.description}>
                        {flow.description}
                      </p>
                    )}
                  </header>
                  {!closed && (
                    <div className="relative" style={{ height: graph.height }}>
                      <svg className="absolute inset-0" width={graph.width} height={graph.height} aria-hidden>
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
                        {graph.entries.map((path) => (
                          <path
                            key={path}
                            d={path}
                            fill="none"
                            stroke="var(--color-fg-faint)"
                            strokeWidth="1.5"
                            markerEnd={`url(#${marker}-${flow.id})`}
                          />
                        ))}
                        {graph.edges.map((edge, index) => (
                          // Two lines may join the same two cards (different labels), so the index keeps keys apart.
                          <g key={`${edge.source}-${edge.target}-${index}`}>
                            <path
                              d={edge.path}
                              fill="none"
                              stroke="var(--color-fg-faint)"
                              strokeWidth="1.5"
                              strokeDasharray={edge.planned ? '6 5' : undefined}
                              markerEnd={`url(#${marker}-${flow.id})`}
                            />
                          </g>
                        ))}
                      </svg>
                      {graph.edges.map(
                        (edge, index) =>
                          edge.label && (
                            <span
                              key={`${edge.source}-${edge.target}-${index}-label`}
                              className="pointer-events-none absolute flex items-center justify-center rounded-full border border-line bg-canvas px-2 text-meta whitespace-nowrap text-fg-muted"
                              style={{
                                left: edge.x - edge.w / 2,
                                top: edge.y - edge.h / 2,
                                width: edge.w,
                                height: edge.h,
                              }}
                            >
                              {edge.label}
                            </span>
                          ),
                      )}
                      {flow.id !== '__unassigned' && (
                        <div
                          className="absolute flex items-center gap-2 rounded-full border border-line bg-canvas-raised px-3 text-meta"
                          style={{
                            left: graph.start.x,
                            top: graph.start.y,
                            width: graph.start.width,
                            height: graph.start.height,
                          }}
                          title={flow.trigger || undefined}
                        >
                          <Play size={12} className="shrink-0 text-fg-muted" aria-hidden />
                          <span className="line-clamp-2">{flow.trigger || t.start}</span>
                        </div>
                      )}
                      {graph.nodes.map(({ node, x, y }) => {
                        if (node.call) {
                          // A step that calls another flow: one dashed box that takes you to that flow.
                          const called = node.call;
                          const count = (called.nodeIds ?? []).filter((id) => !calledFlow(id)).length;
                          return (
                            <button
                              key={node.id}
                              data-call={called.id}
                              onClick={() => {
                                open(called.id);
                                requestAnimationFrame(() => goToFlow(called.id));
                              }}
                              aria-label={t.calledFlowGo(called.title)}
                              title={called.description || called.title}
                              className="absolute flex cursor-pointer flex-col justify-center gap-1 rounded-lg border border-dashed border-interactive bg-canvas p-2 text-left transition hover:ring-2 hover:ring-line"
                              style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                            >
                              <span className="flex items-center gap-1 text-meta text-interactive">
                                <Workflow size={12} aria-hidden />
                                {t.calledFlow}
                              </span>
                              <span className="flex min-w-0 items-center gap-1 text-body font-medium">
                                <span className="truncate">{called.title}</span>
                                <ChevronRight size={14} className="shrink-0 text-fg-muted" aria-hidden />
                              </span>
                              <span className="text-meta text-fg-muted">{t.calledFlowCards(count)}</span>
                            </button>
                          );
                        }
                        const state = board.states?.[node.id];
                        const result = verification(node, state);
                        const Icon = kindIcons[node.kind ?? 'process'];
                        const shared = (document.flows ?? []).filter((f) => f.nodeIds?.includes(node.id)).length;
                        const dimmed = !!matched && !matched.has(node.id);
                        const tag = tags?.get(node.id);
                        const preview = board.previews?.[node.id];
                        const capture = captureState(node, now, newestCheckAt(state));
                        const age = capture
                          ? (capture.old ? `${t.captureOld} · ` : '') + t.captureAge(capture.days)
                          : undefined;
                        return (
                          <button
                            key={node.id}
                            data-node={node.id}
                            onClick={() => onSelect(node, flow)}
                            aria-pressed={selected === node.id}
                            aria-label={[
                              numbered.get(node.id),
                              node.title,
                              t[result.status],
                              state?.changed && t.changedBadge,
                              !!state?.missing?.length && t.missingBadge,
                              !!state?.unread?.length && t.unreadBadge,
                              ...(node.tags ?? []),
                              tag?.short,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            title={
                              (node.description ? `${node.title}\n${node.description}` : node.title) +
                              (tag ? `\n${tag.full}` : '')
                            }
                            className={clsx(
                              'absolute flex cursor-pointer flex-col gap-1 rounded-lg border bg-canvas-raised p-2 text-left shadow-overlay transition hover:ring-2 hover:ring-line',
                              node.phase === 'planned' && 'border-dashed',
                              result.status === 'failed'
                                ? 'border-danger'
                                : result.status === 'question'
                                  ? 'border-attention'
                                  : 'border-line',
                              reveal?.node === node.id && 'ring-2 ring-interactive/40',
                              selected === node.id && 'ring-2 ring-interactive',
                              dimmed && 'opacity-35',
                            )}
                            style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
                          >
                            {tag && (
                              <span
                                data-reason
                                title={tag.full}
                                className="absolute -top-2 right-2 max-w-[calc(100%-1rem)] truncate rounded-md border border-attention bg-canvas-raised px-1.5 text-meta font-medium text-attention"
                              >
                                {tag.short}
                              </span>
                            )}
                            <span className="flex min-w-0 shrink-0 items-center gap-1.5">
                              <span className="text-meta text-fg-muted tabular-nums">{numbered.get(node.id)}</span>
                              {/* The AI's tags, the first two: enough to place the card, the rest are in its panel. */}
                              {node.tags?.slice(0, 2).map((name) => (
                                <span
                                  key={name}
                                  className="min-w-0 truncate rounded-md border border-line-subtle px-1.5 text-meta text-fg-muted"
                                >
                                  {name}
                                </span>
                              ))}
                              <Icon
                                size={12}
                                className="ml-auto shrink-0 text-fg-muted"
                                aria-label={t[node.kind ?? 'process']}
                              />
                            </span>
                            <span className="shrink-0 truncate text-body font-medium">{node.title}</span>
                            <span className="flex min-w-0 shrink-0 items-center gap-2 text-meta text-fg-muted">
                              <VerificationIcon status={result.status} size={13} />
                              <span className="tabular-nums">
                                {result.total ? `${result.passed}/${result.total}` : t.none}
                              </span>
                              {state?.changed && (
                                <span
                                  data-badge="changed"
                                  className="min-w-0 truncate rounded-md border border-attention px-1 text-attention"
                                >
                                  {t.changedBadge}
                                </span>
                              )}
                              {!!state?.missing?.length && (
                                <span
                                  data-badge="missing"
                                  className="min-w-0 truncate rounded-md border border-danger px-1 text-danger"
                                >
                                  {t.missingBadge}
                                </span>
                              )}
                              {!!state?.unread?.length && !state?.missing?.length && (
                                <span
                                  data-badge="unread"
                                  title={t.unreadNote(state.unread.length)}
                                  className="min-w-0 truncate rounded-md border border-attention px-1 text-attention"
                                >
                                  {t.unreadBadge}
                                </span>
                              )}
                              {shared > 1 && <span title={t.shared(shared)}>{t.sharedFlows(shared)}</span>}
                              <span className="ml-auto">
                                <PhaseTag node={node} working={isWorking(node, sessions)} />
                              </span>
                            </span>
                            <span
                              className="relative flex min-h-0 grow overflow-hidden rounded-md bg-canvas-sunken"
                              title={age}
                            >
                              {node.kind === 'screen' ? (
                                preview ? (
                                  <>
                                    <img
                                      src={preview}
                                      alt=""
                                      draggable={false}
                                      className="h-full w-full object-cover object-top"
                                    />
                                    {capture?.old && (
                                      <span className="absolute bottom-0 left-0 rounded-tr-md bg-canvas/85 px-1.5 text-meta text-attention">
                                        {t.captureOld}
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span className="flex w-full items-center justify-center gap-1.5 text-meta text-fg-faint">
                                    <ImageOff size={14} aria-hidden />
                                    {t.noPicture}
                                  </span>
                                )
                              ) : (
                                <span className="line-clamp-2 px-2 py-1.5 text-meta text-fg-muted">
                                  {node.description}
                                </span>
                              )}
                            </span>
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
      {occurrences.length > 1 && (
        <div className="absolute top-4 right-4 flex items-center gap-2 rounded-xl border border-line bg-canvas-raised py-1 pr-1 pl-3 text-meta shadow-overlay">
          {t.inFlows(occurrences.length)}
          <Button onClick={nextOccurrence}>{t.nextFlow}</Button>
        </div>
      )}
      <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-xl border border-line bg-canvas-raised p-1 shadow-overlay">
        <Button aria-label={t.zoomOut} onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
          <Minus size={14} />
        </Button>
        <span className="min-w-11 text-center text-meta tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button aria-label={t.zoomIn} onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}>
          <Plus size={14} />
        </Button>
        <Button
          onClick={() => {
            fitZoom(0.4);
            viewport.current?.scrollTo({ left: 0, top: 0 });
          }}
        >
          <Maximize2 size={14} />
          {t.fit}
        </Button>
      </div>
    </div>
  );
}
