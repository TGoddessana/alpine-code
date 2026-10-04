import type { ProjectInfo, SessionInfo } from '@alpine/protocol';
import { ContextMenu, Menu, PanelResizer, usePanelWidth } from '@alpine/ui/primitives';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Ellipsis, FolderOpen, Settings, SquarePen } from 'lucide-react';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { revealInFinder, useOpenFolder } from '@/shared/platform';
import { useArchiveProject, useProjects, useSessions } from '@/shared/server';

import { AVATAR_CLASS, avatarLetters, avatarSlot } from './avatar';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { DeleteSessionDialog } from './DeleteSessionDialog';
import { messages } from './messages';
import { SessionRow } from './SessionRow';

const item =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-fg hover:bg-hover';
const active = { className: 'bg-hover font-medium' };

/** Sessions shown under a project before "show more". */
const SESSIONS_SHOWN = 5;

/** Where you are: my turn, projects and their sessions. Holds no session content. */
export function Rail() {
  const t = useMessages(messages);
  const projects = useProjects();
  const navigate = useNavigate();
  const openFolder = useOpenFolder((path) => void navigate({ to: '/', search: { project: path } }));
  const shown = projects.data?.projects.filter((project) => !project.archived) ?? [];
  const none = projects.isSuccess && shown.length === 0;
  const width = usePanelWidth({ storageKey: 'alpine.rail.width', initial: 260, min: 200, max: 360 });
  const [deleting, setDeleting] = useState<ProjectInfo | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const sessions = useSessions().data ?? [];

  return (
    <nav
      aria-label={t.label}
      style={{ width: width.width }}
      className="relative flex min-w-50 shrink flex-col gap-3 bg-canvas-sunken px-3 pb-4"
    >
      <PanelResizer panel={width} edge="right" label={t.resize} />
      {!none && (
        <Link
          to="/"
          className="mt-1 flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg border border-line bg-canvas-raised px-3 text-left text-body font-medium text-fg hover:bg-hover"
        >
          <SquarePen size={16} strokeWidth={1.5} className="text-interactive" aria-hidden="true" />
          <span className="grow">{t.newSession}</span>
          <span className="text-meta font-normal text-fg-faint">⌘N</span>
        </Link>
      )}
      <section aria-label={t.projects} className="flex flex-col gap-0.5">
        <div className="flex min-h-7 items-center gap-2 px-2 text-meta text-fg-muted">
          <span className="grow">{t.projects}</span>
          <button
            type="button"
            onClick={openFolder}
            aria-label={`${t.openFolder} · ⌘O`}
            title={`${t.openFolder} · ⌘O`}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover"
          >
            <FolderOpen size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {none ? (
          <button type="button" className={item} onClick={openFolder}>
            <FolderOpen size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
            <span className="grow">{t.openFolder}</span>
            <span className="text-meta text-fg-muted">⌘O</span>
          </button>
        ) : (
          shown.map((project) => (
            <ProjectGroup
              key={project.path}
              project={project}
              sessions={sessions.filter((session) => session.cwd === project.path)}
              onDelete={setDeleting}
              onDeleteSession={setDeletingSession}
            />
          ))
        )}
      </section>
      <div className="grow" />
      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <Link to="/settings" className={item} activeProps={active}>
          <Settings size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
          {t.settings}
        </Link>
      </div>
      <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
      <DeleteSessionDialog session={deletingSession} onClose={() => setDeletingSession(null)} />
    </nav>
  );
}

/** A project and, when open, its sessions under a guide line. A closed project shows how many sessions it has. */
function ProjectGroup({
  project,
  sessions,
  onDelete,
  onDeleteSession,
}: {
  project: ProjectInfo;
  sessions: SessionInfo[];
  onDelete: (project: ProjectInfo) => void;
  onDeleteSession: (session: SessionInfo) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex flex-col gap-0.5">
      <ProjectRow
        project={project}
        count={open ? null : sessions.length}
        open={open}
        onToggle={() => setOpen(!open)}
        onDelete={onDelete}
      />
      {open && sessions.length > 0 && (
        <div className="ml-4.5 flex flex-col gap-0.5 border-l border-line pl-2">
          <ProjectSessions sessions={sessions} onDelete={onDeleteSession} />
        </div>
      )}
    </div>
  );
}

/** A project's sessions, most recently used first (the list already comes in that order). */
function ProjectSessions({
  sessions,
  onDelete,
}: {
  sessions: SessionInfo[];
  onDelete: (session: SessionInfo) => void;
}) {
  const t = useMessages(messages);
  const [all, setAll] = useState(false);
  const shown = all ? sessions : sessions.slice(0, SESSIONS_SHOWN);
  const hidden = sessions.length - SESSIONS_SHOWN;
  return (
    <>
      {shown.map((session) => (
        <SessionRow key={session.id} session={session} onDelete={onDelete} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="flex min-h-7 w-full cursor-pointer items-center rounded-md pl-2 text-left text-meta text-fg-muted hover:bg-hover"
        >
          {all ? t.showLess : t.showMore(hidden)}
        </button>
      )}
    </>
  );
}

/**
 * A project: opens a new session in it. Hovering or focusing the row swaps its time for ⋮, which opens the
 * project's menu; right-clicking opens the same menu.
 */
function ProjectRow({
  project,
  count,
  open,
  onToggle,
  onDelete,
}: {
  project: ProjectInfo;
  count: number | null;
  open: boolean;
  onToggle: () => void;
  onDelete: (project: ProjectInfo) => void;
}) {
  const t = useMessages(messages);
  const format = useFormat();
  const navigate = useNavigate();
  const archive = useArchiveProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const chosen = useSearch({ strict: false, select: (search: { project?: string }) => search.project });

  const items = (
    <>
      <Menu.Item onClick={() => void navigate({ to: '/', search: { project: project.path } })}>
        {t.newSession}
      </Menu.Item>
      <Menu.Item onClick={() => void revealInFinder(project.path)}>{t.revealInFinder}</Menu.Item>
      <Menu.Separator />
      <Menu.Item onClick={() => archive.mutate(project.path)}>{t.archive}</Menu.Item>
      <Menu.Separator />
      <Menu.Item className="text-danger" onClick={() => onDelete(project)}>
        {t.delete}
      </Menu.Item>
    </>
  );

  return (
    <div
      className={clsx(
        'group relative flex items-center rounded-md hover:bg-hover',
        (chosen === project.path || menuOpen) && 'bg-hover',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={project.name}
        className="absolute left-1 z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:text-fg"
      >
        {open ? (
          <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <ChevronRight size={16} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={<Link to="/" search={{ project: project.path }} />}
          className={clsx(item, 'pl-7 hover:bg-transparent')}
          title={project.path}
        >
          <span
            className={clsx(
              'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-meta font-medium',
              AVATAR_CLASS[avatarSlot(project.path)],
            )}
            aria-hidden="true"
          >
            {avatarLetters(project.name)}
          </span>
          <span className="min-w-0 grow truncate font-medium">{project.name}</span>
          <span
            className={clsx(
              'text-meta whitespace-nowrap text-fg-faint group-focus-within:invisible group-hover:invisible',
              menuOpen && 'invisible',
            )}
          >
            {count === null ? format.since(new Date(project.lastUsedAt)) : count}
          </span>
        </ContextMenu.Trigger>
        <ContextMenu.Popup aria-label={t.projectMenu(project.name)}>{items}</ContextMenu.Popup>
      </ContextMenu.Root>
      <Menu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <Menu.Trigger
          aria-label={t.projectMenu(project.name)}
          className={clsx(
            'absolute right-1 size-6 cursor-pointer items-center justify-center rounded-sm text-fg-muted hover:bg-line hover:text-fg group-focus-within:inline-flex group-hover:inline-flex data-popup-open:bg-line data-popup-open:text-fg',
            menuOpen ? 'inline-flex' : 'hidden',
          )}
        >
          <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Popup aria-label={t.projectMenu(project.name)}>{items}</Menu.Popup>
      </Menu.Root>
    </div>
  );
}
