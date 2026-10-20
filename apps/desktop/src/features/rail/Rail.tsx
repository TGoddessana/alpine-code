import type { CloneInfo, ProjectInfo, SessionInfo } from '@alpine/protocol';
import { Collapse, ContextMenu, Menu, PanelResizer, usePanelWidth } from '@alpine/ui/primitives';
import { Link, useMatch, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import {
  Archive,
  BookMarked,
  Bot,
  ChevronRight,
  Ellipsis,
  Map,
  Pin,
  Plus,
  Search,
  Settings,
  SquarePen,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { ProgressBar, ProjectAddDialog, projectAddMessages } from '@/shared/components/project-add';
import { useMessages } from '@/shared/i18n';
import { isUnread, useNavigation, visibleSessions, type RailView } from '@/shared/navigation';
import { revealInFinder } from '@/shared/platform';
import {
  useArchiveProject,
  useCloudEnabled,
  useOpenProject,
  useProjects,
  useSessions,
  useSetSessionDetails,
} from '@/shared/server';

import { useCurrentProject } from './currentProject';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { DeleteSessionDialog } from './DeleteSessionDialog';
import { messages } from './messages';
import { SessionRow } from './SessionRow';

const item =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-fg outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-interactive';
const iconButton =
  'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-interactive disabled:cursor-default disabled:opacity-50';
type Undo = { kind: 'session'; id: string; archived: boolean } | { kind: 'project'; path: string };

/** Browse folders independently of the conversation on screen. Important sessions never fall behind “more”. */
export function Rail({ open = true }: { open?: boolean }) {
  const t = useMessages(messages);
  const added = useMessages(projectAddMessages);
  const projects = useProjects();
  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const current = useCurrentProject();
  const sessionMatch = useMatch({ from: '/session/$sessionId', shouldThrow: false });
  const currentId = sessionMatch?.params.sessionId;
  const navigate = useNavigate();
  const cloud = useCloudEnabled();
  const width = usePanelWidth({ storageKey: 'alpine.rail.width', initial: 288, min: 240, max: 400 });
  const prefs = useNavigation();
  const [view, setView] = useState<RailView>('all');
  const [fullLists, setFullLists] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ProjectInfo | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [notice, setNotice] = useState('');
  const archiveProject = useArchiveProject();
  const openProject = useOpenProject();
  const updateSession = useSetSessionDetails();
  const go = useGoToProject();
  const known = projects.data?.projects ?? [];
  const activePaths = new Set(known.filter((p) => !p.archived).map((p) => p.path));
  const available = sessions.filter((s) => activePaths.has(s.cwd) && !s.archived);
  const counts = {
    attention: available.filter((s) => s.status === 'waiting' || s.status === 'failed').length,
    running: available.filter((s) => s.status === 'running').length,
    unread: available.filter((s) => isUnread(s, prefs.seen, prefs.since)).length,
  };
  const matches = (s: SessionInfo, project: ProjectInfo) => {
    if (view === 'archived') return project.archived || !!s.archived;
    if (project.archived || (s.archived && s.id !== currentId)) return false;
    if (view === 'attention') return s.status === 'waiting' || s.status === 'failed';
    if (view === 'running') return s.status === 'running';
    if (view === 'unread') return isUnread(s, prefs.seen, prefs.since);
    return true;
  };
  const ordered = [...known].sort((a, b) => {
    const pinned = Number(prefs.pinnedProjects.includes(b.path)) - Number(prefs.pinnedProjects.includes(a.path));
    return pinned || (prefs.sort === 'name' ? a.name.localeCompare(b.name) : b.lastUsedAt.localeCompare(a.lastUsedAt));
  });
  const listed = ordered.filter((p) =>
    view === 'all'
      ? !p.archived
      : (view === 'archived' && p.archived) || sessions.some((s) => s.cwd === p.path && matches(s, p)),
  );
  const error = archiveProject.error ?? openProject.error ?? updateSession.error;
  const pending = archiveProject.isPending || openProject.isPending || updateSession.isPending;
  const archiveSession = (session: SessionInfo) =>
    updateSession.mutate(
      { sessionId: session.id, archived: !session.archived },
      {
        onSuccess: () => {
          setUndo({ kind: 'session', id: session.id, archived: !!session.archived });
          setNotice(session.archived ? t.restoredNotice : t.archivedNotice);
          if (currentId === session.id && !session.archived) {
            const next = sessions.find((s) => s.cwd === session.cwd && s.id !== session.id && !s.archived);
            if (next) void navigate({ to: '/session/$sessionId', params: { sessionId: next.id } });
            else void navigate({ to: '/', search: { project: session.cwd } });
          }
        },
      },
    );
  const archive = (project: ProjectInfo) =>
    archiveProject.mutate(project.path, {
      onSuccess: () => {
        setUndo({ kind: 'project', path: project.path });
        setNotice(t.archivedNotice);
        if (current === project.path) {
          const next = known.find((p) => !p.archived && p.path !== project.path);
          if (next) go(next.path);
          else void navigate({ to: '/' });
        }
      },
    });
  const restore = (project: ProjectInfo) =>
    openProject.mutate(project.path, { onSuccess: () => setNotice(t.restoredNotice) });
  const undoLast = () => {
    if (!undo || pending) return;
    const done = () => {
      setUndo(null);
      setNotice(undo.kind === 'session' && undo.archived ? t.archivedNotice : t.restoredNotice);
    };
    if (undo.kind === 'project') openProject.mutate(undo.path, { onSuccess: done });
    else updateSession.mutate({ sessionId: undo.id, archived: undo.archived }, { onSuccess: done });
  };

  return (
    <div
      className="motion-rail"
      data-open={open}
      style={{ width: open ? width.width : 0 }}
      aria-hidden={!open}
      inert={!open}
    >
      <nav
        aria-label={t.label}
        style={{ width: width.width }}
        className="relative flex h-full min-w-60 shrink-0 flex-col gap-3 bg-canvas-sunken px-3 pb-4"
      >
        <PanelResizer panel={width} edge="right" label={t.resize} />
        <div className="mt-1 flex shrink-0 flex-col gap-2">
          <button
            type="button"
            onClick={() => prefs.setSearchOpen(true)}
            className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-canvas px-2 text-left text-body text-fg-muted outline-none hover:border-interactive focus-visible:ring-2 focus-visible:ring-interactive"
          >
            <Search size={16} aria-hidden="true" />
            <span className="min-w-0 grow truncate">{t.search}</span>
            <kbd className="text-meta text-fg-faint">⌘K</kbd>
          </button>
          <Link
            to="/"
            search={current ? { project: current } : {}}
            className="flex min-h-9 items-center gap-2 rounded-lg bg-interactive px-3 text-body font-medium text-on-fill outline-none hover:bg-interactive-hover focus-visible:ring-2 focus-visible:ring-interactive"
          >
            <SquarePen size={16} aria-hidden="true" />
            <span className="grow">{t.newSession}</span>
            <kbd className="text-meta">⌘N</kbd>
          </Link>
          <div role="group" className="flex flex-wrap gap-1" aria-label={t.filter}>
            {(['all', 'attention', 'running', 'unread'] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-label={key === 'all' ? t.all : `${t[key]} ${counts[key]}`}
                aria-pressed={view === key}
                onClick={() => setView(view === key ? 'all' : key)}
                className={clsx(
                  'flex min-h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-meta outline-none focus-visible:ring-2 focus-visible:ring-interactive',
                  view === key ? 'bg-selected font-medium text-interactive' : 'text-fg-muted hover:bg-hover',
                )}
              >
                {t[key]}
                {key !== 'all' && <span className="font-semibold tabular-nums">{counts[key]}</span>}
              </button>
            ))}
          </div>
        </div>
        <section
          aria-label={view === 'archived' ? t.archived : t.projects}
          className="flex min-h-0 grow flex-col gap-1 overflow-y-auto"
        >
          <div className="flex min-h-7 shrink-0 items-center gap-2 px-2 text-meta text-fg-muted">
            {view === 'archived' && <Archive size={14} aria-hidden="true" />}
            <span className="grow">{view === 'all' ? t.projects : t[view]}</span>
            <Menu.Root>
              <Menu.Trigger aria-label={t.sort} className={iconButton}>
                <Ellipsis size={16} aria-hidden="true" />
              </Menu.Trigger>
              <Menu.Popup align="end">
                <Menu.RadioGroup
                  value={prefs.sort}
                  onValueChange={(value) => prefs.setSort(value as 'recent' | 'name')}
                >
                  <Menu.RadioItem value="recent">{t.sortRecent}</Menu.RadioItem>
                  <Menu.RadioItem value="name">{t.sortName}</Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Root>
            <button
              type="button"
              onClick={() => setAdding(true)}
              aria-label={added.addProject}
              title={added.addProject}
              className={iconButton}
            >
              <Plus size={16} aria-hidden="true" />
            </button>
          </div>
          {(projects.isPending || sessionsQuery.isPending) && (
            <p role="status" className="px-2 text-meta text-fg-muted">
              {t.loading}
            </p>
          )}
          {(projects.isError || sessionsQuery.isError) && (
            <div role="alert" className="px-2 text-meta text-danger">
              {t.loadFailed}
              <button
                type="button"
                className={item}
                onClick={() => {
                  void projects.refetch();
                  void sessionsQuery.refetch();
                }}
              >
                {t.retry}
              </button>
            </div>
          )}
          {view === 'all' &&
            [...(projects.data?.clones ?? [])]
              .reverse()
              .map((clone) => <CloneRow key={clone.id} clone={clone} current={clone.path === current} />)}
          {listed.map((project) => {
            const projectSessions = sessions
              .filter((s) => s.cwd === project.path && matches(s, project))
              .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
            return (
              <ProjectGroup
                key={project.path}
                project={project}
                sessions={projectSessions}
                current={current === project.path}
                currentId={currentId}
                expanded={prefs.expanded[project.path] ?? current === project.path}
                filtered={view !== 'all'}
                all={fullLists[project.path] ?? false}
                onToggleAll={() => setFullLists((lists) => ({ ...lists, [project.path]: !lists[project.path] }))}
                pinned={prefs.pinnedProjects.includes(project.path)}
                onToggle={() =>
                  prefs.toggleProject(project.path, prefs.expanded[project.path] ?? current === project.path)
                }
                onGo={() => go(project.path)}
                onPin={() => prefs.pinProject(project.path)}
                onArchive={() => archive(project)}
                onRestore={() => restore(project)}
                onDelete={() => setDeleting(project)}
                onDeleteSession={setDeletingSession}
                onArchiveSession={archiveSession}
                pending={pending}
                busy={sessions.some(
                  (s) => s.cwd === project.path && (s.status === 'running' || s.status === 'waiting'),
                )}
              />
            );
          })}
          {projects.isSuccess && sessionsQuery.isSuccess && listed.length === 0 && (
            <div className="flex flex-col items-start gap-2 px-2 py-3">
              <p className="text-body text-fg-muted">{t.emptyView}</p>
              {view !== 'all' && (
                <button
                  type="button"
                  onClick={() => setView('all')}
                  className="min-h-8 cursor-pointer rounded-md border border-line bg-canvas px-3 text-body font-medium text-interactive outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-interactive"
                >
                  {t.showAllConversations}
                </button>
              )}
            </div>
          )}
          {projects.isSuccess && known.length === 0 && (
            <button type="button" className={item} onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" />
              {added.addProjectItem}
            </button>
          )}
        </section>
        {(notice || error) && (
          <div className="flex shrink-0 flex-col gap-1 rounded-lg border border-line bg-canvas p-2 text-meta">
            {notice && (
              <div className="flex items-center gap-2">
                <p role="status" className="grow">
                  {notice}
                </p>
                <button
                  type="button"
                  aria-label={t.dismissNotice}
                  className={iconButton}
                  onClick={() => {
                    setNotice('');
                    setUndo(null);
                  }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className="text-danger">
                {error.message}
              </p>
            )}
            {undo && (
              <button
                type="button"
                disabled={pending}
                onClick={undoLast}
                className="min-h-7 cursor-pointer text-left font-medium text-interactive disabled:opacity-50"
              >
                {t.undo}
              </button>
            )}
          </div>
        )}
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setView(view === 'archived' ? 'all' : 'archived')}
            aria-pressed={view === 'archived'}
            className={clsx(item, view === 'archived' && 'bg-selected')}
          >
            <Archive size={16} aria-hidden="true" />
            {t.archived}
          </button>
          <Link to="/agents" className={item} activeProps={{ className: 'bg-selected font-medium' }}>
            <Bot size={16} aria-hidden="true" />
            {t.agents}
          </Link>
          <Link to="/settings" className={item} activeProps={{ className: 'bg-selected font-medium' }}>
            <Settings size={16} aria-hidden="true" />
            {t.settings}
          </Link>
        </div>
        <ProjectAddDialog
          open={adding}
          onOpenChange={setAdding}
          onDone={(path) => void navigate({ to: '/', search: { project: path } })}
          onNew={cloud ? () => void navigate({ to: '/', search: { new: 1 } }) : undefined}
        />
        <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
        <DeleteSessionDialog session={deletingSession} onClose={() => setDeletingSession(null)} />
      </nav>
    </div>
  );
}

/** A title opens the project's map. The disclosure button only changes the tree. */
function ProjectGroup({
  project,
  sessions,
  current,
  currentId,
  expanded,
  filtered,
  all,
  onToggleAll,
  pinned,
  onToggle,
  onGo,
  onPin,
  onArchive,
  onRestore,
  onDelete,
  onDeleteSession,
  onArchiveSession,
  pending,
  busy,
}: {
  project: ProjectInfo;
  sessions: SessionInfo[];
  current: boolean;
  currentId?: string;
  expanded: boolean;
  filtered: boolean;
  all: boolean;
  onToggleAll: () => void;
  pinned: boolean;
  onToggle: () => void;
  onGo: () => void;
  onPin: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
  onDeleteSession: (session: SessionInfo) => void;
  onArchiveSession: (session: SessionInfo) => void;
  pending: boolean;
  busy: boolean;
}) {
  const t = useMessages(messages);
  const open = filtered || expanded;
  const seen = useNavigation((s) => s.seen);
  const since = useNavigation((s) => s.since);
  const unreadIds = sessions.filter((s) => isUnread(s, seen, since)).map((s) => s.id);
  const listed = visibleSessions(sessions, currentId, all || filtered, unreadIds);
  const hidden = sessions.length - listed.length;
  const important = sessions.filter((s) => s.status === 'waiting' || s.status === 'failed');
  const running = sessions.filter((s) => s.status === 'running').length;
  const items = (
    <>
      {!project.archived && (
        <>
          <Menu.Item onClick={onPin}>{pinned ? t.unpin : t.pin}</Menu.Item>
          <Menu.Item render={<Link to="/" search={{ project: project.path }} />}>{t.newSession}</Menu.Item>
        </>
      )}
      <Menu.Item onClick={() => void revealInFinder(project.path)}>{t.revealInFinder}</Menu.Item>
      <Menu.Separator />
      <Menu.Item
        disabled={pending || (!project.archived && busy)}
        title={busy ? t.busyArchive : undefined}
        onClick={project.archived ? onRestore : onArchive}
      >
        {project.archived ? t.restore : t.archive}
      </Menu.Item>
      <Menu.Separator />
      <Menu.Item className="text-danger" onClick={onDelete}>
        {t.delete}
      </Menu.Item>
    </>
  );
  return (
    <div className="flex shrink-0 flex-col gap-0.5">
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={<div />}
          className={clsx('group flex items-center gap-0.5 rounded-md pr-1', current && 'bg-hover')}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? t.collapseProject(project.name) : t.expandProject(project.name)}
            className={iconButton}
            disabled={filtered}
          >
            <ChevronRight size={16} aria-hidden="true" className={clsx('transition-transform', open && 'rotate-90')} />
          </button>
          <button
            type="button"
            onClick={project.archived ? undefined : onGo}
            aria-label={t.openProject(project.name)}
            aria-current={current ? 'location' : undefined}
            disabled={project.archived}
            title={project.path}
            className="flex min-h-9 min-w-0 grow cursor-pointer items-center gap-1.5 rounded-md text-left text-body font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-interactive disabled:cursor-default"
          >
            <span className="min-w-0 truncate">{project.name}</span>
            {pinned && <Pin size={12} className="shrink-0 text-interactive" aria-label={t.pinned} />}
          </button>
          {!project.archived && (
            <Link
              to="/"
              search={{ project: project.path }}
              aria-label={t.newInProject(project.name)}
              className={iconButton}
            >
              <Plus size={14} aria-hidden="true" />
            </Link>
          )}
          <Menu.Root>
            <Menu.Trigger aria-label={t.projectMenu(project.name)} className={iconButton}>
              <Ellipsis size={16} aria-hidden="true" />
            </Menu.Trigger>
            <Menu.Popup align="end">{items}</Menu.Popup>
          </Menu.Root>
        </ContextMenu.Trigger>
        <ContextMenu.Popup aria-label={t.projectMenu(project.name)}>{items}</ContextMenu.Popup>
      </ContextMenu.Root>
      {!open && (important.length > 0 || running > 0) && (
        <div className="ml-7 flex flex-wrap gap-x-2 text-meta">
          {important.length > 0 && (
            <span className="text-attention">
              {t.attention} {important.length}
            </span>
          )}
          {running > 0 && (
            <span className="text-fg-muted">
              {t.running} {running}
            </span>
          )}
        </div>
      )}
      {project.archived && (
        <button
          type="button"
          onClick={onRestore}
          disabled={pending}
          className="ml-7 min-h-7 cursor-pointer text-left text-meta text-interactive disabled:opacity-50"
        >
          {t.restore}
        </button>
      )}
      <Collapse open={open}>
        <div className="ml-3.5 flex flex-col gap-0.5 border-l border-line pl-2">
          {current && !filtered && (
            <nav aria-label={t.projectPages(project.name)} className="mb-1 flex gap-1">
              <Link
                to="/board"
                search={{ project: project.path }}
                className={item}
                activeProps={{ className: 'bg-selected font-medium' }}
              >
                <Map size={14} aria-hidden="true" />
                {t.pageMap}
              </Link>
              <Link
                to="/memory"
                search={{ project: project.path }}
                className={item}
                activeProps={{ className: 'bg-selected font-medium' }}
              >
                <BookMarked size={14} aria-hidden="true" />
                {t.pageMemory}
              </Link>
            </nav>
          )}
          {listed.map((session) => (
            <SessionRow key={session.id} session={session} onDelete={onDeleteSession} onArchive={onArchiveSession} />
          ))}
          {!filtered && (hidden > 0 || all) && (
            <button
              type="button"
              onClick={onToggleAll}
              className="min-h-7 cursor-pointer rounded-md px-2 text-left text-meta text-interactive hover:bg-hover"
            >
              {all ? t.showLess : t.showMore(hidden)}
            </button>
          )}
        </div>
      </Collapse>
    </div>
  );
}

/** A click on a project's name: its map, or (on the memory page) its memory. */
function useGoToProject() {
  const navigate = useNavigate();
  const memory = useMatch({ from: '/memory', shouldThrow: false });
  return (path: string) => void navigate({ to: memory ? '/memory' : '/board', search: { project: path } });
}

function CloneRow({ clone, current }: { clone: CloneInfo; current: boolean }) {
  const added = useMessages(projectAddMessages);
  const failed = clone.state === 'failed';
  return (
    <Link
      to="/"
      search={{ project: clone.path }}
      title={clone.address}
      className={clsx(item, 'flex-col items-stretch gap-1 py-1.5 pl-8', current && 'bg-hover font-medium')}
    >
      <span className="flex items-center gap-2">
        <span className="min-w-0 grow truncate">{clone.name}</span>
        <span className={clsx('text-meta font-normal whitespace-nowrap', failed ? 'text-danger' : 'text-fg-faint')}>
          {failed ? added.notReceivedShort : `${clone.percent}%`}
        </span>
      </span>
      {!failed && <ProgressBar percent={clone.percent} />}
    </Link>
  );
}
