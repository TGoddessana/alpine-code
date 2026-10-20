import { Button, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, DoorOpen, LoaderCircle, Plus } from 'lucide-react';
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
import { layoutTree, promiseNodeId, stepId, type LaidNode, type Openness } from './treeLayout';

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

/** What the side panel shows: a node's details, or a form for what a "+" node adds. */
type Focus =
  | { kind: 'person'; personId: string }
  | { kind: 'journey'; personId: string; journeyId: string }
  | { kind: 'step'; personId: string; journeyId: string; cardId: string }
  | { kind: 'promise'; personId: string; journeyId: string; cardId: string; promiseId: string }
  | { kind: 'addPromise'; personId: string; journeyId: string; cardId: string }
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
      return stepId(focus.journeyId, focus.cardId);
    case 'promise':
      return promiseNodeId(focus.journeyId, focus.cardId, focus.promiseId);
    case 'addPromise':
      return `add-promise:${focus.journeyId}/${focus.cardId}`;
    case 'addJourney':
      return `add-journey:${focus.personId}`;
    case 'addPerson':
      return 'add-person';
  }
};

/**
 * The product map read person first, drawn as a tree on a canvas: the product, the people who use it, the journeys
 * each takes and the steps of a journey in the order they are walked; every promise hangs off its step as a branch
 * whose line says whether it holds. The panel on the right says what to do next and explains whatever is picked.
 */
export function FlowTree(props: FlowTreeProps) {
  const { map } = props;
  const first = map.people.find((person) => person.id === props.initialPerson) ?? map.people[0];
  const [open, setOpen] = useState<Openness>(() => firstOpen(first));
  const [focus, setFocus] = useState<Focus | null>(first ? { kind: 'person', personId: first.id } : null);
  const [hover, setHover] = useState<string | null>(null);
  const [notice, setNotice] = useState(0);
  const canvas = useRef<TreeCanvasHandle>(null);

  const nodes = useMemo(() => layoutTree(map, open), [map, open]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const focusId = focusNodeId(focus);

  // The line from the product to what is pointed at, or else to what is picked, lights up.
  const highlight = useMemo(() => {
    const lit = new Set<string>();
    let id = hover ?? focusId;
    while (id) {
      lit.add(id);
      id = byId.get(id)?.parent ?? null;
    }
    return lit;
  }, [hover, focusId, byId]);

  const initialFocus = useMemo(() => {
    const journey = first?.journeys[0];
    return first
      ? ['product', 'person:', ...(journey ? [`journey:${journey.id}`, `step:${journey.id}/`] : [])]
      : undefined;
  }, [first]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(0), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggle = (key: keyof Openness, id: string, force?: boolean) =>
    setOpen((current) => {
      const set = new Set(current[key]);
      if (force ?? !set.has(id)) set.add(id);
      else set.delete(id);
      return { ...current, [key]: set };
    });

  /** Opens everything above a promise, picks it and brings it into view once it has grown in. */
  const show = (target: PromiseTarget, personId: string) => {
    const person = map.people.find((candidate) => candidate.id === personId);
    const journey = person?.journeys.find((candidate) => candidate.steps.includes(target.cardId));
    if (!person || !journey) return;
    setOpen((current) => ({
      people: new Set(current.people).add(person.id),
      journeys: new Set(current.journeys).add(journey.id),
      steps: new Set(current.steps).add(stepId(journey.id, target.cardId)),
    }));
    setFocus({ kind: 'promise', personId, journeyId: journey.id, ...target });
    setTimeout(() => canvas.current?.reveal(promiseNodeId(journey.id, target.cardId, target.promiseId)), 420);
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
        toggle('people', node.personId!);
        setFocus({ kind: 'person', personId: node.personId! });
        return;
      case 'journey':
        toggle('journeys', node.journeyId!);
        setFocus({ kind: 'journey', personId: node.personId!, journeyId: node.journeyId! });
        return;
      case 'step': {
        const picked = focusId === node.id;
        toggle('steps', node.id, picked ? undefined : true);
        setFocus({ kind: 'step', personId: node.personId!, journeyId: node.journeyId!, cardId: node.cardId! });
        return;
      }
      case 'promise':
        setFocus({
          kind: 'promise',
          personId: node.personId!,
          journeyId: node.journeyId!,
          cardId: node.cardId!,
          promiseId: node.promiseId!,
        });
        return;
      case 'addPromise':
        setFocus({ kind: 'addPromise', personId: node.personId!, journeyId: node.journeyId!, cardId: node.cardId! });
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
        initialFocus={initialFocus}
        renderNode={(node) => (
          <NodeView
            node={node}
            map={map}
            open={open}
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
          key={focusId ?? 'product'}
          map={map}
          focus={focus}
          person={person}
          props={props}
          onShow={show}
          onFocus={(next) => {
            setFocus(next);
            const id = focusNodeId(next);
            if ('journeyId' in next) {
              setOpen((current) => ({
                ...current,
                people: new Set(current.people).add(next.personId),
                journeys: new Set(current.journeys).add(next.journeyId),
              }));
            } else if (next.kind === 'person') {
              setOpen((current) => ({ ...current, people: new Set(current.people).add(next.personId) }));
            }
            if (id) setTimeout(() => canvas.current?.reveal(id), 420);
          }}
          onRemove={removePromise}
          onDone={setFocus}
        />
      </aside>
    </div>
  );
}

function firstOpen(person: Person | undefined): Openness {
  const journey = person?.journeys[0];
  return {
    people: new Set(person ? [person.id] : []),
    journeys: new Set(journey ? [journey.id] : []),
    steps: new Set(journey?.steps[0] ? [stepId(journey.id, journey.steps[0])] : []),
  };
}

// ---------------------------------------------------------------- nodes

const nodeButton =
  'group size-full cursor-pointer text-left transition-[box-shadow,border-color,background-color] duration-(--motion-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-interactive';
const pickedRing = 'ring-2 ring-interactive ring-offset-2 ring-offset-canvas';

/** Every node is one button: pressing it opens or closes what hangs off it and explains it in the panel. */
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
  open: Openness;
  picked: boolean;
  onHover: (on: boolean) => void;
  onPress: () => void;
}) {
  const shell = (className: string, children: ReactNode) => (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPress}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={clsx(nodeButton, className, picked && pickedRing)}
    >
      {children}
    </button>
  );
  switch (node.kind) {
    case 'product':
      return shell(
        'flex flex-col justify-center rounded-2xl bg-brand-ink px-4 text-on-fill shadow-overlay',
        <ProductBody map={map} />,
      );
    case 'person': {
      const person = map.people.find((candidate) => candidate.id === node.personId);
      if (!person) return null;
      return shell(
        'rounded-2xl border border-line bg-canvas-raised p-3 shadow-overlay hover:border-interactive',
        <PersonBody map={map} person={person} open={open.people.has(person.id)} />,
      );
    }
    case 'journey': {
      const journey = map.people
        .find((candidate) => candidate.id === node.personId)
        ?.journeys.find((candidate) => candidate.id === node.journeyId);
      if (!journey) return null;
      return shell(
        'rounded-xl border border-line bg-canvas-raised p-3 hover:border-interactive',
        <JourneyBody map={map} journey={journey} number={node.index + 1} open={open.journeys.has(journey.id)} />,
      );
    }
    case 'step':
      return shell(
        'rounded-xl border border-line bg-canvas-raised p-3 hover:border-interactive',
        <StepBody map={map} node={node} open={open.steps.has(node.id)} />,
      );
    case 'promise': {
      const promise = map.cards[node.cardId!]?.promises.find((item) => item.id === node.promiseId);
      if (!promise) return null;
      return (
        <PromiseNode status={promise.status} when={promise.when} picked={picked} onHover={onHover} onPress={onPress} />
      );
    }
    case 'addPromise':
    case 'addJourney':
    case 'addPerson':
      return shell(
        'flex items-center gap-1.5 rounded-lg border border-dashed border-line bg-canvas px-3 text-meta text-fg-muted hover:border-interactive hover:text-fg',
        <AddBody kind={node.kind} />,
      );
  }
}

function ProductBody({ map }: { map: TreeMap }) {
  const t = useMessages(messages);
  return (
    <>
      <span className="text-meta opacity-70">{t.product}</span>
      <span className="truncate text-title">{map.product}</span>
      <span className="text-meta opacity-70">{t.peopleCount(map.people.length)}</span>
    </>
  );
}

function PersonBody({ map, person, open }: { map: TreeMap; person: Person; open: boolean }) {
  const t = useMessages(messages);
  const text = useText();
  const counts = personTally(map, person);
  return (
    <span className="flex h-full flex-col justify-between gap-2">
      <span className="flex items-start gap-3">
        <Avatar person={person} />
        <span className="min-w-0 grow">
          <span className="block truncate text-title">{text(person.name)}</span>
          <span className="block truncate text-meta text-fg-muted">{text(person.role)}</span>
        </span>
        <ChevronRight
          size={14}
          aria-hidden
          className={clsx(
            'mt-1 shrink-0 text-fg-muted transition-transform duration-(--motion-normal)',
            open && 'rotate-180',
          )}
        />
      </span>
      <span className="flex items-center gap-2">
        <Progress counts={counts} wide />
        <span className={clsx('shrink-0 text-meta tabular-nums', counts.failed ? 'text-danger' : 'text-fg-muted')}>
          {counts.failed ? `${t.failed} ${counts.failed}` : t.passedOf(counts.passed, counts.total)}
        </span>
      </span>
    </span>
  );
}

function JourneyBody({
  map,
  journey,
  number,
  open,
}: {
  map: TreeMap;
  journey: Journey;
  number: number;
  open: boolean;
}) {
  const t = useMessages(messages);
  const text = useText();
  const counts = journeyTally(map, journey);
  return (
    <span className="flex h-full flex-col justify-between gap-1.5">
      <span className="flex items-start gap-2">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-canvas-sunken text-meta text-fg-muted tabular-nums">
          {number}
        </span>
        <span className="line-clamp-2 min-w-0 grow">{text(journey.title)}</span>
        <ChevronRight
          size={14}
          aria-hidden
          className={clsx(
            'mt-1 shrink-0 text-fg-muted transition-transform duration-(--motion-normal)',
            open && 'rotate-180',
          )}
        />
      </span>
      <span className="flex items-center gap-2">
        {counts.total > 0 ? (
          <>
            <Progress counts={counts} wide />
            {counts.failed > 0 ? (
              <StatusMark status="failed" count={counts.failed} />
            ) : counts.checking > 0 ? (
              <StatusMark status="checking" count={counts.checking} />
            ) : (
              <span className="shrink-0 text-meta text-fg-muted tabular-nums">
                {t.passedOf(counts.passed, counts.total)}
              </span>
            )}
          </>
        ) : (
          <span className="text-meta text-fg-muted">{t.stepsCount(journey.steps.length)}</span>
        )}
      </span>
    </span>
  );
}

function StepBody({ map, node, open }: { map: TreeMap; node: LaidNode; open: boolean }) {
  const t = useMessages(messages);
  const card = map.cards[node.cardId!];
  if (!card) return null;
  const counts = tally(card.promises);
  const loud = (['failed', 'checking', 'blocked'] as PromiseStatus[]).find((status) => counts[status] > 0);
  return (
    <span className="flex h-full flex-col justify-between gap-1.5">
      <span className="flex items-center justify-between gap-2">
        <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-interactive text-meta text-on-fill tabular-nums">
          {node.index + 1}
        </span>
        {loud ? (
          <StatusMark status={loud} count={counts[loud]} />
        ) : (
          <span className="text-meta text-fg-muted tabular-nums">{t.passedOf(counts.passed, counts.total)}</span>
        )}
      </span>
      <span className="line-clamp-2">{card.title}</span>
      <span className="flex items-center gap-1 text-meta text-fg-muted">
        {t.stepPromises(counts.total)}
        <ChevronDown
          size={13}
          aria-hidden
          className={clsx('transition-transform duration-(--motion-normal)', open && 'rotate-180')}
        />
      </span>
    </span>
  );
}

function PromiseNode({
  status,
  when,
  picked,
  onHover,
  onPress,
}: {
  status: PromiseStatus;
  when: string;
  picked: boolean;
  onHover: (on: boolean) => void;
  onPress: () => void;
}) {
  const t = useMessages(messages);
  const settled = useSettled(status);
  return (
    <button
      type="button"
      aria-pressed={picked}
      onClick={onPress}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={clsx(
        nodeButton,
        'flex items-center gap-2 rounded-lg border bg-canvas-raised px-3',
        status === 'failed'
          ? 'border-danger'
          : status === 'blocked'
            ? 'border-attention'
            : 'border-line hover:border-interactive',
        status === 'checking' && 'motion-sweep',
        settled && 'motion-arrive',
        picked && pickedRing,
      )}
    >
      <span className="min-w-0 grow truncate">{when || t.always}</span>
      <StatusMark status={status} />
    </button>
  );
}

function AddBody({ kind }: { kind: 'addPromise' | 'addJourney' | 'addPerson' }) {
  const t = useMessages(messages);
  return (
    <>
      <Plus size={13} aria-hidden />
      {kind === 'addPromise' ? t.addPromise : kind === 'addJourney' ? t.addJourney : t.addPerson}
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
    case 'addPromise': {
      const back: Focus = { kind: 'step', personId: person.id, journeyId: focus.journeyId, cardId: focus.cardId };
      return (
        <PanelForm title={t.addPromise} lead={map.cards[focus.cardId]?.title}>
          <InlineAdd
            startOpen
            label={t.addPromise}
            fields={[t.whenPlaceholder, t.thenPlaceholder]}
            onAdd={([when, then]) => {
              props.onAddPromise(focus.cardId, when!, then ?? '');
              onDone(back);
            }}
            onCancel={() => onDone(back)}
          />
        </PanelForm>
      );
    }
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
