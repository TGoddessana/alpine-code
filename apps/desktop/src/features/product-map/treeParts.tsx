import { Button, Input, LinkButton } from '@alpine/ui/primitives';
import clsx from 'clsx';
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  LoaderCircle,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { useFormat, useLocale, useMessages } from '@/shared/i18n';

import {
  otherJourneys,
  personCards,
  tally,
  type Localized,
  type Person,
  type PromiseStatus,
  type Tally,
  type TreeMap,
} from './flowTreeModel';
import { flowTreeMessages as messages } from './flowTreeMessages';

/** Pieces the person-first tree shares between its canvas nodes and its side panel. */

export interface PromiseTarget {
  cardId: string;
  promiseId: string;
}

export type Selection = { journeyId: string; cardId: string; promiseId?: string } | null;

export function useText() {
  const { locale } = useLocale();
  return (text: Localized) => text[locale];
}

const tones = {
  1: 'bg-avatar-1 text-avatar-1-ink',
  2: 'bg-avatar-2 text-avatar-2-ink',
  3: 'bg-avatar-3 text-avatar-3-ink',
  4: 'bg-avatar-4 text-avatar-4-ink',
  5: 'bg-avatar-5 text-avatar-5-ink',
} as const;

export function Avatar({ person, large, small }: { person: Person; large?: boolean; small?: boolean }) {
  const text = useText();
  return (
    <span
      aria-hidden
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full',
        tones[person.tone],
        large ? 'size-12 text-title' : small ? 'size-5 text-meta' : 'size-8 text-body',
      )}
    >
      {[...text(person.name)][0]}
    </span>
  );
}

export function Progress({ counts, wide, inverted }: { counts: Tally; wide?: boolean; inverted?: boolean }) {
  const share = counts.total ? (counts.passed / counts.total) * 100 : 0;
  return (
    <span
      aria-hidden
      className={clsx(
        'block overflow-hidden rounded-full',
        inverted ? 'bg-on-fill/20' : 'bg-line-subtle',
        wide ? 'h-1.5 w-full' : 'h-1 w-14',
      )}
    >
      <span
        className={clsx('block h-full rounded-full', inverted ? 'bg-on-fill' : 'bg-interactive')}
        style={{ width: `${share}%`, transition: 'width var(--motion-panel) var(--motion-ease)' }}
      />
    </span>
  );
}

/** True for a moment after the status changed from what it was when the row appeared, so the change is seen. */
export function useSettled(status: PromiseStatus) {
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

/** A quiet "+ …" that opens into fields in place; the first field is required, Escape closes it. */
export function InlineAdd({
  label,
  fields,
  onAdd,
  startOpen = false,
  onCancel,
}: {
  label: string;
  fields: string[];
  onAdd: (values: string[]) => void;
  startOpen?: boolean;
  onCancel?: () => void;
}) {
  const t = useMessages(messages);
  const [open, setOpen] = useState(startOpen);
  const [values, setValues] = useState<string[]>(() => fields.map(() => ''));
  const close = () => {
    setOpen(startOpen);
    setValues(fields.map(() => ''));
    onCancel?.();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!values[0]?.trim()) return;
    onAdd(values.map((value) => value.trim()));
    setValues(fields.map(() => ''));
    if (!startOpen) setOpen(false);
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

const marks: Record<PromiseStatus, [typeof Circle, string, string]> = {
  failed: [CircleX, 'text-danger', 'text-danger'],
  recheck: [RotateCcw, 'text-attention', 'text-attention'],
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

export function Detail({
  map,
  person,
  selection,
  onSelect,
  onCheck,
  onFix,
  onRemove,
  footer,
}: {
  map: TreeMap;
  person: Person;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onCheck: (targets: PromiseTarget[]) => void;
  onFix: (targets: PromiseTarget[]) => void;
  onRemove: (target: PromiseTarget) => void;
  /** Below a step's promises: where a new one is added. */
  footer?: ReactNode;
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
        {promise.when ? (
          <dl className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <dt className="text-meta text-fg-muted">{t.when}</dt>
              <dd className="text-reading">{promise.when}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-meta text-fg-muted">{t.then}</dt>
              <dd className="text-reading">{promise.then}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-reading">{promise.then}</p>
        )}
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
              <CheckList title={t.tried} items={promise.steps} />
              <CheckList title={t.saw} items={promise.seen} />
              <CheckList title={t.couldNot} items={promise.limits} tone="attention" />
              {(promise.environment || promise.checkedAt) && (
                <p className="text-meta text-fg-faint">
                  {[promise.environment, promise.checkedAt && t.checkedOn(format.date(new Date(promise.checkedAt)))]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
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
      {card.description && <p className="text-reading">{card.description}</p>}
      {card.howToTry && (
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-canvas-raised p-3">
          <h3 className="text-meta text-fg-muted">{t.howToTry}</h3>
          <p>{card.howToTry}</p>
        </section>
      )}
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
                  {item.when ? (
                    <>
                      <span className="block truncate">{item.when}</span>
                      <span className="block truncate text-meta text-fg-muted">{item.then}</span>
                    </>
                  ) : (
                    <span className="line-clamp-2">{item.then}</span>
                  )}
                </span>
                <StatusMark status={item.status} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      {footer}
      {card.sources && card.sources.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-meta text-fg-muted">{t.sources}</h3>
          <ul className="flex flex-col gap-0.5">
            {card.sources.map((source) => (
              <li key={source} className="truncate font-mono text-meta text-fg-muted" title={source}>
                {source}
              </li>
            ))}
          </ul>
        </section>
      )}
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

export function RemovedNotice({ onUndo }: { onUndo: () => void }) {
  const t = useMessages(messages);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
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

/** One part of what a check did (해본 것, 본 것, 확인 못 한 것), left out when the check said nothing about it. */
function CheckList({ title, items, tone }: { title: string; items?: string[]; tone?: 'attention' }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <span className={clsx('text-meta', tone === 'attention' ? 'text-attention' : 'text-fg-muted')}>{title}</span>
      <ul className="flex list-disc flex-col gap-0.5 pl-4 text-meta">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
