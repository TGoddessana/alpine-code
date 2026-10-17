import type { SessionInfo } from '@alpine/protocol';
import { Dialog, Input } from '@alpine/ui/primitives';
import { useMatch, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { Archive, Folder, MessageSquare, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { StatusWord } from '@/shared/components/status';
import { useMessages } from '@/shared/i18n';
import { useNavigation } from '@/shared/navigation';
import { useOpenProject, useProjects, useSearchSessions, useSessions } from '@/shared/server';

import { useCurrentProject } from './currentProject';
import { messages } from './messages';

/** Lives outside the rail so search and session shortcuts also work when the rail is hidden. */
export function NavigationController() {
  const sessions = useSessions().data;
  const match = useMatch({ from: '/session/$sessionId', shouldThrow: false });
  const id = match?.params.sessionId;
  const info = sessions?.find((s) => s.id === id);
  const current = useCurrentProject();
  const start = useMatch({ from: '/', shouldThrow: false });
  const restored = useRef(false);
  const visit = useNavigation((s) => s.visit);
  const navigate = useNavigate();
  const projects = useProjects().data?.projects;
  useEffect(() => {
    if (restored.current || !sessions || !projects) return;
    restored.current = true;
    if (!start || start.search.project) return;
    const prefs = useNavigation.getState();
    const session = sessions.find((s) => s.id === prefs.lastSessions[prefs.lastProject ?? ''] && !s.archived);
    if (session && projects.some((p) => p.path === session.cwd && !p.archived)) {
      void navigate({ to: '/session/$sessionId', params: { sessionId: session.id }, replace: true });
    }
  }, [sessions, projects, start, navigate]);
  useEffect(() => {
    if (!current) return;
    useNavigation.setState((state) => ({ expanded: { ...state.expanded, [current]: true } }));
  }, [current, id]);
  useEffect(() => {
    if (!info) return;
    const read = () => {
      if (document.visibilityState !== 'hidden') visit(info);
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [info, visit]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        useNavigation.getState().setSearchOpen(true);
      } else if (
        event.ctrlKey &&
        event.key === 'Tab' &&
        !event.metaKey &&
        !event.altKey &&
        !useNavigation.getState().searchOpen
      ) {
        const paths = new Set(projects?.filter((p) => !p.archived).map((p) => p.path));
        // Creation order stays stable while background sessions update their activity times.
        const listed =
          sessions
            ?.filter((s) => !s.archived && paths.has(s.cwd))
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) ?? [];
        if (!listed.length) return;
        event.preventDefault();
        const index = listed.findIndex((s) => s.id === id);
        const next = listed[(index + (event.shiftKey ? -1 : 1) + listed.length) % listed.length]!;
        void navigate({ to: '/session/$sessionId', params: { sessionId: next.id } });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessions, projects, id, navigate]);
  return <QuickSwitcher />;
}

type SearchEntry = {
  key: string;
  title: string;
  project: string;
  path: string;
  session?: SessionInfo;
  excerpt?: string;
  archived: boolean;
};

function QuickSwitcher() {
  const t = useMessages(messages);
  const open = useNavigation((s) => s.searchOpen);
  const setOpen = useNavigation((s) => s.setSearchOpen);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {open && <SearchContents onClose={() => setOpen(false)} title={t.search} />}
    </Dialog.Root>
  );
}

function SearchContents({ onClose, title }: { onClose: () => void; title: string }) {
  const t = useMessages(messages);
  const [term, setTerm] = useState('');
  const [index, setIndex] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(term.trim()), 180);
    return () => clearTimeout(timer);
  }, [term]);
  const result = useSearchSessions(query);
  const projects = useProjects().data?.projects ?? [];
  const sessions = useSessions().data ?? [];
  const navigate = useNavigate();
  const restore = useOpenProject();
  const id = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const needle = term.trim().toLocaleLowerCase();
  const byPath = new Map(projects.map((p) => [p.path, p]));
  const sessionEntry = (session: SessionInfo, excerpt = session.summary): SearchEntry => ({
    key: session.id,
    title: session.title || t.untitledSession,
    path: session.cwd,
    project: byPath.get(session.cwd)?.name ?? session.cwd.split('/').pop() ?? session.cwd,
    session,
    excerpt,
    archived: !!session.archived || !!byPath.get(session.cwd)?.archived,
  });
  const local = sessions.filter((s) =>
    !needle
      ? !s.archived && !byPath.get(s.cwd)?.archived
      : [s.title, s.cwd, s.summary].some((v) => v?.toLocaleLowerCase().includes(needle)),
  );
  const hits = query === term.trim() ? (result.data?.hits ?? []) : [];
  const matching = new Map(local.map((s) => [s.id, sessionEntry(s)]));
  for (const hit of hits)
    matching.set(hit.info.id, sessionEntry(sessions.find((s) => s.id === hit.info.id) ?? hit.info, hit.excerpt));
  const entries: SearchEntry[] = [
    ...projects
      .filter((p) => !!needle && `${p.name} ${p.path}`.toLocaleLowerCase().includes(needle))
      .map((p) => ({ key: p.path, title: p.name, project: p.path, path: p.path, archived: p.archived })),
    ...[...matching.values()]
      .sort(
        (a, b) =>
          Number(!!b.session?.pinned) - Number(!!a.session?.pinned) ||
          (b.session?.updatedAt ?? '').localeCompare(a.session?.updatedAt ?? ''),
      )
      .slice(0, 50),
  ];
  const selected = Math.min(index, Math.max(entries.length - 1, 0));
  const selectedKey = entries[selected]?.key;
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey]);
  const choose = (entry: SearchEntry) => {
    const go = () => {
      if (entry.session) void navigate({ to: '/session/$sessionId', params: { sessionId: entry.session.id } });
      else {
        const last = useNavigation.getState().lastSessions[entry.path];
        const session =
          sessions.find((s) => s.id === last && !s.archived) ??
          sessions.find((s) => s.cwd === entry.path && !s.archived);
        if (session) void navigate({ to: '/session/$sessionId', params: { sessionId: session.id } });
        else void navigate({ to: '/', search: { project: entry.path } });
      }
      onClose();
    };
    if (byPath.get(entry.path)?.archived) restore.mutate(entry.path, { onSuccess: go });
    else go();
  };
  return (
    <Dialog.Popup className="gap-3">
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{t.searchDescription}</Dialog.Description>
      <div className="flex items-center gap-2">
        <Search size={18} className="shrink-0 text-fg-muted" aria-hidden="true" />
        <Input
          autoFocus
          value={term}
          placeholder={t.searchHint}
          aria-label={t.search}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded
          aria-controls={id}
          aria-activedescendant={entries.length ? `${id}-${selected}` : undefined}
          onChange={(event) => {
            setTerm(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex(
                (selected + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % Math.max(entries.length, 1),
              );
            } else if (event.key === 'Enter' && entries[selected]) {
              event.preventDefault();
              choose(entries[selected]);
            }
          }}
        />
      </div>
      {!needle && <p className="text-meta text-fg-muted">{t.recent}</p>}
      <div
        id={id}
        role="listbox"
        aria-label={t.search}
        ref={listRef}
        className="flex max-h-100 min-h-0 flex-col gap-1 overflow-y-auto"
      >
        {entries.map((entry, i) => (
          <button
            key={entry.key}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === selected}
            tabIndex={-1}
            type="button"
            disabled={restore.isPending}
            onMouseMove={() => setIndex(i)}
            onClick={() => choose(entry)}
            className={clsx(
              'flex shrink-0 cursor-pointer items-start gap-3 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-interactive disabled:opacity-50',
              i === selected ? 'bg-selected' : 'hover:bg-hover',
            )}
          >
            {entry.session ? (
              <MessageSquare size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
            ) : (
              <Folder size={16} className="mt-0.5 shrink-0 text-fg-muted" aria-hidden="true" />
            )}
            <span className="flex min-w-0 grow flex-col gap-0.5">
              <span className="truncate text-body font-medium">{entry.title}</span>
              <span className="truncate text-meta text-fg-muted">{entry.project}</span>
              {entry.excerpt && <span className="line-clamp-2 text-meta text-fg-muted">{entry.excerpt}</span>}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {entry.archived && (
                <span className="inline-flex items-center gap-1 text-meta text-fg-muted">
                  <Archive size={12} aria-hidden="true" />
                  {t.archived}
                </span>
              )}
              {entry.session && entry.session.status !== 'idle' && <StatusWord status={entry.session.status} />}
            </span>
          </button>
        ))}
      </div>
      {needle && (query !== term.trim() || result.isFetching) && (
        <p role="status" className="text-meta text-fg-muted">
          {t.searching}
        </p>
      )}
      {result.error && needle && (
        <p role="alert" className="text-meta text-danger">
          {t.searchFailed}
        </p>
      )}
      {restore.error && (
        <p role="alert" className="text-meta text-danger">
          {restore.error.message}
        </p>
      )}
      {!entries.length && !result.isFetching && (
        <p className="py-4 text-body text-fg-muted">{needle ? t.noResults : t.emptyView}</p>
      )}
      {hits.length >= 50 && <p className="text-meta text-fg-muted">{t.resultsLimit}</p>}
    </Dialog.Popup>
  );
}
