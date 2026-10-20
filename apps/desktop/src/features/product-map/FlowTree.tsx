import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import {
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  DoorOpen,
  LoaderCircle,
  Plus,
  Route,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import {
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
import { layoutTree, stepId, type LaidNode } from './treeLayout';

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
  initialPerson?: string;
}

/** What the side panel shows: a card's details, a promise of a step, or a form for what a "+" card adds. */
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
      return `person:${focus.personId}`;
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
 * The product map read person first, as an even grid of cards. Each row is one journey, read left to right: the
 * journey, then its steps in the order they are walked, joined by arrows. A person's rows sit beside a band that says
 * who they are and how they come in. A step card carries its own promises in short, so the map reads without opening
 * anything; the panel on the right says what to do next and explains whatever is picked.
 */
export function FlowTree(props: FlowTreeProps) {
  const { map } = props;
  const first = map.people.find((person) => person.id === props.initialPerson) ?? map.people[0];
  const [focus, setFocus] = useState<Focus | null>(first ? { kind: 'person', personId: first.id } : null);
  const [hover, setHover] = useState<string | null>(null);
  const [notice, setNotice] = useState(0);
  const canvas = useRef<TreeCanvasHandle>(null);

  const nodes = useMemo(() => layoutTree(map), [map]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const focusId = focusNodeId(focus);

  // The row from the person to what is pointed at, or else to what is picked, lights up.
  const highlight = useMemo(() => {
    const lit = new Set<string>();
    let id = hover ?? focusId;
    while (id) {
      lit.add(id);
      id = byId.get(id)?.parent ?? null;
    }
    return lit;
  }, [hover, focusId, byId]);

  // Picking a journey or a step keeps its row clear and quiets the rest, so one strand can be followed.
  const strand = useMemo(() => {
    if (!focus || focus.kind === 'addPerson' || focus.kind === 'person' || focus.kind === 'addJourney') return null;
    return new Set(
      nodes
        .filter(
          (node) =>
            node.kind === 'product' || node.id === `person:${focus.personId}` || node.journeyId === focus.journeyId,
        )
        .map((node) => node.id),
    );
  }, [focus, nodes]);

  // The first view: the first person's band and rows, at a zoom where the cards read.
  const initialFocus = useMemo(
    () => (first ? nodes.filter((node) => node.personId === first.id).map((node) => node.id) : undefined),
    // Only the first layout decides the first view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(0), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const reveal = (id: string | null) => id && setTimeout(() => canvas.current?.reveal(id), 60);

  /** Picks a promise from the to-do list: its step's card comes into view and the panel explains the promise. */
  const show = (target: PromiseTarget, personId: string) => {
    const journey = map.people
      .find((candidate) => candidate.id === personId)
      ?.journeys.find((candidate) => candidate.steps.includes(target.cardId));
    if (!journey) return;
    setFocus({ kind: 'promise', personId, journeyId: journey.id, ...target });
    reveal(stepId(journey.id, target.cardId));
  };

  const removePromise = (target: PromiseTarget) => {
    props.onRemovePromise(target);
    if (focus?.kind === 'promise' && focus.promiseId === target.promiseId)
      setFocus({ kind: 'step', personId: focus.personId, journeyId: focus.journeyId, cardId: focus.cardId });
    setNotice(Date.now());
  };

  function press(node: LaidNode) {
    switch (node.kind) {
      case 'product':
        setFocus(null);
        canvas.current?.fit();
        return;
      case 'person':
        setFocus({ kind: 'person', personId: node.personId! });
        return;
      case 'journey':
        setFocus({ kind: 'journey', personId: node.personId!, journeyId: node.journeyId! });
        return;
      case 'step':
        setFocus({ kind: 'step', personId: node.personId!, journeyId: node.journeyId!, cardId: node.cardId! });
        return;
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
        highlight={highlight}
        strand={strand}
        initialFocus={initialFocus}
        renderNode={(node) => (
          <CardView
            node={node}
            map={map}
            picked={node.id === focusId}
            onHover={(on) => setHover(on ? node.id : null)}
            onPress={() => press(node)}
          />
        )}
        overlay={
          notice > 0 && (
            <RemovedNotice
              key={notice}
              onUndo={() => {
                props.onUndoRemove();
                setNotice(0);
              }}
            />
          )
        }
      />
      <aside className="flex w-88 shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas-sunken">
        <Panel
          key={focus?.kind === 'promise' ? `${focusId}/${focus.promiseId}` : (focusId ?? 'product')}
          map={map}
          focus={focus}
          person={person}
          props={props}
          onShow={show}
          onFocus={(next) => {
            setFocus(next);
            reveal(focusNodeId(next));
          }}
          onRemove={removePromise}
          onDone={setFocus}
        />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------- cards

const cardButton =
  'group flex size-full cursor-pointer flex-col text-left transition-[box-shadow,border-color,background-color] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive';
const pickedRing = 'ring-2 ring-interactive ring-offset-2 ring-offset-canvas';
const toneStripe = {
  1: 'bg-avatar-1-ink',
  2: 'bg-avatar-2-ink',
  3: 'bg-avatar-3-ink',
  4: 'bg-avatar-4-ink',
  5: 'bg-avatar-5-ink',
} as const;

/** One card per node, each kind with a small label on top that says what it is: 쓰는 사람, 여정, 단계. */
function CardView({
  node,
  map,
  picked,
  onHover,
  onPress,
}: {
  node: ShownNode;
  map: TreeMap;
  picked: boolean;
  onHover: (on: boolean) => void;
  onPress: () => void;
}) {
  const person = node.personId ? map.people.find((candidate) => candidate.id === node.personId) : undefined;
  const shell = (className: string, children: ReactNode) => (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPress}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={clsx(cardButton, className, picked && pickedRing)}
    >
      {children}
    </button>
  );
  switch (node.kind) {
    case 'product':
      return shell('justify-center rounded-xl px-1 hover:bg-hover', <ProductHeader map={map} />);
    case 'person':
      if (!person) return null;
      return shell(
        'relative overflow-hidden rounded-2xl border border-line bg-canvas-raised p-4 hover:border-interactive',
        <PersonBand map={map} person={person} />,
      );
    case 'journey': {
      const journey = person?.journeys.find((candidate) => candidate.id === node.journeyId);
      if (!journey) return null;
      return shell(
        'rounded-xl border border-line bg-canvas-raised p-3.5 hover:border-interactive',
        <JourneyCard map={map} journey={journey} number={node.index + 1} />,
      );
    }
    case 'step': {
      const card = map.cards[node.cardId!];
      if (!card) return null;
      const counts = tally(card.promises);
      return shell(
        clsx(
          'rounded-xl border bg-canvas-raised p-3.5',
          counts.failed ? 'border-danger' : 'border-line hover:border-interactive',
          counts.checking > 0 && 'motion-sweep',
        ),
        <StepCard card={card} number={node.index + 1} />,
      );
    }
    case 'addJourney':
    case 'addPerson':
      return shell(
        'flex-row items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-meta text-fg-muted hover:border-interactive hover:text-fg',
        <AddLabel kind={node.kind} />,
      );
  }
}

function CardLabel({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <span className="flex h-5 shrink-0 items-center justify-between gap-2 text-meta text-fg-muted">
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      {end}
    </span>
  );
}

/** The loudest thing under a card, or how much passes when nothing is wrong. */
function CardStatus({ counts }: { counts: Tally }) {
  const t = useMessages(messages);
  const loud = (['failed', 'checking', 'blocked'] as PromiseStatus[]).find((status) => counts[status] > 0);
  if (loud) return <StatusMark status={loud} count={counts[loud]} />;
  if (!counts.total) return null;
  if (counts.passed === counts.total) return <StatusMark status="passed" />;
  return <span className="tabular-nums">{t.passedOf(counts.passed, counts.total)}</span>;
}

function CardFooter({ left, counts }: { left: ReactNode; counts: Tally }) {
  return (
    <span className="mt-auto flex shrink-0 items-center gap-3 pt-2 text-meta text-fg-muted">
      <span className="shrink-0 tabular-nums">{left}</span>
      {counts.total > 0 && <Progress counts={counts} wide />}
    </span>
  );
}

function ProductHeader({ map }: { map: TreeMap }) {
  const t = useMessages(messages);
  const all = tally(Object.values(map.cards).flatMap((card) => card.promises));
  const journeys = map.people.reduce((sum, person) => sum + person.journeys.length, 0);
  return (
    <span className="flex items-baseline gap-4">
      <span className="text-display">{map.product}</span>
      <span className="text-fg-muted tabular-nums">
        {t.productSummary(map.people.length, journeys, all.passed, all.total)}
      </span>
    </span>
  );
}

function PersonBand({ map, person }: { map: TreeMap; person: Person }) {
  const t = useMessages(messages);
  const text = useText();
  const counts = personTally(map, person);
  return (
    <>
      <span aria-hidden className={clsx('absolute inset-x-0 top-0 h-1', toneStripe[person.tone])} />
      <span className="flex flex-col gap-3">
        <CardLabel>{t.personLabel}</CardLabel>
        <span className="flex items-center gap-3">
          <Avatar person={person} large />
          <span className="min-w-0">
            <span className="block text-title">{text(person.name)}</span>
            <span className="line-clamp-2 text-meta text-fg-muted">{text(person.role)}</span>
          </span>
        </span>
        {text(person.start) && (
          <span className="flex items-start gap-2 rounded-lg bg-canvas-sunken px-2.5 py-2">
            <DoorOpen size={14} aria-hidden className="mt-0.5 shrink-0 text-interactive" />
            <span className="min-w-0">
              <span className="block text-meta text-fg-muted">{t.startsWith}</span>
              <span className="block">{text(person.start)}</span>
            </span>
          </span>
        )}
        <span className="flex flex-col gap-1.5">
          <span className={clsx('text-meta tabular-nums', counts.failed ? 'text-danger' : 'text-fg-muted')}>
            {counts.failed ? t.todoFailed(counts.failed) : t.promiseSummary(counts.passed, counts.total)}
          </span>
          {counts.total > 0 && <Progress counts={counts} wide />}
        </span>
      </span>
    </>
  );
}

function JourneyCard({ map, journey, number }: { map: TreeMap; journey: Journey; number: number }) {
  const t = useMessages(messages);
  const text = useText();
  const counts = journeyTally(map, journey);
  return (
    <>
      <CardLabel end={<CardStatus counts={counts} />}>
        <Route size={13} aria-hidden className="shrink-0" />
        {t.journeyLabel(number)}
      </CardLabel>
      <span className="mt-1.5 line-clamp-2 text-title">{text(journey.title)}</span>
      {text(journey.goal) && <span className="mt-1 line-clamp-2 text-meta text-fg-muted">{text(journey.goal)}</span>}
      <CardFooter left={t.stepsCount(journey.steps.length)} counts={counts} />
    </>
  );
}

/** Worst first, so the card shows what needs a look before what is fine. */
const PREVIEW_ORDER: PromiseStatus[] = ['failed', 'checking', 'blocked', 'planned', 'unconfirmed', 'passed'];

function StepCard({ card, number }: { card: TreeCard; number: number }) {
  const t = useMessages(messages);
  const counts = tally(card.promises);
  const preview = [...card.promises]
    .sort((a, b) => PREVIEW_ORDER.indexOf(a.status) - PREVIEW_ORDER.indexOf(b.status))
    .slice(0, 2);
  return (
    <>
      <CardLabel end={<CardStatus counts={counts} />}>
        <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-interactive text-on-fill tabular-nums">
          {number}
        </span>
        {t.stepLabel}
      </CardLabel>
      <span className="mt-1.5 line-clamp-2 font-medium">{card.title}</span>
      <span className="mt-2 flex flex-col gap-0.5">
        {preview.map((promise) => (
          <PromiseLine key={promise.id} status={promise.status} text={promise.when || promise.then} />
        ))}
      </span>
      <CardFooter left={t.stepPromises(counts.total)} counts={counts} />
    </>
  );
}

const lineIcons: Record<PromiseStatus, [typeof Circle, string]> = {
  failed: [CircleX, 'text-danger'],
  checking: [LoaderCircle, 'text-interactive motion-spin'],
  blocked: [CircleSlash, 'text-attention'],
  unconfirmed: [Circle, 'text-fg-faint'],
  planned: [CircleDashed, 'text-fg-faint'],
  passed: [CircleCheck, 'text-fg-muted'],
};

/** One promise in a card: its icon (the same set the panel words) and its situation, cut to one line. */
function PromiseLine({ status, text }: { status: PromiseStatus; text: string }) {
  const settled = useSettled(status);
  const [Icon, color] = lineIcons[status];
  return (
    <span
      className={clsx(
        'flex min-w-0 items-center gap-1.5 rounded-sm text-meta',
        status === 'failed' ? 'text-danger' : 'text-fg-muted',
        settled && 'motion-arrive',
      )}
    >
      <Icon size={12} aria-hidden className={clsx('shrink-0', color)} />
      <span className="truncate">{text}</span>
    </span>
  );
}

function AddLabel({ kind }: { kind: 'addJourney' | 'addPerson' }) {
  const t = useMessages(messages);
  return (
    <>
      <Plus size={13} aria-hidden />
      {kind === 'addJourney' ? t.addJourney : t.addPerson}
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
              <InlineAdd
                label={t.addPromise}
                fields={[t.whenPlaceholder, t.thenPlaceholder]}
                onAdd={([when, then]) => props.onAddPromise(focus.cardId, when!, then ?? '')}
              />
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
          variant={counts.failed ? 'secondary' : 'primary'}
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
            {recent.slice(0, 6).map((change) => (
              <li
                key={`${change.at}-${change.cardId}`}
                className="flex flex-col gap-0.5 border-t border-line-subtle py-2 first:border-t-0"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">{map.cards[change.cardId]?.title}</span>
                  <StatusMark status={change.kind === 'check_blocked' ? 'blocked' : 'passed'} />
                </span>
                <span className="line-clamp-2 text-meta text-fg-muted">{change.detail}</span>
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
