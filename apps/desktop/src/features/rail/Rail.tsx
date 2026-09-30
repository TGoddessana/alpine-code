import type { ProjectInfo, SessionInfo } from '@alpine/protocol';
import { ContextMenu, Menu, PanelResizer, usePanelWidth } from '@alpine/ui/primitives';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { useState } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';
import { revealInFinder, useOpenFolder } from '@/shared/platform';
import { useArchiveProject, useProjects, useSessions } from '@/shared/server';

import { DeleteProjectDialog } from './DeleteProjectDialog';
import { DeleteSessionDialog } from './DeleteSessionDialog';
import { messages } from './messages';
import { SessionRow } from './SessionRow';

const item =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-fg hover:bg-hover';
const active = { className: 'bg-canvas-raised' };

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
      className="relative flex min-w-50 shrink flex-col gap-3 border-r border-line bg-canvas-sunken px-3 py-4"
    >
      <PanelResizer panel={width} edge="right" label={t.resize} />
      {!none && (
        <Link to="/" className={item} activeProps={active} activeOptions={{ exact: true, includeSearch: false }}>
          <span className="inline-flex size-4.5 items-center justify-center text-fg-muted">
            <PlusIcon />
          </span>
          {t.newSession}
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
            <FolderIcon size={16} />
          </button>
        </div>
        {none ? (
          <button type="button" className={item} onClick={openFolder}>
            <span className="inline-flex size-4.5 items-center justify-center text-fg-muted">
              <FolderIcon size={14} />
            </span>
            <span className="grow">{t.openFolder}</span>
            <span className="text-meta text-fg-muted">⌘O</span>
          </button>
        ) : (
          shown.map((project) => (
            <div key={project.path} className="flex flex-col gap-0.5">
              <ProjectRow project={project} onDelete={setDeleting} />
              <ProjectSessions
                sessions={sessions.filter((session) => session.cwd === project.path)}
                onDelete={setDeletingSession}
              />
            </div>
          ))
        )}
      </section>
      <div className="grow" />
      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <Link to="/settings" className={item} activeProps={active}>
          {t.settings}
        </Link>
      </div>
      <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
      <DeleteSessionDialog session={deletingSession} onClose={() => setDeletingSession(null)} />
    </nav>
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
          className="flex min-h-7 w-full cursor-pointer items-center rounded-md pl-8 text-left text-meta text-fg-muted hover:bg-hover"
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
function ProjectRow({ project, onDelete }: { project: ProjectInfo; onDelete: (project: ProjectInfo) => void }) {
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
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={<Link to="/" search={{ project: project.path }} />}
          className={clsx(item, 'hover:bg-transparent')}
          title={project.path}
        >
          <span className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm bg-line-subtle text-meta text-fg-muted">
            {project.name.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 grow truncate">{project.name}</span>
          <span
            className={clsx(
              'text-meta whitespace-nowrap text-fg-muted group-focus-within:invisible group-hover:invisible',
              menuOpen && 'invisible',
            )}
          >
            {format.since(new Date(project.lastUsedAt))}
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
          <DotsIcon />
        </Menu.Trigger>
        <Menu.Popup aria-label={t.projectMenu(project.name)}>{items}</Menu.Popup>
      </Menu.Root>
    </div>
  );
}

function DotsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="7" cy="7" r="1.2" />
      <circle cx="7" cy="11" r="1.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M7 2v10M2 7h10" />
    </svg>
  );
}

function FolderIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}
