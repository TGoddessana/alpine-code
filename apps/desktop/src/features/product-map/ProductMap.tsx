import type { FlowNode, FlowPrepareParams, FlowPrepareResult } from '@alpine/protocol';
import { Button, LinkButton, Popover, SlidingPanel } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ChevronRight, CircleX, RotateCcw, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { AgentChip } from '@/shared/components/composer';
import { latestTaskForce } from '@/shared/components/taskforce';
import { useMessages } from '@/shared/i18n';
import {
  ServerError,
  useAgents,
  useCancelSession,
  useConnections,
  useNewSession,
  usePrepareFlow,
  useProductMap,
  useProjects,
  useReviewFlow,
  useSendMessage,
  useSession,
  useSessions,
  useSetSchedule,
  useSetSessionAgent,
  useTaskForceAction,
} from '@/shared/server';

import { CardAsk, HowToTry, PromiseMore, Title } from './CardExtras';
import { Changes, newChanges, useLastSeen } from './Changes';
import { REMOVED } from './Conditions';
import { Coverage } from './Coverage';
import { noticeRow, recheckIds } from './Focus';
import { changedCards } from './FlowTree';
import { toTreeMap } from './flowTreeData';
import { flowTreeMessages } from './flowTreeMessages';
import { JourneyMap } from './JourneyMap';
import { AskFlight, MapAsk, MapReplies } from './MapAsk';
import { DeleteMap, MapMenu, ScopeEditor } from './MapSettings';
import { Unmapped } from './Unmapped';
import { messages } from './messages';
import { mapOf, matchingIds, searchOrder } from './model';

type Action = FlowPrepareParams['action'];
/** Overrides for a start that is not about one card, e.g. checking several cards or a whole flow. */
interface Target {
  node?: FlowNode | null;
  flowId?: string | null;
  /** Several features at once (a batch of rechecks). */
  nodeIds?: string[];
  request?: string;
}
/** The changes list lies over the dock rather than squeezing the map below this width. */
const MIN_MAP_WIDTH = 560;
const PANEL_WIDTH = 384;
const DAY = 86_400_000;
const DRAWING_KEY = 'alpine.product-map.drawing';
/** Whether the daily check has not run for a day (or ever). */
const due = (lastRun?: string | null) => {
  const at = lastRun ? Date.parse(lastRun) : 0;
  return Number.isNaN(at) || Date.now() - at >= DAY;
};
type Lens = 'failed' | 'recheck' | 'changed' | null;

/**
 * A project's map: the people who use the product and the journeys they walk. One row above it searches the cards,
 * lights what broke, needs a recheck or changed, opens the change history and holds the map's menu; a second row
 * appears only when something wants a look (code not on the map, parts not drawn yet, promises I rewrote, cards the
 * AI removed). Asking the AI about a card happens in the card itself.
 */
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
  /** Whether the right dock sits beside the map; when it does and the window is narrow, the changes list overlays it. */
  dockOpen?: boolean;
  /** The map is covered by the dock enlarged ("크게 보기"): its keys (`/`, Escape) must not act on it. */
  hidden?: boolean;
}) {
  const t = useMessages(messages);
  const tree = useMessages(flowTreeMessages);
  const board = useProductMap(cwd);
  const sessions = useSessions().data;
  const live = useSession(sessionId);
  const create = useNewSession();
  const prepare = usePrepareFlow();
  const send = useSendMessage();
  const schedule = useSetSchedule();
  const review = useReviewFlow();
  const cancel = useCancelSession();
  const teamAction = useTaskForceAction();
  // The session drawing the map from scratch (or continuing it), so the canvas can show it growing. Remembered, so
  // coming back while it still draws shows the same.
  const drawingKey = `${DRAWING_KEY}:${cwd}`;
  const [drawingSession, setDrawingSession] = useState<string | null>(() => {
    try {
      return localStorage.getItem(drawingKey);
    } catch {
      return null;
    }
  });
  const rememberDrawing = (id: string | null) => {
    setDrawingSession(id);
    try {
      if (id === null) localStorage.removeItem(drawingKey);
      else localStorage.setItem(drawingKey, id);
    } catch {
      // Shown for this visit only.
    }
  };
  const [query, setQuery] = useState('');
  const [lens, setLens] = useState<Lens>(null);
  const [reveal, setReveal] = useState<{ cardId: string; seq: number } | null>(null);
  const hit = useRef(-1);
  const search = useRef<HTMLInputElement>(null);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [seenAt, markSeen] = useLastSeen(cwd);
  const [viewedSince, setViewedSince] = useState(seenAt);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [busy, setBusy] = useState(false);
  // What I just asked the map, flying from its input to where the map begins.
  const [flight, setFlight] = useState<{ text: string; from: DOMRect | null; toFirst: boolean; at: number } | null>(
    null,
  );
  const lock = useRef(false);
  // The width of the map's own area (this page without the dock), to decide whether the changes list overlays the dock.
  const area = useRef<HTMLElement>(null);
  const [areaWidth, setAreaWidth] = useState(Infinity);
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => entry && setAreaWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null);
  const [retry, setRetry] = useState<{ action: Action; target?: Target } | null>(null);
  // A failed send retries exactly the prepared prompt and branch, rather than creating duplicate work.
  const attempt = useRef<{ key: string; session: string; prepared?: FlowPrepareResult } | null>(null);
  const data = board.data;
  const document = data && mapOf(data);
  const active = live.data?.info.status === 'running' || live.data?.info.status === 'waiting';
  // Any session of this project that is working, not only the one shown.
  const anyActive =
    active || (sessions ?? []).some((s) => s.cwd === cwd && (s.status === 'running' || s.status === 'waiting'));
  const reasons: Record<string, string> = {
    flow_conflict: t.conflict,
    map_read_only: t.readOnlyBanner,
    invalid_flow: t.invalidFlow,
    replay_changed: t.replayChanged,
    reason_required: t.reasonRequired,
    flow_busy: t.busyEdit,
  };
  const readOnly = !!data?.readOnly;
  const hasMap = !!(document?.nodes?.length || document?.flows?.length);
  const locked = busy || anyActive || readOnly;
  const project = cwd.split('/').pop() ?? cwd;
  // Only which sessions work changes the cards; their other updates (many a second while one runs) must not redraw
  // the whole map.
  const workingKey = (sessions ?? [])
    .filter((s) => s.status === 'running' || s.status === 'waiting')
    .map((s) => s.id)
    .join(' ');
  const working = useMemo(() => new Set(workingKey.split(' ').filter(Boolean)), [workingKey]);
  const treeMap = useMemo(
    () =>
      data
        ? toTreeMap(data, working, project, {
            unnamed: { ko: tree.unnamed, en: tree.unnamed },
            unnamedRole: { ko: tree.unnamedRole, en: tree.unnamedRole },
          })
        : null,
    [data, working, project, tree.unnamed, tree.unnamedRole],
  );

  const landed = !!flight?.toFirst && !!treeMap?.people.length;
  useEffect(() => {
    if (!flight || (flight.toFirst && !landed)) return;
    // The stand-in fades as the first real card lands, then goes; a bubble into an existing map just goes.
    const timer = setTimeout(() => setFlight(null), 900);
    return () => clearTimeout(timer);
  }, [flight, landed]);
  const flights = useRef(0);
  const askMap = async (text: string, from: DOMRect | null) => {
    const shown = { text: text || t.drawBubble, from, toFirst: !hasMap, at: ++flights.current };
    setFlight(shown);
    const started = await start('discover', { request: text || t.discoveryRequest });
    if (!started) setFlight((current) => (current?.at === shown.at ? null : current));
    return started;
  };

  // A TF the drawing session started keeps drawing while the session itself waits for it.
  const team = live.data ? latestTaskForce(live.data.items) : null;
  const teamWorking = team?.status === 'running' || team?.status === 'over' || team?.status === 'stopping';
  // Only drawing can run on a project with no map yet, so a working session there is the drawing (also after a reload).
  const drawing = (active || teamWorking) && (!hasMap || drawingSession === sessionId);
  const drawingLine = drawing && (
    <span role="status" className="flex min-w-0 items-center gap-2 text-meta text-fg-muted">
      <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-interactive" />
      <span className="truncate">
        {hasMap ? t.drawingFound(document?.flows?.length ?? 0, document?.nodes?.length ?? 0) : t.drawingFirst}
      </span>
      {sessionId && (
        <button
          type="button"
          onClick={() => {
            // Stopping the drawing stops its TF too, not only the session that asked for it.
            if (team && teamWorking) teamAction.mutate({ action: 'stop', sessionId, runId: team.id });
            cancel.mutate(sessionId);
          }}
          className="shrink-0 cursor-pointer rounded-md px-1.5 text-fg-muted hover:bg-hover hover:text-fg"
        >
          {t.stopDrawing}
        </button>
      )}
    </span>
  );

  const nodeOf = (id: string) => document?.nodes?.find((n) => n.id === id) ?? null;
  // The project's map conversation (newest first in the list), kept going across every request to the map.
  const mapConversation = (sessions ?? []).find((s) => s.cwd === cwd && s.purpose === 'map' && !s.archived) ?? null;
  // Who does the map's work: the conversation's agent once it exists, until then my pick for it (else the project's
  // last agent, as a new conversation would take).
  const agents = useAgents().data?.agents;
  const defaultModel = useConnections().data?.defaultModel ?? null;
  const lastAgent = useProjects().data?.projects.find((p) => p.path === cwd)?.lastAgent ?? null;
  const [newAgent, setNewAgent] = useState<string | null>(null);
  const setAgent = useSetSessionAgent();
  const wantedAgent = newAgent ?? lastAgent ?? 'default';
  const pickedAgent = agents?.some((a) => a.id === wantedAgent) ? wantedAgent : 'default';
  const agentChip = mapConversation ? (
    <AgentChip
      context="session"
      agentId={mapConversation.agent ?? 'default'}
      model={mapConversation.model}
      disabled={anyActive || setAgent.isPending}
      onChange={(agent) => setAgent.mutate({ sessionId: mapConversation.id, agent })}
    />
  ) : (
    <AgentChip
      context="new"
      agentId={pickedAgent}
      model={agents?.find((a) => a.id === pickedAgent)?.model ?? defaultModel}
      lastUsed={lastAgent}
      onChange={setNewAgent}
    />
  );
  // What a promise's own answers need: the map, whether it may be written, and how to ask the AI about it.
  const promiseProps = (node: FlowNode) => ({
    cwd,
    board: data!,
    node,
    readOnly,
    editLocked: anyActive,
    onRecheck: () => void start('verify', { node }),
    onNotARule: (conditionId: string) => {
      const rule = node.conditions?.find((c) => c.id === conditionId)?.expectation ?? '';
      void start('change', { node, request: t.notRuleRequest(node.title, rule) });
    },
  });
  const unseen = newChanges(data?.changes, seenAt).length;

  const start = async (action: Action, target?: Target) => {
    // A run already going in this project owns the work; only a retry of a start already under way may go on.
    if (!data || board.isError || lock.current || data.readOnly || (anyActive && !attempt.current)) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    setRetry({ action, target });
    setConfirmRebuild(false);
    const subject = target?.node ?? null;
    const key = JSON.stringify([cwd, action, subject?.id, target?.flowId, target?.nodeIds, target?.request]);
    try {
      if (attempt.current?.key !== key) {
        // All map work goes on in the project's one map conversation, made the first time.
        const conversation =
          mapConversation?.id ?? (await create.mutateAsync({ cwd, purpose: 'map', agent: newAgent ?? undefined })).id;
        attempt.current = { key, session: conversation };
      }
      const current = attempt.current;
      if (!current.prepared) {
        current.prepared = await prepare.mutateAsync({
          cwd,
          revision: data.revision,
          action,
          request:
            target?.request || (action === 'discover' ? t.discoveryRequest : t.checkRequest(subject?.title ?? '')),
          nodeId: action === 'discover' ? null : (subject?.id ?? null),
          flowId: action === 'discover' ? null : (target?.flowId ?? null),
          ...(target?.nodeIds ? { nodeIds: target.nodeIds.slice(0, 500) } : {}),
          sessionId: current.session,
        });
      }
      await send.mutateAsync({ sessionId: current.session, text: current.prepared.prompt });
      // The drawing line belongs to drawing runs only; the same conversation also does other map work.
      rememberDrawing(action === 'discover' ? current.session : null);
      onSession(current.session);
      attempt.current = null;
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

  const syncMap = () => void start('sync', { request: t.syncRequest });
  const continueMap = () => void start('discover', { request: t.continueRequest });
  const recheck = useMemo(() => (data ? recheckIds(data) : []), [data]);
  const recheckAll = () => void start('verify', { nodeIds: recheck, request: t.recheckAllRequest });
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
    void start('verify', { nodeIds: edited.map((item) => item.nodeId), request: t.editedVerifyRequest });

  // Cards by what their promises say (one broke, or one needs a look again), and what changed since I last looked.
  const lenses = useMemo(() => {
    const failed = new Set<string>();
    const again = new Set<string>();
    for (const card of Object.values(treeMap?.cards ?? {})) {
      if (card.promises.some((p) => p.status === 'failed')) failed.add(card.id);
      if (card.promises.some((p) => p.status === 'recheck')) again.add(card.id);
    }
    return {
      failed,
      recheck: again,
      changed: treeMap ? changedCards(treeMap, seenAt ?? undefined) : new Set<string>(),
    };
  }, [treeMap, seenAt]);

  // Search lights the cards whose words, tags or promises match; it never hides any, because a missing step would
  // break its journey. Enter (or "다음") brings the next one into view.
  const matched = useMemo(() => (data ? matchingIds(mapOf(data), query) : null), [data, query]);
  const hits = useMemo(() => (data && matched ? searchOrder(mapOf(data), matched) : []), [data, matched]);
  const nextHit = () => {
    if (!hits.length) return;
    hit.current = (hit.current + 1) % hits.length;
    setReveal({ cardId: hits[hit.current]!.nodeId, seq: Date.now() });
  };
  const verifyFound = () =>
    void start('verify', {
      nodeIds: [...new Set(hits.map((h) => h.nodeId))],
      request: t.verifyFoundRequest(query.trim()),
    });
  const lit = matched ?? (lens ? lenses[lens] : null);
  const pick = (next: Lens) => setLens(lens === next ? null : next);

  const openChanges = () => {
    if (changesOpen) return setChangesOpen(false);
    setViewedSince(seenAt);
    markSeen();
    setChangesOpen(true);
  };

  // The optional daily check starts one batch while the map is open, and notes that it ran only when it started.
  const scheduled = useRef<string | null>(null);
  useEffect(() => {
    const plan = data?.schedule;
    if (!data || !plan?.enabled || data.readOnly || busy || anyActive || board.isError) return;
    // Only a map just fetched from the server says when the check last ran.
    if (!board.isFetchedAfterMount || board.isFetching) return;
    if (scheduled.current === cwd || !due(plan.lastRun)) return;
    const ids = recheckIds(data).slice(0, plan.limit ?? 20);
    if (!ids.length) return;
    // Once per open map, win or lose. Claiming the day comes first: the server refuses when another window already did.
    scheduled.current = cwd;
    schedule.mutate(
      { cwd, enabled: true, limit: plan.limit ?? 20, ran: true },
      { onSuccess: () => void start('verify', { nodeIds: ids, request: t.scheduledRequest }) },
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
      } else if (event.key === 'Escape' && !editable(globalThis.document.activeElement) && changesOpen) {
        setChangesOpen(false);
      }
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  });

  // With the dock beside it, the map keeps MIN_MAP_WIDTH and the changes list is laid over the dock instead.
  const overlay = dockOpen && areaWidth < MIN_MAP_WIDTH + PANEL_WIDTH;
  const uncovered = data?.coverage?.git ? (data.coverage.uncoveredCount ?? 0) : 0;
  const notices =
    !!data && hasMap && (uncovered > 0 || !!data.unmapped?.length || editedCount > 0 || !!data.removedCards?.length);

  return (
    <main ref={area} className="flex min-h-0 min-w-0 grow flex-col bg-canvas contain-inline-size" aria-label={t.title}>
      {!hasMap && drawing && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">{drawingLine}</div>
      )}
      {hasMap && data && (
        <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
          <label className="relative flex w-60 min-w-40 items-center">
            <span className="sr-only">{t.searchLabel}</span>
            <Search size={13} className="pointer-events-none absolute left-2.5 text-fg-faint" />
            <input
              ref={search}
              type="search"
              value={query}
              placeholder={t.searchPlaceholder}
              onChange={(event) => {
                hit.current = -1;
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  hit.current = -1;
                  setQuery('');
                } else if (event.key === 'Enter' && query.trim()) {
                  event.preventDefault();
                  nextHit();
                }
              }}
              className="h-8 w-full min-w-0 rounded-lg border border-line bg-canvas-raised pr-2 pl-8 text-body"
            />
          </label>
          {query.trim() && (
            <span className="flex items-center gap-2 text-meta text-fg-muted">
              <span className="tabular-nums">{t.found(hits.length)}</span>
              {hits.length > 1 && (
                <LinkButton aria-label={t.nextMatch} onClick={nextHit}>
                  {t.nextMatchShort}
                </LinkButton>
              )}
              {hits.length > 0 && (
                <LinkButton disabled={locked} onClick={verifyFound}>
                  {t.verifyFound}
                </LinkButton>
              )}
            </span>
          )}
          {drawingLine && <span className="min-w-0">{drawingLine}</span>}
          <span className="grow" />
          {lenses.failed.size > 0 && (
            <Chip pressed={lens === 'failed'} tone="danger" onClick={() => pick('failed')}>
              <CircleX size={13} aria-hidden />
              {t.lensFailed(lenses.failed.size)}
            </Chip>
          )}
          {lenses.recheck.size > 0 && (
            <Chip pressed={lens === 'recheck'} tone="attention" onClick={() => pick('recheck')}>
              <RotateCcw size={13} aria-hidden />
              {t.lensRecheck(lenses.recheck.size)}
            </Chip>
          )}
          {lenses.changed.size > 0 && (
            <Chip pressed={lens === 'changed'} onClick={() => pick('changed')}>
              <Sparkles size={13} aria-hidden />
              {t.lensChanged(lenses.changed.size)}
            </Chip>
          )}
          <MapMenu
            cwd={cwd}
            board={data}
            readOnly={readOnly}
            unseen={unseen}
            canStart={!(busy || active || board.isError || readOnly)}
            onChanges={data.changes?.length ? openChanges : undefined}
            onRediscover={() => setConfirmRebuild(true)}
            onScope={() => setScopeOpen(true)}
            onDelete={() => setDeleting(true)}
            recheck={recheck.length}
            onRecheck={recheckAll}
          />
        </div>
      )}
      {notices && data && (
        <ul
          aria-label={t.noticesLabel}
          className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-canvas-sunken px-2 py-1"
        >
          {uncovered > 0 && data.coverage && (
            <Coverage coverage={data.coverage} exclude={data.exclude ?? []} disabled={locked} onSync={syncMap} />
          )}
          <Unmapped parts={data.unmapped ?? []} disabled={locked} onContinue={continueMap} />
          {editedCount > 0 && (
            <li data-edited className="flex min-h-7 items-center gap-2 px-2 text-body">
              {t.editedPromises(editedCount)}
              <LinkButton disabled={locked} onClick={checkEdited}>
                {t.editedCheck}
              </LinkButton>
            </li>
          )}
          {!!data.removedCards?.length && (
            <li>
              <Popover.Root>
                <Popover.Trigger className={noticeRow}>
                  {t.removedCardsShort(data.removedCards.length)}
                  <ChevronRight size={13} aria-hidden className="text-fg-muted" />
                </Popover.Trigger>
                <Popover.Popup align="start" className="w-96 gap-2 p-3">
                  <section aria-label={t.removedCards} className="flex flex-col gap-1.5">
                    <h2 className="text-meta text-attention">{t.removedCards}</h2>
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
                </Popover.Popup>
              </Popover.Root>
            </li>
          )}
        </ul>
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
      <div className="relative flex min-h-0 min-w-0 grow">
        {board.isError && !data ? (
          <div className="flex grow flex-col items-center justify-center gap-3 p-8">
            <p role="alert" className="text-body text-danger">
              {t.loadFailed}
            </p>
            <Button onClick={() => void board.refetch()}>{t.retry}</Button>
          </div>
        ) : !data ? (
          <p className="p-8 text-body text-fg-muted">{t.loading}</p>
        ) : !hasMap && (drawing || busy) && flight ? (
          // The stand-in card holds the first place until the first journey lands.
          <div className="min-w-0 grow" />
        ) : !hasMap && (drawing || busy) ? (
          // The canvas, still empty: the first cards land here as soon as the AI writes them.
          <div className="flex min-w-0 grow items-center justify-center">
            <span aria-hidden className="h-16 w-44 animate-pulse rounded-xl border border-dashed border-line" />
          </div>
        ) : !hasMap ? (
          <div className="flex min-w-0 grow flex-col items-center justify-center gap-3 p-8 text-center">
            <h2 className="text-title font-semibold">{t.empty}</h2>
            <p className="max-w-90 text-body text-fg-muted">{demo ? t.demo : t.emptyLead}</p>
            <details className="group mt-1 flex flex-col items-center">
              <summary className="cursor-pointer list-none text-meta text-interactive">{t.scopeBefore}</summary>
              <div className="mt-3 text-left">
                <ScopeEditor cwd={cwd} board={data} readOnly={readOnly} label={t.scopeTitle} />
              </div>
            </details>
          </div>
        ) : (
          treeMap && (
            <JourneyMap
              cwd={cwd}
              map={treeMap}
              board={data}
              seenAt={seenAt}
              start={(action, target) => start(action, target)}
              drawing={drawing}
              lit={lit}
              reveal={reveal}
              stepParts={(cardId) => {
                const node = nodeOf(cardId);
                if (!node) return {};
                const mine = data.states?.[cardId];
                const canEdit = !readOnly && !anyActive;
                return {
                  title: <Title key={cardId} cwd={cwd} node={node} mine={mine?.overridden?.title} canEdit={canEdit} />,
                  howToTry: (
                    <HowToTry
                      key={`try-${cardId}`}
                      cwd={cwd}
                      node={node}
                      mine={mine?.overridden?.howToTry}
                      canEdit={canEdit}
                    />
                  ),
                  extras: (
                    <>
                      {!!mine?.removedPromises?.length && <PromiseMore {...promiseProps(node)} only={REMOVED} />}
                      <CardAsk
                        key={cardId}
                        locked={locked}
                        onAsk={(request) => start('change', { node, request })}
                        onRecheck={() => void start('verify', { node })}
                      />
                    </>
                  ),
                };
              }}
              promiseExtras={(cardId, promiseId) => {
                const node = nodeOf(cardId);
                return node && <PromiseMore key={promiseId} {...promiseProps(node)} only={promiseId} />;
              }}
              onSession={(id) => {
                onSession(id);
                onShowConversation?.();
              }}
            />
          )
        )}
        {flight && <AskFlight key={flight.at} {...flight} landed={landed} />}
        {sessionId && live.data && !readOnly && (
          <MapReplies
            sessionId={sessionId}
            items={live.data.items}
            waiting={live.data.info.status === 'waiting'}
            onOpen={() => onShowConversation?.()}
          />
        )}
        {data && !readOnly && !board.isError && (
          <MapAsk empty={!hasMap} disabled={busy || anyActive} onSend={askMap} agent={agentChip} />
        )}
        <div
          data-overlay={overlay || undefined}
          className={overlay ? 'absolute inset-y-0 right-0 z-20 flex bg-canvas shadow-overlay' : 'contents'}
        >
          <SlidingPanel open={!!data && changesOpen} width={PANEL_WIDTH}>
            {changesOpen && data && (
              <Changes
                board={data}
                since={viewedSince}
                onSelect={(id) => setReveal({ cardId: id, seq: Date.now() })}
                onClose={() => setChangesOpen(false)}
              />
            )}
          </SlidingPanel>
        </div>
      </div>
    </main>
  );
}

/** A status above the map that lights its cards; pressed again, it lets go. */
function Chip({
  pressed,
  tone,
  onClick,
  children,
}: {
  pressed: boolean;
  tone?: 'danger' | 'attention';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={clsx(
        'inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-meta transition-colors',
        pressed ? 'border-interactive bg-selected text-fg' : 'border-line bg-canvas-raised hover:bg-hover',
        !pressed && (tone === 'danger' ? 'text-danger' : tone === 'attention' ? 'text-attention' : 'text-fg-muted'),
      )}
    >
      {children}
    </button>
  );
}
