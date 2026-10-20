import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import {
  AppWindow,
  ArrowRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  CornerDownRight,
  Database,
  DoorOpen,
  FileCode,
  LoaderCircle,
  Package,
  Plus,
  RotateCcw,
  Undo2,
  Webhook,
  Workflow,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import {
  isJourneyLink,
  journeyTally,
  personCards,
  personTally,
  promisesWith,
  tally,
  type Journey,
  type Person,
  type PromiseStatus,
  type Tally,
  type TreeCard,
  type TreeMap,
  type TreePromise,
} from './flowTreeModel';
import { flowTreeMessages as messages } from './flowTreeMessages';
import { TreeCanvas, type ShownNode, type TreeCanvasHandle } from './TreeCanvas';
import {
  Avatar,
  Detail,
  InlineAdd,
  Progress,
  RemovedNotice,
  StatusMark,
  useSettled,
  useText,
  type PromiseTarget,
} from './treeParts';
import { CHECKLIST_ROWS, layoutTree, stepId, type LaidNode } from './treeLayout';

export type { PromiseTarget } from './treeParts';

export interface FlowTreeProps {
  map: TreeMap;
  onCheck: (targets: PromiseTarget[]) => void;
  onFix: (targets: PromiseTarget[]) => void;
  onAddPromise: (cardId: string, when: string, then: string) => void;
  onRemovePromise: (target: PromiseTarget) => void;
  onUndoRemove: () => void;
  onAddJourney: (personId: string, title: string, goal: string) => void;
  onFindSteps: (journeyId: string) => void;
  onAddPerson: (name: string) => void;
  /** A person's own call on a card (how much it matters, when, a one-line note). */
  onDecide?: (cardId: string, field: 'priority' | 'scope' | 'decision', value: string | null) => void;
  /** Opens the conversation last started on a card. */
  onOpenSession?: (sessionId: string) => void;
  initialPerson?: string;
  /** Opens every step's promises from the start (the whole map at once). */
  allOpen?: boolean;
  /** Starts with only what changed in view. */
  changesOnly?: boolean;
  /** When the person last looked at the map (ISO); later changes count as new. Unknown: only rechecks and breaks. */
  seenAt?: string;
}

/** What the side panel shows: a node's details, a promise of a step, or a form for what a "+" adds. */
type Focus =
  | { kind: 'person'; personId: string }
  | { kind: 'journey'; personId: string; journeyId: string }
  | { kind: 'step'; personId: string; journeyId: string; cardId: string }
  | { kind: 'promise'; personId: string; journeyId: string; cardId: string; promiseId: string }
  | { kind: 'addJourney'; personId: string }
  | { kind: 'addPerson' };

const focusNodeId = (focus: Focus | null): string | null => {
  if (!focus) return null;
  switch (focus.kind) {
    case 'person':
      return `start:${focus.personId}`;
    case 'journey':
      return `journey:${focus.journeyId}`;
    case 'step':
    case 'promise':
      return stepId(focus.journeyId, focus.cardId);
    case 'addJourney':
      return `add-journey:${focus.personId}`;
    case 'addPerson':
      return 'add-person';
  }
};

/**
 * The product map read person first, as a quiet flow diagram: a band per person who uses the product; in it, their
 * way in branches to their journeys, and each journey runs left to right through its steps. Pressing a step opens its
 * promises below it as leaves. The panel on the right says what to do next and explains whatever is picked.
 */
export function FlowTree(props: FlowTreeProps) {
  const { map } = props;
  const first = map.people.find((person) => person.id === props.initialPerson) ?? map.people[0];
  const [openSteps, setOpenSteps] = useState<Set<string>>(() => {
    if (props.allOpen)
      return new Set(
        map.people.flatMap((person) =>
          person.journeys.flatMap((journey) => journey.steps.map((cardId) => stepId(journey.id, cardId))),
        ),
      );
    const journey = first?.journeys[0];
    return new Set(journey?.steps[0] ? [stepId(journey.id, journey.steps[0])] : []);
  });
  const [focus, setFocus] = useState<Focus | null>(first ? { kind: 'person', personId: first.id } : null);
  const [hover, setHover] = useState<string | null>(null);
  const [notice, setNotice] = useState(0);
  const [changesOnly, setChangesOnly] = useState(props.changesOnly ?? false);
  const canvas = useRef<TreeCanvasHandle>(null);

  const layout = useMemo(() => layoutTree(map, openSteps), [map, openSteps]);
  const nodes = layout.nodes;
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const focusId = focusNodeId(focus);

  // The path from the person's start to what is pointed at, or else to what is picked, turns blue.
  const highlight = useMemo(() => {
    const lit = new Set<string>();
    let id = hover ?? focusId;
    while (id) {
      lit.add(id);
      id = byId.get(id)?.parent ?? null;
    }
    return lit;
  }, [hover, focusId, byId]);

  // What changed: steps whose code moved under a passed promise, that broke, or that the map changed lately.
  const changed = useMemo(() => changedCards(map, props.seenAt), [map, props.seenAt]);

  // Picking a journey, a step or a promise keeps its row clear and quiets the rest, so one strand can be followed.
  // "Changes only" keeps what changed clear instead, with the cards that lead to it.
  const strand = useMemo(() => {
    if (changesOnly) {
      const lit = new Set<string>();
      for (const node of nodes) {
        if (!node.cardId || !changed.has(node.cardId)) continue;
        let id: string | null = node.id;
        while (id) {
          lit.add(id);
          id = byId.get(id)?.parent ?? null;
        }
        if (node.personId) lit.add(`band:${node.personId}`);
      }
      return lit;
    }
    if (!focus || !('journeyId' in focus)) return null;
    return new Set(
      nodes
        .filter(
          (node) =>
            node.journeyId === focus.journeyId ||
            node.id === `start:${focus.personId}` ||
            node.id === `band:${focus.personId}`,
        )
        .map((node) => node.id),
    );
  }, [focus, nodes, changesOnly, changed, byId]);

  const initialFocus = useMemo(
    () =>
      first
        ? nodes
            .filter(
              (node) =>
                node.id === `start:${first.id}` ||
                (node.journeyId !== undefined &&
                  (node.journeyId === first.journeys[0]?.id || node.journeyId === first.journeys[1]?.id) &&
                  // Long journeys run on to the right; the first view shows where they begin.
                  node.index < 4),
            )
            .map((node) => node.id)
        : undefined,
    // Only the first layout decides the first view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(0), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const reveal = (id: string | null) => id && setTimeout(() => canvas.current?.reveal(id), 420);

  /** Opens the step of a promise, picks the promise and brings it into view once it has grown in. */
  const show = (target: PromiseTarget, personId: string) => {
    const journey = map.people
      .find((candidate) => candidate.id === personId)
      ?.journeys.find((candidate) => candidate.steps.includes(target.cardId));
    if (!journey) return;
    setOpenSteps((current) => new Set(current).add(stepId(journey.id, target.cardId)));
    setFocus({ kind: 'promise', personId, journeyId: journey.id, ...target });
    reveal(stepId(journey.id, target.cardId));
  };

  const removePromise = (target: PromiseTarget) => {
    props.onRemovePromise(target);
    if (focus?.kind === 'promise' && focus.promiseId === target.promiseId)
      setFocus({ kind: 'step', personId: focus.personId, journeyId: focus.journeyId, cardId: focus.cardId });
    setNotice(Date.now());
  };

  const allSteps = () =>
    map.people.flatMap((person) =>
      person.journeys.flatMap((journey) =>
        journey.steps.filter((step) => !isJourneyLink(step)).map((cardId) => stepId(journey.id, cardId)),
      ),
    );

  function press(node: LaidNode) {
    switch (node.kind) {
      case 'band':
      case 'start':
        setFocus({ kind: 'person', personId: node.personId! });
        return;
      case 'journey':
        setFocus({ kind: 'journey', personId: node.personId!, journeyId: node.journeyId! });
        return;
      case 'step': {
        const picked = focusId === node.id;
        setOpenSteps((current) => {
          const next = new Set(current);
          if (picked && next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
        setFocus({ kind: 'step', personId: node.personId!, journeyId: node.journeyId!, cardId: node.cardId! });
        return;
      }
      case 'link': {
        const owner = map.people.find((candidate) => candidate.journeys.some((journey) => journey.id === node.linkTo));
        if (!owner) return;
        setFocus({ kind: 'journey', personId: owner.id, journeyId: node.linkTo! });
        reveal(`journey:${node.linkTo}`);
        return;
      }
      case 'addJourney':
        setFocus({ kind: 'addJourney', personId: node.personId! });
        return;
      case 'addPerson':
        setFocus({ kind: 'addPerson' });
    }
  }

  const person =
    focus && focus.kind !== 'addPerson' ? map.people.find((candidate) => candidate.id === focus.personId) : undefined;

  return (
    <div className="flex h-full min-h-0 w-full bg-canvas text-body text-fg">
      <TreeCanvas
        ref={canvas}
        nodes={nodes}
        edges={layout.edges}
        highlight={highlight}
        strand={strand}
        initialFocus={initialFocus}
        renderNode={(node) => (
          <NodeView
            node={node}
            map={map}
            open={openSteps.has(node.id)}
            picked={node.id === focusId}
            onHover={(on) => setHover(on ? node.id : null)}
            onPress={() => press(node)}
          />
        )}
        tools={
          <ExpandTools
            changesOnly={changesOnly}
            onChangesOnly={() => setChangesOnly((on) => !on)}
            onOpen={() => setOpenSteps(new Set(allSteps()))}
            onClose={() => setOpenSteps(new Set())}
          />
        }
        overlay={
          <>
            <Legend />
            {notice > 0 && (
              <RemovedNotice
                key={notice}
                onUndo={() => {
                  props.onUndoRemove();
                  setNotice(0);
                }}
              />
            )}
          </>
        }
      />
      <aside className="flex w-88 shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas-sunken">
        <Panel
          key={focusId ?? 'product'}
          map={map}
          focus={focus}
          person={person}
          props={props}
          onShow={show}
          onFocus={(next) => {
            setFocus(next);
            if (next.kind === 'promise')
              setOpenSteps((current) => new Set(current).add(stepId(next.journeyId, next.cardId)));
            reveal(focusNodeId(next));
          }}
          onRemove={removePromise}
          onDone={setFocus}
        />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- nodes

const nodeButton =
  'group flex size-full cursor-pointer flex-col text-left transition-[box-shadow,border-color,background-color,filter] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive';
const pickedRing = 'ring-2 ring-interactive ring-offset-2 ring-offset-canvas';

/**
 * Cards in a flow diagram's colours: the way in is dark, a journey carries the strong blue on its label, a step is a
 * white card whose checklist says how each promise stands. Every card reads on its own: what it is, one line of what
 * it does, and what is known to hold.
 */
function NodeView({
  node,
  map,
  open,
  picked,
  onHover,
  onPress,
}: {
  node: ShownNode;
  map: TreeMap;
  open: boolean;
  picked: boolean;
  onHover: (on: boolean) => void;
  onPress: () => void;
}) {
  const t = useMessages(messages);
  const person = node.personId ? map.people.find((candidate) => candidate.id === node.personId) : undefined;
  const shell = (className: string, children: ReactNode) => (
    <button
      type="button"
      aria-pressed={picked}
      aria-expanded={node.kind === 'step' ? open : undefined}
      onClick={onPress}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={clsx(nodeButton, className, picked && pickedRing)}
    >
      {children}
    </button>
  );
  switch (node.kind) {
    case 'band':
      if (!person) return null;
      return <BandLabel map={map} person={person} first={node.index === 0} onPress={onPress} />;
    case 'start':
      if (!person) return null;
      return shell(
        'rounded-xl bg-brand-ink p-3.5 text-on-fill hover:brightness-125',
        <StartCard map={map} person={person} />,
      );
    case 'journey': {
      const journey = person?.journeys.find((candidate) => candidate.id === node.journeyId);
      if (!journey) return null;
      return shell(
        'rounded-xl border border-line bg-canvas-raised p-3.5 hover:border-interactive',
        <JourneyCard map={map} journey={journey} />,
      );
    }
    case 'link': {
      const target = map.people
        .flatMap((candidate) => candidate.journeys)
        .find((journey) => journey.id === node.linkTo);
      if (!target) return null;
      return withArrival(
        node,
        shell(
          'justify-center gap-1 rounded-xl border border-dashed border-interactive/50 bg-canvas px-3.5 hover:border-interactive',
          <LinkCard map={map} journey={target} loops={node.loops} />,
        ),
      );
    }
    case 'step': {
      const card = map.cards[node.cardId!];
      if (!card) return null;
      const counts = tally(card.promises);
      return withArrival(
        node,
        shell(
          clsx(
            'rounded-xl border bg-canvas-raised p-3.5',
            counts.failed
              ? 'border-danger'
              : counts.recheck
                ? 'border-attention'
                : open
                  ? 'border-interactive'
                  : 'border-line hover:border-interactive',
            counts.checking > 0 && 'motion-sweep',
          ),
          <StepCard card={card} number={node.index + 1} open={open} loops={node.loops} />,
        ),
      );
    }
    case 'addJourney':
    case 'addPerson':
      return shell(
        'flex-row items-center justify-center gap-1.5 rounded-md border border-dashed border-line text-meta text-fg-muted hover:border-interactive hover:text-fg',
        <>
          <Plus size={12} aria-hidden />
          {node.kind === 'addJourney' ? t.addJourney : t.addPerson}
        </>,
      );
  }
}

/** The small first line of every card: what kind of card it is, and its loudest status on the right. */
function CardLabel({ children, end, inverted }: { children: ReactNode; end?: ReactNode; inverted?: boolean }) {
  return (
    <span
      className={clsx(
        'flex h-5 shrink-0 items-center justify-between gap-2 text-meta',
        inverted ? 'text-on-fill/70' : 'text-fg-muted',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      {end}
    </span>
  );
}

function StartCard({ map, person }: { map: TreeMap; person: Person }) {
  const t = useMessages(messages);
  const text = useText();
  const counts = personTally(map, person);
  return (
    <>
      <CardLabel inverted>
        <DoorOpen size={13} aria-hidden />
        {t.startsWith}
      </CardLabel>
      <span className="mt-2 line-clamp-3 shrink-0 text-title">{text(person.start) || text(person.name)}</span>
      <span className="mt-auto flex flex-col gap-1.5">
        <span className="text-meta text-on-fill/70">{t.journeys(person.journeys.length)}</span>
        <span className="text-meta tabular-nums">{t.promiseSummary(counts.passed, counts.total)}</span>
        {counts.total > 0 && <Progress counts={counts} wide inverted />}
      </span>
    </>
  );
}

function JourneyCard({ map, journey }: { map: TreeMap; journey: Journey }) {
  const t = useMessages(messages);
  const text = useText();
  const counts = journeyTally(map, journey);
  const trigger = journey.trigger ? text(journey.trigger) : '';
  return (
    <>
      <CardLabel end={<LoudStatus counts={counts} />}>
        <span className="rounded-sm bg-interactive px-1.5 text-on-fill">{t.legendJourney}</span>
        {t.stepsCount(journey.steps.length)}
      </CardLabel>
      <span className="mt-2 line-clamp-2 shrink-0 text-title">{text(journey.title)}</span>
      {trigger && (
        <span className="mt-2 flex shrink-0 items-start gap-1.5 text-meta text-fg-muted">
          <DoorOpen size={12} aria-hidden className="mt-1 shrink-0" />
          <span className="line-clamp-2">{trigger}</span>
        </span>
      )}
      {text(journey.goal) && <span className="mt-2 line-clamp-2 shrink-0 text-meta text-fg">{text(journey.goal)}</span>}
      <span className="mt-auto flex items-center gap-3 pt-2 text-meta text-fg-muted">
        <span className="shrink-0 tabular-nums">{t.promiseSummary(counts.passed, counts.total)}</span>
        {counts.total > 0 && <Progress counts={counts} wide />}
      </span>
    </>
  );
}

const kindIcons = { screen: AppWindow, api: Webhook, sdk: Package, process: Workflow, data: Database } as const;
const kindWords = {
  screen: 'kindScreen',
  api: 'kindApi',
  sdk: 'kindSdk',
  process: 'kindProcess',
  data: 'kindData',
} as const;
/** Worst first, so a closed card shows what needs a look before what is fine. */
const CHECK_ORDER: PromiseStatus[] = ['failed', 'recheck', 'checking', 'blocked', 'planned', 'unconfirmed', 'passed'];

/** The condition a branch arrives with, written just above its first card ("↳ 실행 승인이 필요할 때"). */
function withArrival(node: LaidNode, card: ReactNode) {
  if (!node.arrival) return card;
  return (
    <>
      <span
        title={node.arrival}
        className="pointer-events-none absolute -top-6 left-0 flex max-w-full items-center gap-1 truncate text-meta text-fg-muted"
      >
        <CornerDownRight size={12} aria-hidden className="shrink-0" />
        <span className="truncate">{node.arrival}</span>
      </span>
      {card}
    </>
  );
}

/** A step that goes through a whole other journey: its title and how it stands; pressing it goes there. */
function LinkCard({ map, journey, loops }: { map: TreeMap; journey: Journey; loops?: LaidNode['loops'] }) {
  const t = useMessages(messages);
  const text = useText();
  const counts = journeyTally(map, journey);
  return (
    <>
      <span className="flex items-center gap-1.5 text-meta text-interactive">
        <ArrowRight size={12} aria-hidden />
        {t.throughJourney}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{text(journey.title)}</span>
        <LoudStatus counts={counts} />
      </span>
      {loops && loops.length > 0 && <LoopsLine loops={loops} />}
    </>
  );
}

/** Where a card leads back to (loops), in one quiet line: "↺ 대화로 요청하기 +2". */
function LoopsLine({ loops }: { loops: NonNullable<LaidNode['loops']> }) {
  const t = useMessages(messages);
  return (
    <span
      className="flex min-w-0 items-center gap-1 text-meta text-fg-muted"
      title={loops.map((loop) => `${loop.title}${loop.label ? ` · ${loop.label}` : ''}`).join('\n')}
    >
      <Undo2 size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{t.backTo(loops[0]!.title)}</span>
      {loops.length > 1 && <span className="shrink-0">+{loops.length - 1}</span>}
    </span>
  );
}

function StepCard({
  card,
  number,
  open,
  loops,
}: {
  card: TreeCard;
  number: number;
  open: boolean;
  loops?: LaidNode['loops'];
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const counts = tally(card.promises);
  const kind = card.kind ?? 'process';
  const KindIcon = kindIcons[kind];
  const ordered = open
    ? card.promises
    : [...card.promises].sort((a, b) => CHECK_ORDER.indexOf(a.status) - CHECK_ORDER.indexOf(b.status));
  const shown = open ? ordered : ordered.slice(0, CHECKLIST_ROWS);
  const more = card.promises.length - shown.length;
  const source = card.sources?.[0];
  const checked = card.promises
    .map((promise) => promise.checkedAt)
    .filter((at): at is string => Boolean(at))
    .sort()
    .at(-1);
  return (
    <>
      <CardLabel end={<LoudStatus counts={counts} />}>
        <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-selected text-fg tabular-nums">
          {number}
        </span>
        <KindIcon size={12} aria-hidden className="shrink-0" />
        {t[kindWords[kind]]}
        {card.priority === 'must' && <span className="rounded-sm bg-selected px-1 text-fg">{t.priorityMust}</span>}
        {card.scope === 'now' && <span className="rounded-sm bg-selected px-1 text-fg">{t.scopeNow}</span>}
        {(card.scope === 'out' || card.priority === 'later') && (
          <span className="rounded-sm px-1 text-fg-faint">{card.scope === 'out' ? t.scopeOut : t.priorityLater}</span>
        )}
      </CardLabel>
      <span className="mt-1.5 shrink-0 truncate font-medium">{card.title}</span>
      {card.description && <span className="shrink-0 truncate text-meta text-fg-muted">{card.description}</span>}
      <ul className="mt-2 flex shrink-0 flex-col">
        {shown.map((promise) => (
          <CheckRow key={promise.id} promise={promise} />
        ))}
        {card.promises.length === 0 && <li className="text-meta text-fg-faint">{t.noPromises}</li>}
      </ul>
      <span className="mt-auto flex shrink-0 flex-col gap-1 pt-2">
        {loops && loops.length > 0 && <LoopsLine loops={loops} />}
        <span className="flex items-center justify-between gap-2 text-meta text-fg-muted">
          <span className="flex min-w-0 items-center gap-1">
            {source && (
              <>
                <FileCode size={12} aria-hidden className="shrink-0" />
                <span className="truncate font-mono">{source.split('/').at(-1)}</span>
                {card.sources!.length > 1 && <span className="shrink-0">+{card.sources!.length - 1}</span>}
              </>
            )}
          </span>
          <span className="shrink-0">
            {more > 0
              ? t.morePromises(more)
              : checked
                ? t.checkedOn(format.date(new Date(checked)))
                : t.passedOf(counts.passed, counts.total)}
          </span>
        </span>
      </span>
    </>
  );
}

const checkIcons: Record<PromiseStatus, [typeof Circle, string]> = {
  failed: [CircleX, 'text-danger'],
  recheck: [RotateCcw, 'text-attention'],
  checking: [LoaderCircle, 'text-interactive motion-spin'],
  blocked: [CircleSlash, 'text-attention'],
  unconfirmed: [Circle, 'text-fg-faint'],
  planned: [CircleDashed, 'text-fg-faint'],
  passed: [CircleCheck, 'text-interactive'],
};

/** One promise as a checklist line: a tick once a check saw it hold, an empty circle while nobody looked. */
function CheckRow({ promise }: { promise: TreePromise }) {
  const t = useMessages(messages);
  const settled = useSettled(promise.status);
  const [Icon, color] = checkIcons[promise.status];
  return (
    <li
      className={clsx(
        'flex h-5 min-w-0 items-center gap-2 rounded-sm text-meta',
        promise.status === 'failed' ? 'text-danger' : promise.status === 'passed' ? 'text-fg' : 'text-fg-muted',
        settled && 'motion-arrive',
      )}
      title={`${t[promise.status]} · ${promise.then}`}
    >
      <Icon size={13} aria-hidden className={clsx('shrink-0', color)} />
      <span className="truncate">{promise.when ? `${promise.when} → ${promise.then}` : promise.then}</span>
    </li>
  );
}

function LoudStatus({ counts }: { counts: Tally }) {
  const t = useMessages(messages);
  const loud = (['failed', 'recheck', 'checking', 'blocked'] as PromiseStatus[]).find((status) => counts[status] > 0);
  if (loud) return <StatusMark status={loud} count={counts[loud]} />;
  if (counts.total && counts.passed === counts.total) return <StatusMark status="passed" />;
  return counts.total ? <span className="tabular-nums">{t.fraction(counts.passed, counts.total)}</span> : null;
}

/** A band's name tag, top left: who this band is about and how much of theirs holds. */
function BandLabel({
  map,
  person,
  first,
  onPress,
}: {
  map: TreeMap;
  person: Person;
  first: boolean;
  onPress: () => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  const counts = personTally(map, person);
  return (
    <div className={clsx('size-full', !first && 'border-t border-line-subtle')}>
      <button
        type="button"
        onClick={onPress}
        className="pointer-events-auto mt-3 ml-5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-meta transition-colors hover:bg-hover"
      >
        <Avatar person={person} small />
        <span className="text-body text-fg">{text(person.name)}</span>
        <span className="text-fg-muted">{text(person.role)}</span>
        <span className={clsx('tabular-nums', counts.failed ? 'text-danger' : 'text-fg-faint')}>
          · {counts.failed ? `${t.failed} ${counts.failed}` : t.promiseSummary(counts.passed, counts.total)}
        </span>
      </button>
    </div>
  );
}

/** What the fills mean, top right, as a flow diagram has it. */
function Legend() {
  const t = useMessages(messages);
  const items: [string, string][] = [
    ['bg-brand-ink', t.legendStart],
    ['bg-interactive', t.legendJourney],
    ['bg-canvas-raised border border-line', t.legendStep],
  ];
  return (
    <div className="pointer-events-none absolute top-4 right-4 flex items-center gap-3 rounded-lg bg-canvas/80 px-3 py-1.5 text-meta whitespace-nowrap text-fg-muted backdrop-blur-sm">
      {items.map(([swatch, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span aria-hidden className={clsx('size-2.5 rounded-sm', swatch)} />
          {label}
        </span>
      ))}
    </div>
  );
}

function ExpandTools({
  changesOnly,
  onChangesOnly,
  onOpen,
  onClose,
}: {
  changesOnly: boolean;
  onChangesOnly: () => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const t = useMessages(messages);
  return (
    <>
      <span className="mx-0.5 h-4 border-l border-line-subtle" aria-hidden />
      <button
        type="button"
        aria-pressed={changesOnly}
        onClick={onChangesOnly}
        className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-meta whitespace-nowrap text-fg-muted transition-colors hover:bg-hover hover:text-fg aria-pressed:bg-selected aria-pressed:text-fg"
      >
        <RotateCcw size={13} aria-hidden />
        {t.changesOnly}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-meta whitespace-nowrap text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <ChevronsUpDown size={13} aria-hidden />
        {t.openAll}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 cursor-pointer items-center gap-1 rounded-md px-1.5 text-meta whitespace-nowrap text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <ChevronsDownUp size={13} aria-hidden />
        {t.closeAll}
      </button>
    </>
  );
}

// ---------------------------------------------------------------- panel

function Panel({
  map,
  focus,
  person,
  props,
  onShow,
  onFocus,
  onRemove,
  onDone,
}: {
  map: TreeMap;
  focus: Focus | null;
  person: Person | undefined;
  props: FlowTreeProps;
  onShow: (target: PromiseTarget, personId: string) => void;
  onFocus: (focus: Focus) => void;
  onRemove: (target: PromiseTarget) => void;
  onDone: (focus: Focus | null) => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  if (focus?.kind === 'addPerson')
    return (
      <PanelForm title={t.addPerson}>
        <InlineAdd
          startOpen
          label={t.addPerson}
          fields={[t.personPlaceholder]}
          onAdd={([name]) => {
            props.onAddPerson(name!);
            onDone(null);
          }}
          onCancel={() => onDone(null)}
        />
      </PanelForm>
    );
  if (!focus || !person) return <ProductPanel map={map} onPick={(id) => onFocus({ kind: 'person', personId: id })} />;

  switch (focus.kind) {
    case 'person':
      return <PersonPanel map={map} person={person} props={props} onShow={(target) => onShow(target, person.id)} />;
    case 'journey': {
      const journey = person.journeys.find((candidate) => candidate.id === focus.journeyId);
      if (!journey) return null;
      return (
        <JourneyPanel
          map={map}
          person={person}
          journey={journey}
          props={props}
          onPick={(cardId) => onFocus({ kind: 'step', personId: person.id, journeyId: journey.id, cardId })}
        />
      );
    }
    case 'addJourney':
      return (
        <PanelForm title={t.addJourney} lead={text(person.name)}>
          <InlineAdd
            startOpen
            label={t.addJourney}
            fields={[t.journeyPlaceholder, t.goalPlaceholder]}
            onAdd={([title, goal]) => {
              props.onAddJourney(person.id, title!, goal ?? '');
              onDone({ kind: 'person', personId: person.id });
            }}
            onCancel={() => onDone({ kind: 'person', personId: person.id })}
          />
        </PanelForm>
      );
    case 'step':
    case 'promise':
      return (
        <Detail
          map={map}
          person={person}
          selection={{
            journeyId: focus.journeyId,
            cardId: focus.cardId,
            promiseId: focus.kind === 'promise' ? focus.promiseId : undefined,
          }}
          onSelect={(selection) => {
            if (!selection) return;
            onFocus(
              selection.promiseId
                ? {
                    kind: 'promise',
                    personId: person.id,
                    journeyId: selection.journeyId,
                    cardId: selection.cardId,
                    promiseId: selection.promiseId,
                  }
                : { kind: 'step', personId: person.id, journeyId: selection.journeyId, cardId: selection.cardId },
            );
          }}
          onCheck={props.onCheck}
          onFix={props.onFix}
          onRemove={onRemove}
          footer={
            focus.kind === 'step' && (
              <>
                <InlineAdd
                  label={t.addPromise}
                  fields={[t.whenPlaceholder, t.thenPlaceholder]}
                  onAdd={([when, then]) => props.onAddPromise(focus.cardId, when!, then ?? '')}
                />
                {props.onDecide && map.cards[focus.cardId] && (
                  <Decisions card={map.cards[focus.cardId]!} onDecide={props.onDecide} />
                )}
                {props.onOpenSession && map.cards[focus.cardId]?.sessionId && (
                  <LinkButton onClick={() => props.onOpenSession!(map.cards[focus.cardId]!.sessionId!)}>
                    {t.openSession}
                  </LinkButton>
                )}
              </>
            )
          }
        />
      );
  }
}

function PanelForm({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <div className="motion-step flex flex-col gap-3 p-5">
      <div>
        {lead && <p className="text-meta text-fg-muted">{lead}</p>}
        <h2 className="text-title">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function ProductPanel({ map, onPick }: { map: TreeMap; onPick: (personId: string) => void }) {
  const t = useMessages(messages);
  const text = useText();
  return (
    <div className="motion-step flex flex-col gap-4 p-5">
      <div>
        <p className="text-meta text-fg-muted">{t.product}</p>
        <h2 className="text-display">{map.product}</h2>
      </div>
      <section className="flex flex-col gap-1">
        <h3 className="text-meta text-fg-muted">{t.people}</h3>
        {map.people.map((person) => {
          const counts = personTally(map, person);
          return (
            <button
              key={person.id}
              type="button"
              onClick={() => onPick(person.id)}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover"
            >
              <Avatar person={person} />
              <span className="min-w-0 grow">
                <span className="block truncate">{text(person.name)}</span>
                <span className={clsx('block truncate text-meta', counts.failed ? 'text-danger' : 'text-fg-muted')}>
                  {counts.failed ? `${t.failed} ${counts.failed}` : t.passedOf(counts.passed, counts.total)}
                </span>
              </span>
            </button>
          );
        })}
      </section>
    </div>
  );
}

/** A person's summary: how they come in, how much holds, and what to do next, worst first. */
function PersonPanel({
  map,
  person,
  props,
  onShow,
}: {
  map: TreeMap;
  person: Person;
  props: FlowTreeProps;
  onShow: (target: PromiseTarget) => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  const format = useFormat();
  const counts = personTally(map, person);
  const targets = (statuses: PromiseStatus[]) =>
    promisesWith(map, person, statuses).map(({ cardId, promise }) => ({ cardId, promiseId: promise.id }));

  const todo: { key: string; text: string; tone?: 'danger' | 'attention'; actions: ReactNode }[] = [];
  if (counts.failed)
    todo.push({
      key: 'failed',
      text: t.todoFailed(counts.failed),
      tone: 'danger',
      actions: (
        <>
          <Button variant="primary" onClick={() => props.onFix(targets(['failed']))}>
            {t.todoFix}
          </Button>
          <LinkButton onClick={() => onShow(targets(['failed'])[0]!)}>{t.todoShow}</LinkButton>
        </>
      ),
    });
  if (counts.recheck)
    todo.push({
      key: 'recheck',
      text: t.todoRecheck(counts.recheck),
      tone: 'attention',
      actions: (
        <>
          <Button variant={counts.failed ? 'secondary' : 'primary'} onClick={() => props.onCheck(targets(['recheck']))}>
            {t.todoRecheckAction}
          </Button>
          <LinkButton onClick={() => onShow(targets(['recheck'])[0]!)}>{t.todoShow}</LinkButton>
        </>
      ),
    });
  if (counts.blocked)
    todo.push({
      key: 'blocked',
      text: t.todoBlocked(counts.blocked),
      tone: 'attention',
      actions: <LinkButton onClick={() => onShow(targets(['blocked'])[0]!)}>{t.todoWhy}</LinkButton>,
    });
  if (counts.planned)
    todo.push({
      key: 'planned',
      text: t.todoPlanned(counts.planned),
      actions: <Button onClick={() => props.onCheck(targets(['planned']))}>{t.todoMatch}</Button>,
    });
  if (counts.unconfirmed)
    todo.push({
      key: 'unconfirmed',
      text: t.todoUnconfirmed(counts.unconfirmed),
      actions: (
        <Button
          variant={counts.failed || counts.recheck ? 'secondary' : 'primary'}
          onClick={() => props.onCheck(targets(['unconfirmed']))}
        >
          {t.todoCheck}
        </Button>
      ),
    });

  const mine = personCards(person);
  const seen = new Set<string>();
  // One row per step, its newest check: several checks of one step read as one piece of news.
  const recent = map.recent.filter((change) => {
    if (!mine.has(change.cardId) || seen.has(change.cardId)) return false;
    seen.add(change.cardId);
    return true;
  });

  return (
    <div className="motion-step flex flex-col gap-5 p-5">
      <div className="flex items-center gap-3">
        <Avatar person={person} large />
        <div className="min-w-0">
          <h2 className="truncate text-title">{text(person.name)}</h2>
          <p className="text-meta text-fg-muted">{text(person.role)}</p>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas-raised px-3 py-2.5">
        <DoorOpen size={15} aria-hidden className="mt-0.5 shrink-0 text-interactive" />
        <span className="min-w-0">
          <span className="block text-meta text-fg-muted">{t.startsWith}</span>
          <span className="block">{text(person.start)}</span>
        </span>
      </div>
      <section className="flex flex-col gap-2">
        <span className="text-title tabular-nums">
          {counts.total ? t.promiseSummary(counts.passed, counts.total) : t.noPromises}
        </span>
        {counts.total > 0 && <Progress counts={counts} wide />}
        {counts.checking > 0 && (
          <p role="status" className="motion-step flex items-center gap-2 text-meta text-interactive">
            <LoaderCircle size={13} aria-hidden className="motion-spin" />
            {t.todoChecking(counts.checking)}
          </p>
        )}
      </section>
      {todo.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-meta text-fg-muted">{t.next}</h3>
          <ul className="flex flex-col gap-2">
            {todo.slice(0, 3).map((item) => (
              <li
                key={item.key}
                className="motion-step flex flex-col gap-2 rounded-lg border border-line bg-canvas-raised p-3"
              >
                <span
                  className={clsx(
                    item.tone === 'danger' && 'text-danger',
                    item.tone === 'attention' && 'text-attention',
                  )}
                >
                  {item.text}
                </span>
                <span className="flex items-center gap-3">{item.actions}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-meta text-fg-muted">{t.recentTitle}</h3>
          <ul className="flex flex-col">
            {recent.slice(0, 8).map((change) => (
              <li
                key={`${change.at}-${change.cardId}`}
                className="flex flex-col gap-0.5 border-t border-line-subtle py-2 first:border-t-0"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{map.cards[change.cardId]?.title}</span>
                  <ChangeKind kind={change.kind} />
                </span>
                {change.kind !== 'added' && change.kind !== 'removed' && change.detail && (
                  <span className="line-clamp-2 text-meta text-fg-muted">{change.detail}</span>
                )}
                <span className="text-meta text-fg-faint">{format.date(new Date(change.at))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function JourneyPanel({
  map,
  person,
  journey,
  props,
  onPick,
}: {
  map: TreeMap;
  person: Person;
  journey: Journey;
  props: FlowTreeProps;
  onPick: (cardId: string) => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  const counts = journeyTally(map, journey);
  const unchecked = journey.steps.flatMap((cardId) =>
    (map.cards[cardId]?.promises ?? [])
      .filter((promise) => promise.status === 'unconfirmed' || promise.status === 'planned')
      .map((promise) => ({ cardId, promiseId: promise.id })),
  );
  return (
    <div className="motion-step flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        <p className="text-meta text-fg-muted">{text(person.name)}</p>
        <h2 className="text-title">{text(journey.title)}</h2>
        {text(journey.goal) && <p className="text-fg-muted">{text(journey.goal)}</p>}
      </div>
      {journey.steps.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-fg-muted">{t.noSteps}</p>
          <Button variant="primary" onClick={() => props.onFindSteps(journey.id)}>
            {t.findSteps}
          </Button>
        </div>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <span className="tabular-nums">{t.promiseSummary(counts.passed, counts.total)}</span>
            <Progress counts={counts} wide />
          </section>
          <ol className="flex flex-col">
            {journey.steps.map((cardId, index) => {
              const card = map.cards[cardId];
              if (!card) return null;
              const stepCounts = tally(card.promises);
              return (
                <li key={cardId}>
                  <button
                    type="button"
                    onClick={() => onPick(cardId)}
                    className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-interactive text-meta text-on-fill tabular-nums">
                      {index + 1}
                    </span>
                    <span className="min-w-0 grow truncate">{card.title}</span>
                    <span className="shrink-0 text-meta text-fg-muted tabular-nums">
                      {t.passedOf(stepCounts.passed, stepCounts.total)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {unchecked.length > 0 && (
            <div>
              <Button variant="primary" onClick={() => props.onCheck(unchecked)}>
                {t.checkJourney}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Cards someone maintaining the product should look at: code moved under a passed promise, a promise broke, or the
 * map changed the card since they last looked. */
function changedCards(map: TreeMap, seenAt?: string) {
  const changed = new Set<string>();
  for (const card of Object.values(map.cards))
    if (card.promises.some((promise) => promise.status === 'recheck' || promise.status === 'failed'))
      changed.add(card.id);
  if (seenAt) for (const change of map.recent) if (change.at > seenAt) changed.add(change.cardId);
  return changed;
}

function ChangeKind({ kind }: { kind: string }) {
  const t = useMessages(messages);
  const tone = kind === 'check_failed' ? 'text-danger' : kind === 'check_passed' ? 'text-fg-muted' : 'text-interactive';
  return <span className={clsx('shrink-0 text-meta', tone)}>{t.changeKind(kind)}</span>;
}

/** The person's own calls on a card: how much it matters and when. Only a person sets them; pressing the chosen one
 * again clears it. */
function Decisions({
  card,
  onDecide,
}: {
  card: TreeCard;
  onDecide: (cardId: string, field: 'priority' | 'scope' | 'decision', value: string | null) => void;
}) {
  const t = useMessages(messages);
  const rows: {
    field: 'priority' | 'scope';
    label: string;
    current: string | null | undefined;
    options: [string, string][];
  }[] = [
    {
      field: 'priority',
      label: t.priorityTitle,
      current: card.priority,
      options: [
        ['must', t.priorityMust],
        ['should', t.priorityShould],
        ['later', t.priorityLater],
      ],
    },
    {
      field: 'scope',
      label: t.scopeTitle,
      current: card.scope,
      options: [
        ['now', t.scopeNow],
        ['next', t.scopeNext],
        ['out', t.scopeOut],
      ],
    },
  ];
  return (
    <section className="flex flex-col gap-2">
      {rows.map((row) => (
        <div key={row.field} className="flex items-center justify-between gap-3">
          <span className="text-meta text-fg-muted">{row.label}</span>
          <span
            role="radiogroup"
            aria-label={row.label}
            className="flex rounded-md border border-line bg-canvas-raised p-0.5"
          >
            {row.options.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={row.current === value}
                onClick={() => onDecide(card.id, row.field, row.current === value ? null : value)}
                className="cursor-pointer rounded-sm px-2 py-0.5 text-meta text-fg-muted transition-colors hover:text-fg aria-checked:bg-selected aria-checked:text-fg"
              >
                {label}
              </button>
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}
