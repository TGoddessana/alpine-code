import { Button, Collapse, Input, LinkButton, Menu } from '@alpine/ui/primitives';
import clsx from 'clsx';
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  DoorOpen,
  Ellipsis,
  LoaderCircle,
  Plus,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { useFormat, useLocale, useMessages } from '@/shared/i18n';

import {
  journeyTally,
  otherJourneys,
  personCards,
  personTally,
  promisesWith,
  tally,
  worst,
  type Journey,
  type Localized,
  type Person,
  type PromiseStatus,
  type Tally,
  type TreeMap,
  type TreePromise,
} from './flowTreeModel';
import { flowTreeMessages as messages } from './flowTreeMessages';

export interface PromiseTarget {
  cardId: string;
  promiseId: string;
}

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

type Selection = { journeyId: string; cardId: string; promiseId?: string } | null;
/** Where the pointer is in a journey: the line from the person's entry down to it lights up. */
type Path = { journeyId: string; step: number; promise: number | null } | null;

const stepKey = (journeyId: string, cardId: string) => `${journeyId}/${cardId}`;

/**
 * The product map read person first. The left column lists who uses the product; picking someone shows their tree:
 * where they come in, the journeys they take, the steps of each journey and, as branches off every step, the promises
 * ("when this happens, this must happen") with whether each one holds. The right column explains whatever is picked.
 */
export function FlowTree(props: FlowTreeProps) {
  const { map, initialPerson } = props;
  const [personId, setPersonId] = useState(initialPerson ?? map.people[0]?.id ?? '');
  const person = map.people.find((candidate) => candidate.id === personId) ?? map.people[0];
  const [openJourneys, setOpenJourneys] = useState(() => firstOpen(person).journeys);
  const [openSteps, setOpenSteps] = useState(() => firstOpen(person).steps);
  const [selection, setSelection] = useState<Selection>(null);
  const [hover, setHover] = useState<Path>(null);
  const [notice, setNotice] = useState(0);
  const text = useText();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(0), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!person) return null;

  const pick = (id: string) => {
    const next = map.people.find((candidate) => candidate.id === id);
    if (!next || id === person.id) return;
    const opened = firstOpen(next);
    setPersonId(id);
    setOpenJourneys(opened.journeys);
    setOpenSteps(opened.steps);
    setSelection(null);
    setHover(null);
  };

  const toggle = (set: Set<string>, key: string, force?: boolean) => {
    const next = new Set(set);
    if (force ?? !next.has(key)) next.add(key);
    else next.delete(key);
    return next;
  };

  const selectedPath = pathOf(map, person, selection);
  const path = hover ?? selectedPath;

  return (
    <div className="flex h-full min-h-0 w-full bg-canvas text-body text-fg">
      <PeopleRail map={map} current={person.id} onPick={pick} onAdd={props.onAddPerson} />
      <main className="relative min-w-0 grow overflow-y-auto" onMouseLeave={() => setHover(null)}>
        <div key={person.id} className="motion-step mx-auto flex max-w-180 flex-col gap-6 px-8 pt-7 pb-24">
          <PersonHeader
            map={map}
            person={person}
            onCheck={props.onCheck}
            onFix={props.onFix}
            onShow={(target) => {
              const journey = person.journeys.find((candidate) => candidate.steps.includes(target.cardId));
              if (!journey) return;
              setOpenJourneys((set) => toggle(set, journey.id, true));
              setOpenSteps((set) => toggle(set, stepKey(journey.id, target.cardId), true));
              setSelection({ journeyId: journey.id, ...target });
            }}
          />
          <div>
            <EntryPoint text={text(person.start)} />
            <ol aria-label={text(person.name)}>
              {person.journeys.map((journey, index) => (
                <JourneyBranch
                  key={journey.id}
                  map={map}
                  journey={journey}
                  number={index + 1}
                  last={index === person.journeys.length - 1}
                  open={openJourneys.has(journey.id)}
                  onToggle={() => setOpenJourneys((set) => toggle(set, journey.id))}
                  openSteps={openSteps}
                  onToggleStep={(cardId, force) =>
                    setOpenSteps((set) => toggle(set, stepKey(journey.id, cardId), force))
                  }
                  selection={selection}
                  onSelect={setSelection}
                  path={path?.journeyId === journey.id ? path : null}
                  onHover={setHover}
                  actions={{
                    ...props,
                    onRemovePromise: (target) => {
                      props.onRemovePromise(target);
                      if (selection?.promiseId === target.promiseId) setSelection(null);
                      setNotice(Date.now());
                    },
                  }}
                />
              ))}
            </ol>
            <AddJourney onAdd={(title, goal) => props.onAddJourney(person.id, title, goal)} />
          </div>
        </div>
        {notice > 0 && (
          <RemovedNotice
            key={notice}
            onUndo={() => {
              props.onUndoRemove();
              setNotice(0);
            }}
          />
        )}
      </main>
      <aside className="flex w-88 shrink-0 flex-col overflow-y-auto border-l border-line bg-canvas-sunken">
        <Detail
          key={selection ? `${selection.journeyId}/${selection.cardId}/${selection.promiseId ?? ''}` : 'recent'}
          map={map}
          person={person}
          selection={selection}
          onSelect={setSelection}
          onCheck={props.onCheck}
          onFix={props.onFix}
          onRemove={(target) => {
            props.onRemovePromise(target);
            setSelection(selection ? { journeyId: selection.journeyId, cardId: selection.cardId } : null);
            setNotice(Date.now());
          }}
        />
      </aside>
    </div>
  );
}

function firstOpen(person: Person | undefined) {
  const journey = person?.journeys[0];
  return {
    journeys: new Set(journey ? [journey.id] : []),
    steps: new Set(journey?.steps[0] ? [stepKey(journey.id, journey.steps[0])] : []),
  };
}

function pathOf(map: TreeMap, person: Person, selection: Selection): Path {
  if (!selection) return null;
  const journey = person.journeys.find((candidate) => candidate.id === selection.journeyId);
  if (!journey) return null;
  const promises = map.cards[selection.cardId]?.promises ?? [];
  const promise = selection.promiseId ? promises.findIndex((item) => item.id === selection.promiseId) : -1;
  return {
    journeyId: journey.id,
    step: journey.steps.indexOf(selection.cardId),
    promise: promise >= 0 ? promise : null,
  };
}

function useText() {
  const { locale } = useLocale();
  return (text: Localized) => text[locale];
}

// ---------------------------------------------------------------- people

const tones = {
  1: 'bg-avatar-1 text-avatar-1-ink',
  2: 'bg-avatar-2 text-avatar-2-ink',
  3: 'bg-avatar-3 text-avatar-3-ink',
  4: 'bg-avatar-4 text-avatar-4-ink',
  5: 'bg-avatar-5 text-avatar-5-ink',
} as const;

function Avatar({ person, large }: { person: Person; large?: boolean }) {
  const text = useText();
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full',
        tones[person.tone],
        large ? 'size-12 text-title' : 'size-8 text-body',
      )}
    >
      {[...text(person.name)][0]}
    </span>
  );
}

function PeopleRail({
  map,
  current,
  onPick,
  onAdd,
}: {
  map: TreeMap;
  current: string;
  onPick: (id: string) => void;
  onAdd: (name: string) => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  return (
    <nav aria-label={t.people} className="flex w-60 shrink-0 flex-col border-r border-line bg-canvas-sunken">
      <div className="px-4 pt-6 pb-3">
        <p className="text-meta text-fg-muted">{map.product}</p>
        <h2 className="text-title">{t.people}</h2>
      </div>
      <ul className="flex flex-col gap-0.5 overflow-y-auto px-2">
        {map.people.map((person) => {
          const counts = personTally(map, person);
          const on = person.id === current;
          return (
            <li key={person.id}>
              <button
                type="button"
                aria-current={on}
                onClick={() => onPick(person.id)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover aria-[current=true]:bg-selected"
              >
                <Avatar person={person} />
                <span className="min-w-0 grow">
                  <span className="block truncate">{text(person.name)}</span>
                  <span className={clsx('block truncate text-meta', counts.failed ? 'text-danger' : 'text-fg-muted')}>
                    {counts.failed ? `${t.failed} ${counts.failed}` : t.passedOf(counts.passed, counts.total)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto border-t border-line-subtle p-2">
        <InlineAdd label={t.addPerson} fields={[t.personPlaceholder]} onAdd={([name]) => onAdd(name!)} />
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------- person header

function PersonHeader({
  map,
  person,
  onCheck,
  onFix,
  onShow,
}: {
  map: TreeMap;
  person: Person;
  onCheck: (targets: PromiseTarget[]) => void;
  onFix: (targets: PromiseTarget[]) => void;
  onShow: (target: PromiseTarget) => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  const counts = personTally(map, person);
  const targets = (statuses: PromiseStatus[]) =>
    promisesWith(map, person, statuses).map(({ cardId, promise }) => ({ cardId, promiseId: promise.id }));

  const todo: { key: string; text: string; action?: ReactNode; tone?: 'danger' | 'attention' }[] = [];
  if (counts.failed)
    todo.push({
      key: 'failed',
      text: t.todoFailed(counts.failed),
      tone: 'danger',
      action: (
        <span className="flex shrink-0 items-center gap-3">
          <LinkButton onClick={() => onShow(targets(['failed'])[0]!)}>{t.todoShow}</LinkButton>
          <Button variant="primary" onClick={() => onFix(targets(['failed']))}>
            {t.todoFix}
          </Button>
        </span>
      ),
    });
  if (counts.blocked)
    todo.push({
      key: 'blocked',
      text: t.todoBlocked(counts.blocked),
      tone: 'attention',
      action: <LinkButton onClick={() => onShow(targets(['blocked'])[0]!)}>{t.todoWhy}</LinkButton>,
    });
  if (counts.planned)
    todo.push({
      key: 'planned',
      text: t.todoPlanned(counts.planned),
      action: <Button onClick={() => onCheck(targets(['planned']))}>{t.todoMatch}</Button>,
    });
  if (counts.unconfirmed)
    todo.push({
      key: 'unconfirmed',
      text: t.todoUnconfirmed(counts.unconfirmed),
      action: (
        <Button variant={counts.failed ? 'secondary' : 'primary'} onClick={() => onCheck(targets(['unconfirmed']))}>
          {t.todoCheck}
        </Button>
      ),
    });

  return (
    <header className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Avatar person={person} large />
        <div className="min-w-0">
          <h1 className="text-display">{text(person.name)}</h1>
          <p className="text-body text-fg-muted">{text(person.role)}</p>
        </div>
      </div>
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-title tabular-nums">
            {counts.total ? t.promiseSummary(counts.passed, counts.total) : t.noPromises}
          </span>
          <span className="text-meta text-fg-muted">{t.journeys(person.journeys.length)}</span>
        </div>
        {counts.total > 0 && <Progress counts={counts} wide />}
        {counts.checking > 0 && (
          <p role="status" className="motion-step flex items-center gap-2 text-meta text-interactive">
            <LoaderCircle size={13} aria-hidden className="motion-spin" />
            {t.todoChecking(counts.checking)}
          </p>
        )}
        <ul className="mt-1 flex flex-col">
          {todo.length === 0 && counts.total > 0 && counts.checking === 0 && (
            <li className="flex items-center gap-2 py-2 text-fg-muted">
              <CircleCheck size={14} aria-hidden className="text-fg" />
              {t.allPassed}
            </li>
          )}
          {todo.slice(0, 3).map((item) => (
            <li
              key={item.key}
              className="motion-step flex min-h-11 items-center justify-between gap-3 border-t border-line-subtle py-1.5 first:border-t-0"
            >
              <span
                className={clsx(
                  'flex items-center gap-2',
                  item.tone === 'danger' && 'text-danger',
                  item.tone === 'attention' && 'text-attention',
                )}
              >
                {item.text}
              </span>
              {item.action}
            </li>
          ))}
        </ul>
      </section>
    </header>
  );
}

/** The root of a person's tree: how they come in. Every journey hangs off its line. */
function EntryPoint({ text }: { text: string }) {
  const t = useMessages(messages);
  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-line bg-canvas-raised px-3 py-2.5">
      <DoorOpen size={16} aria-hidden className="shrink-0 text-interactive" />
      <span className="min-w-0">
        <span className="block text-meta text-fg-muted">{t.startsWith}</span>
        <span className="block">{text}</span>
      </span>
    </div>
  );
}

function Progress({ counts, wide }: { counts: Tally; wide?: boolean }) {
  const share = counts.total ? (counts.passed / counts.total) * 100 : 0;
  return (
    <span
      aria-hidden
      className={clsx('block overflow-hidden rounded-full bg-line-subtle', wide ? 'h-1.5 w-full' : 'h-1 w-14')}
    >
      <span
        className="block h-full rounded-full bg-interactive"
        style={{ width: `${share}%`, transition: 'width var(--motion-panel) var(--motion-ease)' }}
      />
    </span>
  );
}

// ---------------------------------------------------------------- journeys and steps

interface BranchActions {
  onCheck: (targets: PromiseTarget[]) => void;
  onFix: (targets: PromiseTarget[]) => void;
  onAddPromise: (cardId: string, when: string, then: string) => void;
  onRemovePromise: (target: PromiseTarget) => void;
  onFindSteps: (journeyId: string) => void;
}

/** A tree line in the gutter: `on` paints it as part of the path to what is pointed at. */
const line = (on: boolean) => (on ? 'border-interactive' : 'border-line');

function JourneyBranch({
  map,
  journey,
  number,
  last,
  open,
  onToggle,
  openSteps,
  onToggleStep,
  selection,
  onSelect,
  path,
  onHover,
  actions,
}: {
  map: TreeMap;
  journey: Journey;
  number: number;
  last: boolean;
  open: boolean;
  onToggle: () => void;
  openSteps: Set<string>;
  onToggleStep: (cardId: string, force?: boolean) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  path: Path;
  onHover: (path: Path) => void;
  actions: BranchActions;
}) {
  const t = useMessages(messages);
  const text = useText();
  const counts = journeyTally(map, journey);
  const onPath = path !== null;
  return (
    <li
      className={clsx(
        'relative ml-5 pl-6',
        'before:absolute before:top-0 before:left-0 before:h-4.5 before:w-4 before:rounded-bl-lg before:border-b before:border-l before:transition-colors',
        onPath ? 'before:border-interactive' : 'before:border-line',
        !last && 'after:absolute after:top-4.5 after:bottom-0 after:left-0 after:border-l after:border-line',
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        onMouseEnter={() => onHover(null)}
        className="group flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-hover"
      >
        <ChevronRight
          size={14}
          aria-hidden
          className={clsx(
            'mt-1 shrink-0 text-fg-muted transition-transform duration-(--motion-normal)',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 grow">
          <span className="block text-title">
            <span className="mr-2 text-fg-faint tabular-nums">{number}</span>
            {text(journey.title)}
          </span>
          <span className="block text-meta text-fg-muted">{text(journey.goal)}</span>
        </span>
        <span className={clsx('mt-1 flex shrink-0 items-center gap-2', counts.total === 0 && 'hidden')}>
          {counts.failed > 0 ? (
            <StatusMark status="failed" count={counts.failed} />
          ) : counts.checking > 0 ? (
            <StatusMark status="checking" count={counts.checking} />
          ) : (
            <span className="text-meta text-fg-muted tabular-nums">{t.passedOf(counts.passed, counts.total)}</span>
          )}
          <Progress counts={counts} />
        </span>
      </button>
      <Collapse open={open}>
        {journey.steps.length === 0 ? (
          <div className="flex items-center justify-between gap-3 py-3 pr-2 pl-8 text-fg-muted">
            <span>{t.noSteps}</span>
            <Button onClick={() => actions.onFindSteps(journey.id)}>{t.findSteps}</Button>
          </div>
        ) : (
          <ol className="relative pt-1 pb-3 pl-2">
            <span
              aria-hidden
              className={clsx(
                'absolute top-0 left-4.5 h-2 border-l transition-colors',
                line(path !== null && path.step >= 0),
              )}
            />
            {journey.steps.map((cardId, index) => (
              <StepBranch
                key={cardId}
                map={map}
                journey={journey}
                cardId={cardId}
                index={index}
                last={index === journey.steps.length - 1}
                open={openSteps.has(stepKey(journey.id, cardId))}
                onToggle={(force) => onToggleStep(cardId, force)}
                selection={selection}
                onSelect={onSelect}
                path={path}
                onHover={onHover}
                actions={actions}
              />
            ))}
          </ol>
        )}
      </Collapse>
    </li>
  );
}

function StepBranch({
  map,
  journey,
  cardId,
  index,
  last,
  open,
  onToggle,
  selection,
  onSelect,
  path,
  onHover,
  actions,
}: {
  map: TreeMap;
  journey: Journey;
  cardId: string;
  index: number;
  last: boolean;
  open: boolean;
  onToggle: (force?: boolean) => void;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  path: Path;
  onHover: (path: Path) => void;
  actions: BranchActions;
}) {
  const t = useMessages(messages);
  const card = map.cards[cardId];
  if (!card) return null;
  const counts = tally(card.promises);
  const status = worst(counts);
  const selected = selection?.journeyId === journey.id && selection.cardId === cardId;
  const reached = path !== null && index <= path.step;
  const past = path !== null && index < path.step;
  const intoBranches = path !== null && index === path.step && path.promise !== null;
  return (
    <li className="relative">
      {!last && (
        <span aria-hidden className={clsx('absolute top-6 bottom-0 left-2.5 border-l transition-colors', line(past))} />
      )}
      <div className="relative pb-0.5 pl-8">
        {last && open && (
          <span
            aria-hidden
            className={clsx('absolute top-6 bottom-0 left-2.5 border-l transition-colors', line(intoBranches))}
          />
        )}
        <span
          aria-hidden
          className={clsx(
            'absolute top-1 left-0 flex size-5.25 items-center justify-center rounded-full border text-meta tabular-nums transition-colors',
            selected
              ? 'border-interactive bg-interactive text-on-fill'
              : reached
                ? 'border-interactive bg-canvas text-interactive'
                : 'border-line bg-canvas text-fg-muted',
          )}
        >
          {index + 1}
        </span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            onSelect({ journeyId: journey.id, cardId });
            onToggle(selected ? undefined : true);
          }}
          onMouseEnter={() => onHover({ journeyId: journey.id, step: index, promise: null })}
          className={clsx(
            'flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-hover',
            selected && 'bg-selected hover:bg-selected',
          )}
        >
          <span className="min-w-0 grow truncate">{card.title}</span>
          <span className="shrink-0 text-meta text-fg-muted tabular-nums">{t.stepPromises(counts.total)}</span>
          {status && <StatusMark status={status} count={status === 'passed' ? undefined : counts[status]} />}
        </button>
      </div>
      <Collapse open={open}>
        <ul className="pb-2">
          {card.promises.map((promise, position) => (
            <PromiseBranch
              key={promise.id}
              promise={promise}
              cardId={cardId}
              on={path !== null && index === path.step && path.promise !== null && position <= path.promise}
              through={path !== null && index === path.step && path.promise !== null && position < path.promise}
              selected={selected && selection?.promiseId === promise.id}
              onSelect={() => onSelect({ journeyId: journey.id, cardId, promiseId: promise.id })}
              onHover={() => onHover({ journeyId: journey.id, step: index, promise: position })}
              actions={actions}
            />
          ))}
          <AddPromise onAdd={(when, then) => actions.onAddPromise(cardId, when, then)} />
        </ul>
      </Collapse>
    </li>
  );
}

function PromiseBranch({
  promise,
  cardId,
  on,
  through,
  selected,
  onSelect,
  onHover,
  actions,
}: {
  promise: TreePromise;
  cardId: string;
  on: boolean;
  through: boolean;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
  actions: BranchActions;
}) {
  const t = useMessages(messages);
  const settled = useSettled(promise.status);
  const target = { cardId, promiseId: promise.id };
  const row = useRef<HTMLLIElement>(null);
  // Picked from elsewhere (the to-do list, the detail): bring it into view once its step has opened.
  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => row.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 260);
    return () => clearTimeout(timer);
  }, [selected]);
  return (
    <li
      ref={row}
      className={clsx(
        'relative ml-2.5 pl-5',
        'before:absolute before:top-0 before:left-0 before:h-3.75 before:w-3.5 before:rounded-bl-lg before:border-b before:border-l before:transition-colors before:motion-draw',
        on ? 'before:border-interactive' : 'before:border-line',
        'after:absolute after:top-3.75 after:bottom-0 after:left-0 after:border-l after:transition-colors',
        through ? 'after:border-interactive' : 'after:border-line',
      )}
      onMouseEnter={onHover}
    >
      <div
        className={clsx(
          'group flex items-start rounded-md transition-colors',
          selected ? 'bg-selected' : 'hover:bg-hover',
          promise.status === 'checking' && 'motion-sweep',
          settled && 'motion-arrive',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 grow cursor-pointer items-start gap-3 px-2 py-1 text-left"
        >
          <span className="min-w-0 grow">
            <span className="block truncate">{promise.when || t.always}</span>
            <span className="block truncate text-meta text-fg-muted">{promise.then}</span>
          </span>
          <StatusMark status={promise.status} />
        </button>
        <Menu.Root>
          <Menu.Trigger
            aria-label={t.promiseMenu}
            className="mt-1 mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-canvas-sunken data-popup-open:opacity-100"
          >
            <Ellipsis size={14} aria-hidden />
          </Menu.Trigger>
          <Menu.Popup align="end">
            <Menu.Item onClick={() => actions.onCheck([target])}>
              {promise.status === 'unconfirmed' || promise.status === 'planned' ? t.checkThis : t.checkAgain}
            </Menu.Item>
            {promise.status === 'failed' && <Menu.Item onClick={() => actions.onFix([target])}>{t.fix}</Menu.Item>}
            <Menu.Separator />
            <Menu.Item className="text-danger" onClick={() => actions.onRemovePromise(target)}>
              {t.remove}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Root>
      </div>
    </li>
  );
}

/** True for a moment after the status changed from what it was when the row appeared, so the change is seen. */
function useSettled(status: PromiseStatus) {
  const first = useRef(status);
  const [settled, setSettled] = useState<PromiseStatus | null>(null);
  const previous = useRef(status);
  useEffect(() => {
    if (previous.current === status) return;
    previous.current = status;
    if (status === 'checking' || status === first.current) return;
    setSettled(status);
    const timer = setTimeout(() => setSettled(null), 1400);
    return () => clearTimeout(timer);
  }, [status]);
  return settled === status;
}

function AddPromise({ onAdd }: { onAdd: (when: string, then: string) => void }) {
  const t = useMessages(messages);
  return (
    <li className="relative ml-2.5 pl-5 before:absolute before:top-0 before:left-0 before:h-3.75 before:w-3.5 before:rounded-bl-lg before:border-b before:border-l before:border-dashed before:border-line">
      <InlineAdd
        label={t.addPromise}
        fields={[t.whenPlaceholder, t.thenPlaceholder]}
        onAdd={([w, th]) => onAdd(w!, th!)}
      />
    </li>
  );
}

function AddJourney({ onAdd }: { onAdd: (title: string, goal: string) => void }) {
  const t = useMessages(messages);
  return (
    <div className="mt-1 ml-5 pl-6">
      <InlineAdd
        label={t.addJourney}
        fields={[t.journeyPlaceholder, t.goalPlaceholder]}
        onAdd={([a, b]) => onAdd(a!, b ?? '')}
      />
    </div>
  );
}

/** A quiet "+ …" that opens into fields in place; the first field is required, Escape closes it. */
function InlineAdd({ label, fields, onAdd }: { label: string; fields: string[]; onAdd: (values: string[]) => void }) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<string[]>(() => fields.map(() => ''));
  const close = () => {
    setOpen(false);
    setValues(fields.map(() => ''));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values[0]?.trim()) return;
    onAdd(values.map((value) => value.trim()));
    close();
  };
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Plus size={13} aria-hidden />
        {label}
      </button>
    );
  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => event.key === 'Escape' && close()}
      className="motion-step flex flex-col gap-2 rounded-lg border border-line bg-canvas-raised p-2"
    >
      {fields.map((placeholder, index) => (
        <Input
          key={placeholder}
          autoFocus={index === 0}
          aria-label={placeholder}
          placeholder={placeholder}
          value={values[index]}
          onChange={(event) =>
            setValues((current) => current.map((value, at) => (at === index ? event.target.value : value)))
          }
        />
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={close}>
          {t.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!values[0]?.trim()}>
          {t.add}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- status

const marks: Record<PromiseStatus, [typeof Circle, string, string]> = {
  failed: [CircleX, 'text-danger', 'text-danger'],
  checking: [LoaderCircle, 'text-interactive motion-spin', 'text-interactive'],
  blocked: [CircleSlash, 'text-attention', 'text-attention'],
  unconfirmed: [Circle, 'text-fg-faint', 'text-fg-muted'],
  planned: [CircleDashed, 'text-fg-faint', 'text-fg-muted'],
  passed: [CircleCheck, 'text-fg', 'text-fg-muted'],
};

/** The one status mark: an icon with its word written beside it, and a count when it stands for several. */
export function StatusMark({ status, count }: { status: PromiseStatus; count?: number }) {
  const t = useMessages(messages);
  const [Icon, iconColor, wordColor] = marks[status];
  return (
    <span key={status} className={clsx('inline-flex shrink-0 items-center gap-1 text-meta', wordColor)}>
      <Icon size={13} aria-hidden className={clsx('shrink-0', iconColor)} />
      {t[status]}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- detail

function Detail({
  map,
  person,
  selection,
  onSelect,
  onCheck,
  onFix,
  onRemove,
}: {
  map: TreeMap;
  person: Person;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onCheck: (targets: PromiseTarget[]) => void;
  onFix: (targets: PromiseTarget[]) => void;
  onRemove: (target: PromiseTarget) => void;
}) {
  const t = useMessages(messages);
  const text = useText();
  const format = useFormat();
  const journey = selection && person.journeys.find((candidate) => candidate.id === selection.journeyId);
  const card = selection && map.cards[selection.cardId];

  if (!selection || !journey || !card) {
    const mine = personCards(person);
    const seen = new Set<string>();
    // One row per step, its newest check: several checks of one step read as one piece of news.
    const recent = map.recent.filter((change) => {
      if (!mine.has(change.cardId) || seen.has(change.cardId)) return false;
      seen.add(change.cardId);
      return true;
    });
    return (
      <div className="motion-step flex flex-col gap-3 p-5">
        <h2 className="text-lead text-fg-muted">{t.recentTitle}</h2>
        {recent.length === 0 && <p className="text-fg-muted">{t.recentEmpty}</p>}
        <ul className="flex flex-col gap-1">
          {recent.map((change) => {
            const where = person.journeys.find((candidate) => candidate.steps.includes(change.cardId));
            return (
              <li key={`${change.at}-${change.cardId}`}>
                <button
                  type="button"
                  onClick={() => where && onSelect({ journeyId: where.id, cardId: change.cardId })}
                  className="flex w-full cursor-pointer flex-col gap-1 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-hover"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{map.cards[change.cardId]?.title}</span>
                    <StatusMark status={change.kind === 'check_blocked' ? 'blocked' : 'passed'} />
                  </span>
                  <span className="line-clamp-2 text-meta text-fg-muted">{change.detail}</span>
                  <span className="text-meta text-fg-faint">{format.date(new Date(change.at))}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const crumbs = (
    <p className="flex min-w-0 items-center gap-1 text-meta text-fg-muted">
      <span className="truncate">{text(journey.title)}</span>
      {selection.promiseId && (
        <>
          <ChevronRight size={12} aria-hidden className="shrink-0" />
          <button
            type="button"
            className="cursor-pointer truncate hover:text-fg"
            onClick={() => onSelect({ journeyId: journey.id, cardId: card.id })}
          >
            {card.title}
          </button>
        </>
      )}
    </p>
  );

  const promise = selection.promiseId ? card.promises.find((item) => item.id === selection.promiseId) : undefined;
  if (promise) {
    const target = { cardId: card.id, promiseId: promise.id };
    return (
      <div className="motion-step flex flex-col gap-5 p-5">
        <div className="flex flex-col gap-2">
          {crumbs}
          <StatusMark status={promise.status} />
        </div>
        <dl className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <dt className="text-meta text-fg-muted">{t.when}</dt>
            <dd className="text-reading">{promise.when || t.always}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-meta text-fg-muted">{t.then}</dt>
            <dd className="text-reading">{promise.then}</dd>
          </div>
        </dl>
        <section className="flex flex-col gap-1.5 rounded-lg border border-line bg-canvas-raised p-3">
          <h3 className="text-meta text-fg-muted">{t.lastCheck}</h3>
          {promise.status === 'checking' ? (
            <p className="flex items-center gap-2">
              <LoaderCircle size={14} aria-hidden className="motion-spin text-interactive" />
              {t.checkingNote}
            </p>
          ) : promise.status === 'planned' ? (
            <p>{t.plannedNote}</p>
          ) : promise.note ? (
            <>
              <p className={clsx(promise.status === 'failed' && 'text-danger')}>{promise.note}</p>
              {promise.checkedAt && (
                <p className="text-meta text-fg-faint">{t.checkedOn(format.date(new Date(promise.checkedAt)))}</p>
              )}
            </>
          ) : (
            <p className="text-fg-muted">{t.notChecked}</p>
          )}
        </section>
        <div className="flex flex-wrap items-center gap-2">
          {promise.status === 'failed' && (
            <Button variant="primary" onClick={() => onFix([target])}>
              {t.fix}
            </Button>
          )}
          <Button
            variant={promise.status === 'failed' ? 'secondary' : 'primary'}
            disabled={promise.status === 'checking'}
            onClick={() => onCheck([target])}
          >
            {promise.status === 'unconfirmed' || promise.status === 'planned' ? t.checkThis : t.checkAgain}
          </Button>
          <LinkButton className="ml-auto text-danger" onClick={() => onRemove(target)}>
            {t.remove}
          </LinkButton>
        </div>
      </div>
    );
  }

  const counts = tally(card.promises);
  const elsewhere = otherJourneys(map, card.id, journey.id);
  const unchecked = card.promises
    .filter((item) => item.status !== 'passed' && item.status !== 'checking')
    .map((item) => ({ cardId: card.id, promiseId: item.id }));
  return (
    <div className="motion-step flex flex-col gap-5 p-5">
      <div className="flex flex-col gap-1">
        {crumbs}
        <h2 className="text-title">{card.title}</h2>
        <span className="text-meta text-fg-muted tabular-nums">{t.promiseSummary(counts.passed, counts.total)}</span>
      </div>
      <section className="flex flex-col gap-1">
        <h3 className="text-meta text-fg-muted">{t.stepPromisesTitle}</h3>
        <ul className="flex flex-col">
          {card.promises.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onSelect({ journeyId: journey.id, cardId: card.id, promiseId: item.id })}
                className="flex w-full cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover"
              >
                <span className="min-w-0 grow">
                  <span className="block truncate">{item.when || t.always}</span>
                  <span className="block truncate text-meta text-fg-muted">{item.then}</span>
                </span>
                <StatusMark status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {elsewhere.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-meta text-fg-muted">{t.alsoIn}</h3>
          <ul className="flex flex-col gap-0.5">
            {elsewhere.map(({ person: other, journey: theirs }) => (
              <li key={theirs.id} className="flex items-center gap-2 text-meta">
                <span className="text-fg-muted">{text(other.name)}</span>
                <ChevronRight size={12} aria-hidden className="text-fg-faint" />
                <span>{text(theirs.title)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {unchecked.length > 0 && (
        <div>
          <Button variant="primary" onClick={() => onCheck(unchecked)}>
            {t.checkStep}
          </Button>
        </div>
      )}
    </div>
  );
}

function RemovedNotice({ onUndo }: { onUndo: () => void }) {
  const t = useMessages(messages);
  return (
    <div className="pointer-events-none sticky bottom-5 flex justify-center">
      <div
        role="status"
        className="motion-arrive pointer-events-auto flex items-center gap-4 rounded-xl border border-line bg-canvas-raised px-4 py-2.5 shadow-overlay"
      >
        <span>{t.removed}</span>
        <LinkButton onClick={onUndo}>{t.undo}</LinkButton>
      </div>
    </div>
  );
}
