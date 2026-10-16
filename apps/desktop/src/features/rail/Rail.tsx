import type { CloneInfo, ProjectInfo, SessionInfo } from '@alpine/protocol';
import { ContextMenu, Menu, PanelResizer, usePanelWidth } from '@alpine/ui/primitives';
import { Link, useMatch, useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { BookMarked, Bot, ChevronDown, ChevronRight, Ellipsis, Map, Plus, Settings, SquarePen } from 'lucide-react';
import { useState } from 'react';

import { ProgressBar, ProjectAddDialog, projectAddMessages } from '@/shared/components/project-add';
import { StatusWord } from '@/shared/components/status';

import { useMessages } from '@/shared/i18n';
import { revealInFinder } from '@/shared/platform';
import { useArchiveProject, useProjects, useSessions } from '@/shared/server';

import { useCurrentProject } from './currentProject';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { DeleteSessionDialog } from './DeleteSessionDialog';
import { messages } from './messages';
import { SessionRow } from './SessionRow';

const item =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-fg hover:bg-hover';
const active = { className: 'bg-hover font-medium' };

/** A project's pages, in the order under its new session. A new page is one more entry. */
const PAGES = [
  { to: '/board', icon: Map, label: 'pageMap' },
  { to: '/memory', icon: BookMarked, label: 'pageMemory' },
] as const;

/** Sessions shown under the open project before "show more". */
const SESSIONS_SHOWN = 5;

/**
 * Where you are: every project, one line each, and only the current one open, holding its new session, its pages and
 * its sessions. Open is current: opening another project goes there. A closed project says what it is doing only when
 * it is doing something (my OK first, then work). Agents and settings, set up once and visited rarely, sit at the
 * bottom. Holds no session content.
 */
export function Rail() {
  const t = useMessages(messages);
  const added = useMessages(projectAddMessages);
  const projects = useProjects();
  const navigate = useNavigate();
  const current = useCurrentProject();
  const width = usePanelWidth({ storageKey: 'alpine.rail.width', initial: 260, min: 200, max: 360 });
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<ProjectInfo | null>(null);
  const [deletingSession, setDeletingSession] = useState<SessionInfo | null>(null);
  const sessions = useSessions().data ?? [];
  const shown = projects.data?.projects.filter((project) => !project.archived) ?? [];
  const clones = projects.data?.clones ?? [];
  const go = useGoToProject(shown);

  return (
    <nav
      aria-label={t.label}
      style={{ width: width.width }}
      className="relative flex min-w-50 shrink flex-col gap-3 bg-canvas-sunken px-3 pb-4"
    >
      <PanelResizer panel={width} edge="right" label={t.resize} />
      <section aria-label={t.projects} className="mt-1 flex min-h-0 grow flex-col gap-0.5 overflow-y-auto">
        <div className="flex min-h-7 shrink-0 items-center gap-2 px-2 text-meta text-fg-muted">
          <span className="grow">{t.projects}</span>
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={added.addProject}
            title={added.addProject}
            className="inline-flex size-7 cursor-pointer items-center justify-center rounded-md text-fg-muted hover:bg-hover"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        {projects.isSuccess && shown.length === 0 && clones.length === 0 && (
          <button type="button" className={item} onClick={() => setAdding(true)}>
            <Plus size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
            {added.addProjectItem}
          </button>
        )}
        {[...clones].reverse().map((clone) => (
          <CloneRow key={clone.id} clone={clone} current={clone.path === current} />
        ))}
        {shown.map((project) =>
          project.path === current ? (
            <OpenProject
              key={project.path}
              project={project}
              sessions={sessions.filter((session) => session.cwd === project.path)}
              onDelete={setDeleting}
              onDeleteSession={setDeletingSession}
            />
          ) : (
            <ProjectRow
              key={project.path}
              project={project}
              open={false}
              sessions={sessions.filter((session) => session.cwd === project.path)}
              onOpen={() => go(project.path)}
              onDelete={setDeleting}
            />
          ),
        )}
      </section>
      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <Link to="/agents" className={item} activeProps={active}>
          <Bot size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
          {t.agents}
        </Link>
        <Link to="/settings" className={item} activeProps={active}>
          <Settings size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
          {t.settings}
        </Link>
      </div>
      <ProjectAddDialog
        open={adding}
        onOpenChange={setAdding}
        onDone={(path) => void navigate({ to: '/', search: { project: path } })}
      />
      <DeleteProjectDialog project={deleting} onClose={() => setDeleting(null)} />
      <DeleteSessionDialog session={deletingSession} onClose={() => setDeletingSession(null)} />
    </nav>
  );
}

/** Going to another project keeps the page (map, memory) if there is one, else opens the project's new session. */
function useGoToProject(projects: ProjectInfo[]) {
  const navigate = useNavigate();
  const board = useMatch({ from: '/board', shouldThrow: false });
  const memory = useMatch({ from: '/memory', shouldThrow: false });
  return (path: string) => {
    const isProject = projects.some((p) => p.path === path);
    if (board && isProject) void navigate({ to: '/board', search: { project: path } });
    else if (memory && isProject) void navigate({ to: '/memory', search: { project: path } });
    else void navigate({ to: '/', search: { project: path } });
  };
}

/** The current project: its row, then under a guide line its new session, its pages and its sessions. */
function OpenProject({
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
  const t = useMessages(messages);
  const [all, setAll] = useState(false);
  const listed = all ? sessions : sessions.slice(0, SESSIONS_SHOWN);
  const hidden = sessions.length - SESSIONS_SHOWN;
  return (
    <div className="flex flex-col gap-0.5">
      <ProjectRow project={project} open sessions={sessions} onDelete={onDelete} />
      <div className="ml-4 flex flex-col gap-0.5 border-l border-line pl-2">
        <Link to="/" search={{ project: project.path }} className={item}>
          <SquarePen size={16} strokeWidth={1.5} className="text-interactive" aria-hidden="true" />
          <span className="grow">{t.newSession}</span>
          <span className="text-meta text-fg-faint">⌘N</span>
        </Link>
        <nav aria-label={t.projectPages(project.name)} className="flex flex-col gap-0.5">
          {PAGES.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} search={{ project: project.path }} className={item} activeProps={active}>
              <Icon size={16} strokeWidth={1.5} className="text-fg-muted" aria-hidden="true" />
              {t[label]}
            </Link>
          ))}
        </nav>
        {sessions.length > 0 && (
          <div className="mt-1 flex flex-col gap-0.5">
            {listed.map((session) => (
              <SessionRow key={session.id} session={session} onDelete={onDeleteSession} />
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
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A project's line. Closed, it opens the project (and says what it is doing, when it is doing something); open, it is
 * where I am and does nothing more. Hovering or focusing it shows ⋮, which opens the project's menu; right-clicking
 * opens the same menu.
 */
function ProjectRow({
  project,
  open,
  sessions,
  onOpen,
  onDelete,
}: {
  project: ProjectInfo;
  open: boolean;
  sessions: SessionInfo[];
  onOpen?: () => void;
  onDelete: (project: ProjectInfo) => void;
}) {
  const t = useMessages(messages);
  const navigate = useNavigate();
  const archive = useArchiveProject();
  const [menuOpen, setMenuOpen] = useState(false);
  const status = open
    ? null
    : sessions.some((s) => s.status === 'waiting')
      ? 'waiting'
      : sessions.some((s) => s.status === 'running')
        ? 'running'
        : null;

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
      className={clsx('group relative flex items-center rounded-md hover:bg-hover', (open || menuOpen) && 'bg-hover')}
    >
      <ContextMenu.Root>
        <ContextMenu.Trigger
          render={<button type="button" onClick={onOpen} aria-expanded={open} />}
          className={clsx(item, 'pr-8 hover:bg-transparent', open ? 'cursor-default font-medium' : '')}
          title={project.path}
        >
          {open ? (
            <ChevronDown size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden="true" />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} className="shrink-0 text-fg-muted" aria-hidden="true" />
          )}
          <span className="min-w-0 grow truncate">{project.name}</span>
          {status && (
            <StatusWord
              status={status}
              className={clsx('group-focus-within:invisible group-hover:invisible', menuOpen && 'invisible')}
            />
          )}
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

/** A project on its way: how far it got, or that it did not arrive. Opens its new session screen, which says more. */
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
