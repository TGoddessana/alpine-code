import type { AgentInfo, SkillInfo, SkillsAddResult } from '@alpine/protocol';
import { Button } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { agentMessages, agentName } from '@/shared/components/agent';
import {
  ChooseSkills,
  RECOMMENDED,
  looksLikeSource,
  skillApp,
  skillDoes,
  skillError,
  skillMessages,
  skillTitle,
} from '@/shared/components/skills';
import { useLocale, useMessages } from '@/shared/i18n';
import { useAddSkill, useSearchSkills, useSkills } from '@/shared/server';

import { librarySkillMessages } from './skillMessages';
import type { LibraryView, SkillActions } from './types';

/**
 * The library's skill tab: one box that finds skills (on skills.sh) or takes a link, the skills I have, and the ones
 * Alpine recommends. Adding takes one press: the skill is fetched, installed and in every agent from the next
 * message. A link with several skills asks which ones.
 */
export function Skills({
  agent,
  onViewChange,
  actions,
}: {
  agent: AgentInfo;
  onViewChange: (view: LibraryView) => void;
  actions: SkillActions;
}) {
  const t = useMessages(librarySkillMessages);
  const s = useMessages(skillMessages);
  const [query, setQuery] = useState('');
  const [chooser, setChooser] = useState<SkillsAddResult | null>(null);
  const mine = useSkills().data?.skills;
  const { add, busy, error } = useAdding(mine, actions, setChooser);
  const source = looksLikeSource(query);

  if (chooser)
    return (
      <div className="flex flex-col gap-3 px-5 pb-6">
        <button
          type="button"
          onClick={() => setChooser(null)}
          className="-ml-2 cursor-pointer self-start rounded-md px-2 py-1 text-body text-fg-muted hover:bg-canvas-sunken"
        >
          {t.back}
        </button>
        <ChooseSkills source={chooser.source} choices={chooser.choices} onAdd={(names) => add(chooser.source, names)} />
        {error && (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        )}
      </div>
    );

  const getSource = () => {
    if (source && query.trim()) void add(query.trim()).then((ok) => ok && setQuery(''));
  };

  return (
    <div className="flex flex-col gap-5 px-5 pb-6">
      <div className="flex flex-col gap-1.5">
        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-canvas-raised px-2.5 focus-within:border-interactive focus-within:ring-1 focus-within:ring-interactive">
          <Search size={15} strokeWidth={1.5} aria-hidden="true" className="shrink-0 text-fg-faint" />
          <span className="sr-only">{t.find}</span>
          <input
            value={query}
            placeholder={t.findPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
            onPaste={(event) => {
              // A pasted link is the intent to add it: no second press.
              const pasted = event.clipboardData.getData('text').trim();
              if (looksLikeSource(pasted) && !query.trim()) {
                event.preventDefault();
                setQuery(pasted);
                void add(pasted).then((ok) => ok && setQuery(''));
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) getSource();
            }}
            className="min-w-0 grow bg-transparent text-body outline-none placeholder:text-fg-faint"
          />
          {source && (
            <Button
              className="min-h-7 shrink-0 border-interactive text-interactive"
              disabled={busy !== null}
              onClick={getSource}
            >
              {busy === query.trim() ? s.adding : t.get}
            </Button>
          )}
        </label>
        {error ? (
          <p role="alert" className="text-meta text-danger">
            {error}
          </p>
        ) : busy && !RECOMMENDED.some((r) => r.source === busy) ? (
          <p role="status" className="text-meta text-fg-muted">
            {s.adding} {busy}
          </p>
        ) : (
          <p className="text-meta text-fg-faint">{t.findHint}</p>
        )}
      </div>

      {query.trim() && !source ? (
        <Found
          query={query}
          mine={mine ?? []}
          agent={agent}
          busy={busy}
          onAdd={add}
          onViewChange={onViewChange}
          actions={actions}
        />
      ) : (
        <>
          <Section title={t.mine} count={mine?.length}>
            {mine && mine.length === 0 && <p className="text-meta text-fg-muted">{t.emptyMine}</p>}
            <MineCards skills={mine ?? []} agent={agent} onViewChange={onViewChange} actions={actions}>
              <button
                type="button"
                onClick={() => onViewChange({ kind: 'new-skill' })}
                className="flex min-h-33 cursor-pointer flex-col items-start gap-1.5 rounded-xl border border-dashed border-interactive px-3 pt-2.5 pb-3 text-left hover:bg-canvas-sunken"
              >
                <span className="text-meta text-fg-faint">{t.kind}</span>
                <span className="font-medium text-interactive">{t.newCardTitle}</span>
                <span className="text-meta text-fg-muted">{t.newCardBody}</span>
              </button>
            </MineCards>
          </Section>
          <Recommended mine={mine ?? []} busy={busy} onAdd={add} onViewChange={onViewChange} />
        </>
      )}
    </div>
  );
}

/** Adding from a source, and what it is doing: the source being fetched, or why the last one failed. */
function useAdding(mine: SkillInfo[] | undefined, actions: SkillActions, onChoices: (result: SkillsAddResult) => void) {
  const s = useMessages(skillMessages);
  const { locale } = useLocale();
  const mutation = useAddSkill();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const add = async (source: string, names?: string[]) => {
    setBusy(source);
    setError(null);
    try {
      const result = await mutation.mutateAsync({ source, ...(names ? { names } : {}) });
      if (result.choices.length > 0) onChoices(result);
      if (result.added.length > 0) {
        const added = result.added.map((x) => x.name);
        const fresh = added.filter((name) => !mine?.some((m) => m.name === name));
        const first = skillTitle(added[0]!, locale);
        actions.onInstalled(added, fresh, added.length > 1 ? `${first} +${added.length - 1}` : first);
      }
      return true;
    } catch (reason) {
      setError(skillError(reason, s));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { add, busy, error };
}

function Section({
  title,
  count,
  note,
  children,
}: {
  title: string;
  count?: number;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-1.5 text-body font-medium">
        {title}
        {count !== undefined && count > 0 && <span className="text-meta text-fg-faint">{count}</span>}
        {note && <span className="ml-auto text-meta font-normal text-fg-faint">{note}</span>}
      </h3>
      {children}
    </section>
  );
}

const card = 'flex min-h-33 flex-col gap-1.5 rounded-xl border border-line px-3 pt-2.5 pb-3';

/** The skills I have as cards, then `children` (the card that writes a new one). */
function MineCards({
  skills,
  agent,
  onViewChange,
  actions,
  children,
}: {
  skills: SkillInfo[];
  agent: AgentInfo;
  onViewChange: (view: LibraryView) => void;
  actions: SkillActions;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
      {skills.map((skill) => (
        <MineCard key={skill.name} skill={skill} agent={agent} onViewChange={onViewChange} actions={actions} />
      ))}
      {children}
    </div>
  );
}

/** A skill I have: whether the agent being edited uses it, and a way to turn it off or back on. */
function MineCard({
  skill,
  agent,
  onViewChange,
  actions,
}: {
  skill: SkillInfo;
  agent: AgentInfo;
  onViewChange: (view: LibraryView) => void;
  actions: SkillActions;
}) {
  const t = useMessages(librarySkillMessages);
  const s = useMessages(skillMessages);
  const a = useMessages(agentMessages);
  const { locale } = useLocale();
  const on = !(agent.skillsOff ?? []).includes(skill.name);
  const title = skillTitle(skill.name, locale);
  const app = skillApp(skill, s);
  return (
    <div className={clsx(card, on ? 'bg-canvas-raised' : 'bg-canvas-sunken')}>
      <span className="text-meta text-fg-faint">{app ?? t.kind}</span>
      <button
        type="button"
        onClick={() => onViewChange({ kind: 'skill', name: skill.name })}
        className="flex grow cursor-pointer flex-col gap-0.5 text-left"
      >
        <span className={clsx('font-medium break-words', !on && 'text-fg-muted')}>{title}</span>
        <span className="line-clamp-3 text-meta text-fg-muted">{skillDoes(skill, locale)}</span>
        <span className="text-meta text-interactive">{t.open}</span>
      </button>
      {on ? (
        <div className="flex items-center justify-between">
          <span className="text-meta text-interactive">{t.using}</span>
          <Button
            className="min-h-6.5 border-transparent bg-transparent px-2 text-meta text-fg-muted"
            onClick={() => actions.onToggle(skill.name, false, title)}
          >
            {t.turnOff}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-meta text-fg-faint">{t.notUsing(agentName(agent, a))}</span>
          <Button
            className="min-h-7 border-interactive text-interactive"
            onClick={() => actions.onToggle(skill.name, true, title)}
          >
            {t.turnOn}
          </Button>
        </div>
      )}
    </div>
  );
}

function Recommended({
  mine,
  busy,
  onAdd,
  onViewChange,
}: {
  mine: SkillInfo[];
  busy: string | null;
  onAdd: (source: string) => Promise<boolean>;
  onViewChange: (view: LibraryView) => void;
}) {
  const t = useMessages(librarySkillMessages);
  const s = useMessages(skillMessages);
  const { locale } = useLocale();
  return (
    <Section title={t.recommended}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
        {RECOMMENDED.map((r) => {
          const have = mine.some((m) => m.name === r.name);
          return (
            <div key={r.source} className={clsx(card, 'bg-canvas-raised')}>
              <span className="text-meta text-fg-faint">{r.source.split('/')[0]}</span>
              <div className="flex grow flex-col gap-0.5">
                <span className="font-medium">{r[locale].title}</span>
                <span className="text-meta text-fg-muted">{r[locale].does}</span>
              </div>
              {have ? (
                <button
                  type="button"
                  onClick={() => onViewChange({ kind: 'skill', name: r.name })}
                  className="cursor-pointer self-start text-meta text-interactive"
                >
                  {s.added}
                </button>
              ) : (
                <Button
                  className="min-h-7 border-interactive text-interactive"
                  aria-label={s.addNamed(r[locale].title)}
                  disabled={busy !== null}
                  onClick={() => void onAdd(r.source)}
                >
                  {busy === r.source ? s.adding : s.add}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** What a search finds: my own skills that match, then skills.sh's, the most installed first. */
function Found({
  query,
  mine,
  agent,
  busy,
  onAdd,
  onViewChange,
  actions,
}: {
  query: string;
  mine: SkillInfo[];
  agent: AgentInfo;
  busy: string | null;
  onAdd: (source: string) => Promise<boolean>;
  onViewChange: (view: LibraryView) => void;
  actions: SkillActions;
}) {
  const t = useMessages(librarySkillMessages);
  const s = useMessages(skillMessages);
  const { locale } = useLocale();
  const search = useSearchSkills(query);
  const q = query.trim().toLowerCase();
  const matches = mine.filter((m) =>
    [m.name, m.description, skillTitle(m.name, locale)].some((x) => x.toLowerCase().includes(q)),
  );
  const compact = new Intl.NumberFormat(locale, { notation: 'compact' });
  const hits = search.data?.hits ?? [];
  return (
    <>
      {matches.length > 0 && (
        <Section title={t.mine} count={matches.length}>
          <MineCards skills={matches} agent={agent} onViewChange={onViewChange} actions={actions} />
        </Section>
      )}
      <Section title={t.results} note={t.resultsFrom}>
        {search.isLoading && <p className="text-meta text-fg-muted">{t.searching}</p>}
        {search.isError && <p className="text-meta text-danger">{skillError(search.error, s)}</p>}
        {search.isSuccess && hits.length === 0 && q.length >= 2 && (
          <p className="text-meta text-fg-muted">{t.noResults(query.trim())}</p>
        )}
        {hits.length > 0 && (
          <ul className="flex flex-col divide-y divide-line-subtle rounded-xl border border-line">
            {hits.map((hit) => {
              const have = mine.some((m) => m.name === hit.name);
              return (
                <li key={hit.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 grow">
                    <div className="truncate font-medium">{hit.name}</div>
                    <div className="truncate text-meta text-fg-muted">
                      {hit.source} · {t.installs(compact.format(hit.installs))}
                    </div>
                  </div>
                  {have ? (
                    <span className="shrink-0 text-meta text-interactive">{s.added}</span>
                  ) : (
                    <Button
                      className="min-h-7 shrink-0 border-interactive text-interactive"
                      aria-label={s.addNamed(hit.name)}
                      disabled={busy !== null}
                      onClick={() => void onAdd(hit.id)}
                    >
                      {busy === hit.id ? s.adding : s.add}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
