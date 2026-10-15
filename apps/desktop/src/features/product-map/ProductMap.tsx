import type { FlowNode, FlowPrepareParams, FlowPrepareResult, ProductFlow } from '@alpine/protocol';
import { Button, LinkButton } from '@alpine/ui/primitives';
import { GitBranchPlus, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';

import { useMessages } from '@/shared/i18n';
import {
  ServerError,
  useFlowNode,
  useNewSession,
  usePrepareFlow,
  useProductMap,
  useReviewFlow,
  useSendMessage,
  useSession,
  useSessions,
  useSetSchedule,
} from '@/shared/server';

import { Changes, newChanges, useLastSeen } from './Changes';
import { Coverage } from './Coverage';
import { FilterMenu, ActiveFilters, type Filters } from './FilterMenu';
import { focusItems, recheckIds, useFocusReasons } from './Focus';
import { FlowCanvas } from './FlowCanvas';
import { FlowList } from './FlowList';
import { Inspector } from './Inspector';
import { DeleteMap, MapMenu, ScopeEditor } from './MapSettings';
import { promiseCounts, Summary } from './Summary';
import { messages } from './messages';
import { isWorking, mapOf, matchingIds, numbers, searchOrder, summary, verification } from './model';

type Action = FlowPrepareParams['action'];
type Form = 'flow' | 'extend' | 'change' | 'define' | 'reshape';
/** Overrides for a start that is not about the selected feature, e.g. checking a whole flow or a card's feature. */
interface Target {
  node?: FlowNode | null;
  flowId?: string | null;
  /** Several features at once (a batch of rechecks). */
  nodeIds?: string[];
  request?: string;
}
/**
 * The map is only readable above about this width (a list row with its status and a screen card need it), so a side
 * panel (384px) stays a column only while the map keeps this much beside it.
 */
const MIN_MAP_WIDTH = 560;
const PANEL_WIDTH = 384;
const DAY = 86_400_000;
const SIDE_KEY = 'alpine.product-map.side';
/** Whether the daily check has not run for a day (or ever). */
const due = (lastRun?: string | null) => {
  const at = lastRun ? Date.parse(lastRun) : 0;
  return Number.isNaN(at) || Date.now() - at >= DAY;
};
const formAction: Record<Form, Action> = {
  flow: 'extend',
  extend: 'extend',
  change: 'change',
  define: 'change',
  reshape: 'reshape',
};

export function ProductMap({
  cwd,
  sessionId = null,
  onSession,
  onShowConversation,
  demo = false,
  dockOpen = false,
  hidden = false,
}: {
  cwd: string;
  sessionId?: string | null;
  onSession: (id: string) => void;
  /** Shows the attached session's conversation (the page keeps it in the dock). */
  onShowConversation?: () => void;
  demo?: boolean;
  /** Whether the right dock sits beside the map; when it does and the window is narrow, side panels overlay it. */
  dockOpen?: boolean;
  /** The map is covered by the dock enlarged ("크게 보기"): its keys (`/`, Escape) must not act on it. */
  hidden?: boolean;
}) {
  const t = useMessages(messages);
  const board = useProductMap(cwd);
  const sessions = useSessions().data ?? [];
  const live = useSession(sessionId);
  const create = useNewSession();
  const prepare = usePrepareFlow();
  const send = useSendMessage();
  const schedule = useSetSchedule();
  const review = useReviewFlow();
  const [query, setQuery] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The left panel (summary, what to look at, search) folds away so the flows get the whole screen; remembered.
  const [sideOpen, setSideOpen] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggleSide = (open: boolean) => {
    setSideOpen(open);
    try {
      localStorage.setItem(SIDE_KEY, open ? 'open' : 'closed');
    } catch {
      // Private windows may refuse storage; the panel still toggles for this visit.
    }
  };
  // Search results are cycled with Enter / "다음"; `reveal` tells the canvas which card to centre.
  const [reveal, setReveal] = useState<{ node: string; flow: string; seq: number } | null>(null);
  const hit = useRef(-1);
  const search = useRef<HTMLInputElement>(null);
  // A flow picked from the flow list: the canvas scrolls to it and dims every card outside it. One focus at a time.
  const [focusFlow, setFocusFlow] = useState<string | null>(null);
  const [revealFlow, setRevealFlow] = useState<{ flow: string; seq: number } | null>(null);
  const [seenAt, markSeen] = useLastSeen(cwd);
  const [viewedSince, setViewedSince] = useState(seenAt);
  const [nudge, setNudge] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ status: null, must: false, now: false });
  const [selection, setSelection] = useState<{ node: string; flow: string | null } | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<'feature' | 'changes'>('feature');
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  // The width of the map's own area (this page without the dock), to decide whether a side panel overlays the dock.
  const area = useRef<HTMLElement>(null);
  const [areaWidth, setAreaWidth] = useState(Infinity);
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => entry && setAreaWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The action behind the live session: only runs that change the product suggest a re-check afterwards.
  const lastRun = useRef<{ session: string; action: Action } | null>(null);
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null);
  const [retry, setRetry] = useState<{ action: Action; target?: Target } | null>(null);
  // A failed send retries exactly the prepared prompt and branch, rather than creating duplicate work.
  const attempt = useRef<{ key: string; session: string; prepared?: FlowPrepareResult } | null>(null);
  const data = board.data;
  const document = data && mapOf(data);
  const node = document?.nodes?.find((n) => n.id === selection?.node);
  const memberOf = document?.flows?.filter((f) => f.nodeIds?.includes(node?.id ?? '')) ?? [];
  const flowId = selection?.flow && selection.flow !== '__unassigned' ? selection.flow : (memberOf[0]?.id ?? null);
  const selectedSession = sessions.find((s) => s.id === node?.sessionId);
  const nodeRunning = selectedSession?.status === 'running' || selectedSession?.status === 'waiting';
  const active = live.data?.info.status === 'running' || live.data?.info.status === 'waiting';
  // Any session of this project that is working, not only the one shown.
  const anyActive = active || sessions.some((s) => s.cwd === cwd && (s.status === 'running' || s.status === 'waiting'));
  const reasons: Record<string, string> = {
    flow_conflict: t.conflict,
    map_read_only: t.readOnlyBanner,
    invalid_flow: t.invalidFlow,
    replay_changed: t.replayChanged,
    reason_required: t.reasonRequired,
    flow_busy: t.busyEdit,
  };
  const readOnly = !!data?.readOnly;
  const nodeImages = useFlowNode(cwd, node?.id ?? null, data?.revision);
  const totals = document && summary(document, data?.states, sessions);
  const numbered = document ? numbers(document) : new Map<string, string>();
  const hasMap = !!(document?.nodes?.length || document?.flows?.length);

  // The conversation lives in the dock, and nothing else on the map says the agent stopped to ask: a session that
  // starts waiting for my go-ahead opens the dock on it, once per wait.
  const status = live.data?.info.status;
  const asked = useRef(false);
  const showAsk = useEffectEvent(() => onShowConversation?.());
  useEffect(() => {
    if (status === 'waiting' && !asked.current) showAsk();
    asked.current = status === 'waiting';
  }, [status]);

  const flowsOf = (id: string) => document?.flows?.filter((f) => f.nodeIds?.includes(id)) ?? [];
  const unseen = newChanges(data?.changes, seenAt).length;

  const start = async (action: Action, target?: Target) => {
    // A run already going in this project owns the work; only a retry of a start already under way may go on.
    if (!data || board.isError || lock.current || data.readOnly || (anyActive && !attempt.current)) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setRetry({ action, target });
    setConfirmRebuild(false);
    const subject = target && 'node' in target ? (target.node ?? null) : (node ?? null);
    const subjectFlow = target && 'flowId' in target ? (target.flowId ?? null) : flowId;
    const key = JSON.stringify([
      cwd,
      action,
      selection,
      text,
      target?.node?.id,
      target?.flowId,
      target?.nodeIds,
      target?.request,
    ]);
    try {
      if (attempt.current?.key !== key) {
        const info = await create.mutateAsync({ cwd });
        attempt.current = { key, session: info.id };
      }
      const current = attempt.current;
      if (!current.prepared) {
        current.prepared = await prepare.mutateAsync({
          cwd,
          revision: data.revision,
          action,
          request:
            (target?.request ?? (target ? '' : text)) ||
            (action === 'discover' ? t.discoveryRequest : t.checkRequest(subject?.title ?? '')),
          nodeId: action === 'discover' ? null : (subject?.id ?? null),
          flowId: action === 'discover' ? null : subjectFlow,
          ...(target?.nodeIds ? { nodeIds: target.nodeIds.slice(0, 500) } : {}),
          sessionId: current.session,
        });
      }
      await send.mutateAsync({ sessionId: current.session, text: current.prepared.prompt });
      if (current.prepared.nodeId) {
        const flow = mapOf(current.prepared.board).flows?.find((f) => f.nodeIds?.includes(current.prepared!.nodeId!));
        setSelection({ node: current.prepared.nodeId, flow: flow?.id ?? null });
      }
      lastRun.current = { session: current.session, action };
      onSession(current.session);
      onShowConversation?.();
      attempt.current = null;
      setForm(null);
      setText('');
      setRetry(null);
      return true;
    } catch (error) {
      const known = error instanceof ServerError ? reasons[String(error.data?.reason)] : undefined;
      setError({
        text: known ?? t.failedStart,
        detail: error instanceof Error ? error.message : undefined,
      });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reset = () => {
    setForm(null);
    setText('');
    setError(null);
    setRetry(null);
  };
  const select = (node: FlowNode, flow?: ProductFlow) => {
    if (busy) return;
    setSelection({ node: node.id, flow: flow?.id ?? null });
    setPanel('feature');
    reset();
  };
  const close = () => {
    setSelection(null);
    reset();
  };
  const result = node && verification(node, data?.states?.[node.id]);

  const verifyFlow = (flow: ProductFlow) =>
    void start('verify', { node: null, flowId: flow.id, request: t.flowVerifyRequest(flow.title) });
  const syncMap = () => void start('sync', { node: null, flowId: null, request: t.syncRequest });
  const recheck = useMemo(() => (data ? recheckIds(data) : []), [data]);
  // Promises the user rewrote that nothing has checked since: one run checks them all (decision 16).
  const edited = useMemo(() => {
    const found: { nodeId: string; count: number }[] = [];
    for (const [nodeId, state] of Object.entries(data?.states ?? {})) {
      const count = Object.values(state.promises ?? {}).filter(
        (p) => p.written && (p.status === 'recheck' || p.status === 'unconfirmed'),
      ).length;
      if (count) found.push({ nodeId, count });
    }
    return found;
  }, [data]);
  const editedCount = edited.reduce((sum, item) => sum + item.count, 0);
  const checkEdited = () =>
    void start('verify', {
      node: null,
      flowId: null,
      nodeIds: edited.map((item) => item.nodeId),
      request: t.editedVerifyRequest,
    });
  const recheckAll = () =>
    void start('verify', { node: null, flowId: null, nodeIds: recheck, request: t.recheckAllRequest });
  const notARule = (target: FlowNode, conditionId: string) => {
    const rule = target.conditions?.find((c) => c.id === conditionId)?.expectation ?? '';
    setText(t.notRuleRequest(target.title, rule));
    setForm('change');
  };
  const openChanges = () => {
    if (panel === 'changes') return setPanel('feature');
    setViewedSince(seenAt);
    markSeen();
    close();
    setPanel('changes');
  };

  // A finished session that touched features suggests re-checking the flows they sit in.
  const wasActive = useRef(false);
  useEffect(() => {
    const action = lastRun.current?.session === sessionId ? lastRun.current.action : null;
    if (wasActive.current && !active && sessionId && (action === 'change' || action === 'extend')) setNudge(sessionId);
    wasActive.current = active;
  }, [active, sessionId]);
  const touched = nudge ? (document?.nodes ?? []).filter((n) => n.sessionId === nudge).map((n) => n.id) : [];
  const nudgeFlows = (document?.flows ?? []).filter((f) => f.nodeIds?.some((id) => touched.includes(id)));

  // Search and filters dim cards on the canvas; they never remove them, because a missing step would break its flow.
  const matched = useMemo(
    () =>
      data
        ? matchingIds(mapOf(data), data.states, {
            query,
            status: filters.status,
            mustOnly: filters.must,
            nowOnly: filters.now,
            tag: null,
          })
        : null,
    [data, query, filters],
  );
  const hits = useMemo(() => (data && matched ? searchOrder(mapOf(data), matched) : []), [data, matched]);
  // Whatever the search found (words, tags or promises) can be checked in one run.
  const verifyFound = () =>
    void start('verify', {
      node: null,
      flowId: null,
      nodeIds: [...new Set(hits.map((h) => h.nodeId))],
      request: t.verifyFoundRequest(query.trim()),
    });
  // What needs a look is shown per flow ("봐야 할 것 N" on its row) and, once a flow is picked, as a reason tag on
  // each of its cards that needs one.
  const allLooks = useMemo(() => (data ? focusItems(data) : []), [data]);
  const focusMembers = useMemo(
    () => (data && focusFlow ? (mapOf(data).flows?.find((f) => f.id === focusFlow)?.nodeIds ?? []) : null),
    [data, focusFlow],
  );
  const reasonOf = useFocusReasons();
  const lookTags = useMemo(
    () =>
      data && focusMembers
        ? new Map(
            allLooks
              .filter(({ nodeId }) => focusMembers.includes(nodeId))
              .map(({ kind, nodeId }) => [nodeId, reasonOf(data, kind, nodeId)]),
          )
        : null,
    [data, allLooks, focusMembers, reasonOf],
  );
  // A picked flow dims every card outside it, together with search and filters (a card must pass both).
  const shown = useMemo(
    () =>
      focusMembers
        ? matched
          ? new Set(focusMembers.filter((id) => matched.has(id)))
          : new Set(focusMembers)
        : matched,
    [matched, focusMembers],
  );
  const toggleFlow = (flowId: string) => {
    const next = focusFlow === flowId ? null : flowId;
    setFocusFlow(next);
    setReveal(null);
    if (next) setRevealFlow({ flow: next, seq: Date.now() });
  };
  const nextHit = () => {
    if (!hits.length) return;
    hit.current = (hit.current + 1) % hits.length;
    const target = hits[hit.current]!;
    setReveal({ node: target.nodeId, flow: target.flowId, seq: Date.now() + hit.current });
  };

  const closePanel = () => {
    if (panel === 'changes') setPanel('feature');
    close();
  };
  // The optional daily check starts one batch while the map is open, and notes that it ran only when it started.
  const scheduled = useRef<string | null>(null);
  useEffect(() => {
    const plan = data?.schedule;
    if (!data || !plan?.enabled || data.readOnly || busy || anyActive || board.isError) return;
    // Only a map just fetched from the server says when the check last ran, and an open draft is never interrupted.
    if (!board.isFetchedAfterMount || board.isFetching || form || text) return;
    if (scheduled.current === cwd || !due(plan.lastRun)) return;
    const ids = recheckIds(data).slice(0, plan.limit ?? 20);
    if (!ids.length) return;
    // Once per open map, win or lose. Claiming the day comes first: the server refuses when another window already did.
    scheduled.current = cwd;
    schedule.mutate(
      { cwd, enabled: true, limit: plan.limit ?? 20, ran: true },
      {
        onSuccess: () => void start('verify', { node: null, flowId: null, nodeIds: ids, request: t.scheduledRequest }),
      },
    );
  });
  useEffect(() => {
    const editable = (el: Element | null) =>
      !!el && (el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable);
    const onKey = (event: KeyboardEvent) => {
      if (hidden || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '/' && !editable(globalThis.document.activeElement) && search.current) {
        event.preventDefault();
        search.current.focus();
      } else if (event.key === 'Escape' && !editable(globalThis.document.activeElement) && !busy) {
        if (panel === 'changes' || node || form) closePanel();
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  });

  // With the dock beside it, the map keeps MIN_MAP_WIDTH and the panel is laid over the dock rather than squeezing the
  // map into a third column. Measured on the map's own area, so it follows the window and the dock's width alike.
  const overlay = dockOpen && areaWidth < MIN_MAP_WIDTH + PANEL_WIDTH;

  return (
    <main ref={area} className="flex min-h-0 min-w-0 grow flex-col bg-canvas contain-inline-size" aria-label={t.title}>
      {!hasMap && (
        <header className="flex min-h-14 shrink-0 items-center border-b border-line px-5 py-2">
          <div>
            <h1 className="text-title font-semibold">{t.title}</h1>
            <p className="text-meta text-fg-muted">{demo ? t.demo : cwd.split('/').pop()}</p>
          </div>
        </header>
      )}
      {confirmRebuild && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas-sunken px-5 py-3 text-body">
          <span className="min-w-0 grow">{t.rediscoverConfirm}</span>
          <Button variant="primary" disabled={busy || active || readOnly} onClick={() => void start('discover')}>
            {busy ? t.starting : t.rediscoverStart}
          </Button>
          <Button onClick={() => setConfirmRebuild(false)}>{t.cancel}</Button>
        </div>
      )}
      {scopeOpen && hasMap && data && (
        <div className="flex items-start gap-3 border-b border-line bg-canvas-sunken px-5 py-3">
          <div className="min-w-0 grow">
            <ScopeEditor cwd={cwd} board={data} readOnly={readOnly} label={t.scopeTitle} />
          </div>
          <Button onClick={() => setScopeOpen(false)}>{t.close}</Button>
        </div>
      )}
      {deleting && <DeleteMap cwd={cwd} onClose={() => setDeleting(false)} />}
      {readOnly && (
        <p role="status" className="border-b border-line bg-canvas-sunken px-5 py-2 text-body">
          {t.readOnlyBanner}
        </p>
      )}
      {!!data?.problems?.length && (
        <details className="border-b border-line bg-canvas-sunken px-5 py-2 text-body">
          <summary className="cursor-pointer">{t.problemsBanner(data.problems.length)}</summary>
          <ul className="mt-2 flex flex-col gap-1 text-meta text-fg-muted" aria-label={t.problemsDetail}>
            {data.problems.map((problem) => (
              <li key={`${problem.file}-${problem.message}`}>
                {t.problemLine} <span className="font-mono break-all">{problem.file}</span>
                <details className="text-fg-faint">
                  <summary className="cursor-pointer">{t.technicalInfo}</summary>
                  {problem.message}
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
      {nudge && nudgeFlows.length > 0 && !active && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas-sunken px-5 py-2 text-body">
          <span className="min-w-0 grow">{t.nudge(nudgeFlows.length)}</span>
          <Button
            variant="primary"
            disabled={busy}
            onClick={() => {
              setNudge(null);
              verifyFlow(nudgeFlows[0]!);
            }}
          >
            {t.nudgeAction(nudgeFlows[0]!.title)}
          </Button>
          <Button onClick={() => setNudge(null)}>{t.nudgeDismiss}</Button>
        </div>
      )}
      {data?.review && (
        <div
          data-review
          className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas-sunken px-5 py-3 text-body"
        >
          <div className="min-w-0 grow">
            <p className="font-medium">{t.reviewTitle}</p>
            {!!data.review.added?.length && (
              <p className="text-meta text-fg-muted">{t.reviewAdded(data.review.added.join(', '))}</p>
            )}
            {!!data.review.removed?.length && (
              <p className="text-meta text-fg-muted">{t.reviewRemoved(data.review.removed.join(', '))}</p>
            )}
            {!!data.review.changed?.length && (
              <p className="text-meta text-fg-muted">{t.reviewChanged(data.review.changed.join(', '))}</p>
            )}
            {review.isError && (
              <p role="alert" className="text-meta text-danger">
                {review.error instanceof ServerError && review.error.data?.reason === 'flow_busy'
                  ? t.busyEdit
                  : t.editFailed}
              </p>
            )}
          </div>
          <Button
            variant="primary"
            disabled={review.isPending || anyActive || readOnly}
            onClick={() => review.mutate({ cwd, target: 'map', action: 'accept' })}
          >
            {t.acceptChange}
          </Button>
          <Button
            disabled={review.isPending || anyActive || readOnly}
            onClick={() => review.mutate({ cwd, target: 'map', action: 'restore' })}
          >
            {t.reviewRestore}
          </Button>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b border-line bg-diff-removed px-5 py-3 text-body text-danger"
        >
          <span className="min-w-0 grow break-words">
            {error.text}
            {error.detail && error.detail !== error.text && (
              <details className="mt-1 text-meta text-fg-muted">
                <summary className="cursor-pointer">{t.technicalInfo}</summary>
                <span className="break-words">{error.detail}</span>
              </details>
            )}
          </span>
          {retry && (
            <Button disabled={busy} onClick={() => void start(retry.action, retry.target)}>
              {t.retry}
            </Button>
          )}
        </div>
      )}
      {board.isError && data && (
        <p role="alert" className="border-b border-line bg-diff-removed px-5 py-2 text-meta text-danger">
          {t.loadFailed}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 grow">
        {hasMap && totals && document && data && sideOpen && (
          <section
            aria-label={t.mapPanel}
            className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line px-4 pt-3 pb-4"
          >
            <div className="flex items-start gap-1">
              <div className="mr-auto min-w-0">
                <h1 className="text-title font-semibold">{t.title}</h1>
                <p className="truncate text-meta text-fg-muted">{demo ? t.demo : cwd.split('/').pop()}</p>
              </div>
              <MapMenu
                cwd={cwd}
                board={data}
                readOnly={readOnly}
                unseen={unseen}
                canStart={!(busy || active || board.isError || readOnly)}
                onChanges={data.changes?.length ? openChanges : undefined}
                onRediscover={() => setConfirmRebuild(true)}
                onAdd={() => {
                  close();
                  setPanel('feature');
                  setForm('flow');
                }}
                onScope={() => setScopeOpen(true)}
                onDelete={() => setDeleting(true)}
                recheck={recheck.length}
                onRecheck={recheckAll}
              />
              <button
                type="button"
                aria-label={t.hidePanel}
                onClick={() => toggleSide(false)}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover"
              >
                <PanelLeftClose size={17} aria-hidden />
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1">
                <label className="relative flex min-w-0 grow items-center">
                  <span className="sr-only">{t.searchLabel}</span>
                  <Search size={13} className="pointer-events-none absolute left-2 text-fg-faint" />
                  <input
                    ref={search}
                    type="search"
                    value={query}
                    placeholder={t.searchPlaceholder}
                    onChange={(event) => {
                      hit.current = -1;
                      setReveal(null);
                      setQuery(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        hit.current = -1;
                        setReveal(null);
                        setQuery('');
                      } else if (event.key === 'Enter' && query.trim()) {
                        event.preventDefault();
                        nextHit();
                      }
                    }}
                    className="w-full min-w-0 rounded-md border border-line bg-canvas py-1 pr-2 pl-7 text-body"
                  />
                </label>
                <FilterMenu filters={filters} counts={totals.counts} onChange={setFilters} />
              </div>
              {query.trim() && (
                <span className="flex items-center gap-1.5 px-2 text-meta text-fg-muted">
                  <span className="tabular-nums">{t.found(hits.length)}</span>
                  {hits.length > 1 && (
                    <LinkButton aria-label={t.nextMatch} onClick={nextHit}>
                      {t.nextMatchShort}
                    </LinkButton>
                  )}
                  {hits.length > 0 && (
                    <LinkButton disabled={busy || anyActive || readOnly} onClick={verifyFound} className="ml-auto">
                      {t.verifyFound}
                    </LinkButton>
                  )}
                </span>
              )}
              <ActiveFilters filters={filters} onChange={setFilters} />
            </div>
            <Summary counts={promiseCounts(document, data?.states)} features={totals.features} />
            {editedCount > 0 && (
              <p data-edited className="flex items-center gap-2 text-body">
                <span className="min-w-0 grow">{t.editedPromises(editedCount)}</span>
                <LinkButton disabled={busy || anyActive || readOnly} onClick={checkEdited}>
                  {t.editedCheck}
                </LinkButton>
              </p>
            )}
            {!!data.removedCards?.length && (
              <section aria-label={t.removedCards} className="flex flex-col gap-1.5">
                <h2 className="text-meta font-semibold text-attention">{t.removedCards}</h2>
                <ul className="flex flex-col gap-1.5">
                  {data.removedCards.map((card) => (
                    <li key={card.id} className="flex flex-wrap items-center gap-x-2 text-body">
                      <span className="min-w-0 grow">{card.title}</span>
                      <LinkButton
                        disabled={review.isPending || anyActive || readOnly}
                        onClick={() => review.mutate({ cwd, target: 'card', action: 'accept', nodeId: card.id })}
                      >
                        {t.acceptChange}
                      </LinkButton>
                      <LinkButton
                        disabled={review.isPending || anyActive || readOnly}
                        onClick={() => review.mutate({ cwd, target: 'card', action: 'restore', nodeId: card.id })}
                      >
                        {t.restoreMine}
                      </LinkButton>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <FlowList
              flows={document.flows ?? []}
              looks={allLooks}
              active={focusFlow}
              onToggle={toggleFlow}
              extra={
                // Only a row that renders: an element that draws nothing would still keep the list's border.
                !!data?.coverage?.git &&
                !!data.coverage.uncoveredCount && (
                  <Coverage
                    coverage={data.coverage}
                    exclude={data.exclude ?? []}
                    disabled={busy || active || readOnly}
                    onSync={syncMap}
                  />
                )
              }
            />
          </section>
        )}
        {board.isError && !data ? (
          <div className="flex grow flex-col items-center justify-center gap-3 p-8">
            <p role="alert" className="text-body text-danger">
              {t.loadFailed}
            </p>
            <Button onClick={() => void board.refetch()}>{t.retry}</Button>
          </div>
        ) : !data ? (
          <p className="p-8 text-body text-fg-muted">{t.loading}</p>
        ) : !hasMap ? (
          <div className="flex min-w-0 grow flex-col items-center justify-center gap-4 p-8 text-center">
            <GitBranchPlus size={42} strokeWidth={1} className="text-interactive" />
            <h2 className="text-display font-semibold">{t.empty}</h2>
            <p className="max-w-100 text-reading text-fg-muted">{t.emptyLead}</p>
            <ScopeEditor cwd={cwd} board={data} readOnly={readOnly} label={t.scopeBefore} />
            <Button variant="primary" disabled={busy || active || readOnly} onClick={() => void start('discover')}>
              <Search size={16} />
              {busy ? t.starting : t.discover}
            </Button>
          </div>
        ) : (
          <div className="relative flex min-h-0 min-w-0 grow flex-col">
            {!sideOpen && (
              <button
                type="button"
                aria-label={t.showPanel}
                onClick={() => toggleSide(true)}
                className="absolute top-3 left-3 z-10 flex size-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-canvas-raised text-fg-muted shadow-overlay hover:bg-hover"
              >
                <PanelLeftOpen size={17} aria-hidden />
              </button>
            )}
            <FlowCanvas
              board={data}
              sessions={sessions}
              selected={node?.id ?? null}
              selectedFlow={selection?.flow ?? null}
              numbered={numbered}
              matched={shown}
              tags={lookTags}
              reveal={reveal}
              revealFlow={revealFlow}
              onSelect={select}
              onVerifyFlow={readOnly ? undefined : verifyFlow}
              verifyDisabled={busy || anyActive}
            />
          </div>
        )}
        <div
          data-overlay={overlay || undefined}
          className={overlay ? 'absolute inset-y-0 right-0 z-20 flex bg-canvas shadow-overlay' : 'contents'}
        >
          {panel === 'changes' && data && (
            <Changes
              board={data}
              since={viewedSince}
              onSelect={(id) => {
                const target = document?.nodes?.find((n) => n.id === id);
                if (target) select(target, flowsOf(id)[0]);
              }}
              onClose={() => setPanel('feature')}
            />
          )}
          {panel === 'changes'
            ? null
            : (node || form === 'flow') &&
              data && (
                <Inspector
                  cwd={cwd}
                  board={data}
                  node={node}
                  number={node ? numbered.get(node.id) : undefined}
                  status={result?.status}
                  working={!!node && isWorking(node, sessions)}
                  flows={memberOf}
                  form={form}
                  text={text}
                  busy={busy}
                  running={nodeRunning}
                  hasSession={!!node?.sessionId}
                  readOnly={readOnly}
                  editLocked={anyActive}
                  images={nodeImages.data}
                  onText={(value) => {
                    setText(value);
                    setError(null);
                  }}
                  onForm={setForm}
                  onSubmit={() => form && void start(formAction[form])}
                  onCancelForm={() => (node ? reset() : close())}
                  onStart={(action) => void start(action)}
                  onConversation={() => {
                    if (node?.sessionId) onSession(node.sessionId);
                    onShowConversation?.();
                  }}
                  onOpenFlow={(flow) => {
                    if (!node) return;
                    setSelection({ node: node.id, flow: flow.id });
                  }}
                  onNotARule={notARule}
                  onClose={close}
                />
              )}
        </div>
      </div>
    </main>
  );
}
