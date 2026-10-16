import { Link, useMatch, useRouter } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, GitBranch, PanelLeft } from 'lucide-react';
import { type ReactNode } from 'react';

import { DockToggle } from '@/features/dock/Dock';
import { useCurrentProject } from '@/features/rail/currentProject';
import { useWorkResult } from '@/features/work-result/useWorkResult';
import { StatusWord } from '@/shared/components/status';
import { useMessages } from '@/shared/i18n';
import { restartToUpdate, useUpdateReady } from '@/shared/platform';
import { useProjectGit, useProjects, useSession } from '@/shared/server';

import { menuMessages, messages } from './messages';

const iconButton =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg';

/**
 * The one line over the whole window: room for the traffic lights, the sidebar button, back and forward, then for a
 * session where it runs (project, branch) and its state (on the product map, the project), at the far end the dock button, and after it the update button once a new version is ready. The bar and its
 * empty parts drag the window; the buttons never do. On a new session the project is named only while the rail, which
 * names it otherwise, is hidden.
 */
export function TopBar({ railOpen, onToggleRail }: { railOpen: boolean; onToggleRail: () => void }) {
  const t = useMessages(messages);
  const router = useRouter();
  const match = useMatch({ from: '/session/$sessionId', shouldThrow: false });
  const board = useMatch({ from: '/board', shouldThrow: false });
  const memory = useMatch({ from: '/memory', shouldThrow: false });
  const start = useMatch({ from: '/', shouldThrow: false });
  return (
    <div data-tauri-drag-region className="flex h-11.5 shrink-0 items-center gap-1 bg-canvas-sunken pr-3 pl-20">
      <button
        type="button"
        aria-label={railOpen ? t.hideSidebar : t.showSidebar}
        aria-pressed={railOpen}
        onClick={onToggleRail}
        className={iconButton}
      >
        <PanelLeft size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button type="button" aria-label={t.back} onClick={() => router.history.back()} className={iconButton}>
        <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      <button type="button" aria-label={t.forward} onClick={() => router.history.forward()} className={iconButton}>
        <ArrowRight size={18} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {match ? (
        <SessionPart sessionId={match.params.sessionId} />
      ) : board ? (
        <BoardPart project={board.search.project} sessionId={board.search.session ?? null} />
      ) : memory ? (
        <ProjectPages project={memory.search.project} current="memory" />
      ) : start && !railOpen ? (
        <NewSessionPart />
      ) : (
        <span data-tauri-drag-region className="grow self-stretch" />
      )}
      <UpdateButton />
    </div>
  );
}

/** Once a newer version has downloaded: restart into it now (it installs on quit otherwise). */
function UpdateButton() {
  const t = useMessages(menuMessages);
  const version = useUpdateReady();
  if (!version) return null;
  return (
    <button
      type="button"
      title={t.updateReadyTitle(version)}
      onClick={() => void restartToUpdate()}
      className="ml-1 shrink-0 cursor-pointer rounded-full bg-interactive px-3 py-1 text-meta font-medium text-on-fill hover:bg-interactive-hover"
    >
      {t.restartToUpdate}
    </button>
  );
}

/** Project, branch and state of the open session, and the dock button at the end. */
function SessionPart({ sessionId }: { sessionId: string }) {
  const t = useMessages(messages);
  const session = useSession(sessionId);
  const projects = useProjects();
  const info = session.data && !session.data.deleted ? session.data.info : undefined;
  const git = useProjectGit(info?.cwd ?? '');
  const result = useWorkResult(sessionId);
  const project = info && (projects.data?.projects.find((p) => p.path === info.cwd)?.name ?? info.cwd.split('/').pop());
  const branch = info && git.data?.git ? (git.data.git.branch ?? t.noBranch) : null;

  return (
    <>
      <Drag className="ml-3 gap-2">
        {project && (
          <span className="truncate text-body font-medium" title={info?.cwd}>
            {project}
          </span>
        )}
        {branch && (
          <span
            aria-label={`${t.branch} ${branch}`}
            className="inline-flex min-w-0 items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-meta text-fg-muted"
          >
            <GitBranch size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{branch}</span>
          </span>
        )}
        {info && <StatusWord status={info.status} className="ml-1" />}
      </Drag>
      {info && (
        <Link
          to="/board"
          search={{ project: info.cwd, session: sessionId }}
          className="mr-2 rounded-md px-2 py-1 text-body text-interactive hover:bg-hover"
        >
          {t.productMap}
        </Link>
      )}
      <DockToggle files={result?.files.length} />
    </>
  );
}

/** The project of the product map, and the dock button counting the changed files of the attached session. */
function BoardPart({ project, sessionId }: { project?: string; sessionId: string | null }) {
  const projects = useProjects();
  const result = useWorkResult(sessionId, project);
  const listed = projects.data?.projects.find((p) => p.path === project);
  const name = project && (listed?.name ?? project.split('/').pop());
  // The board renders no dock for a project that is missing or archived, so the toggle would open nothing.
  const shown = !!listed && !listed.archived;
  return (
    <>
      <Drag className="ml-3 gap-2">
        {name && (
          <span className="truncate text-body font-medium" title={project}>
            {name}
          </span>
        )}
        {shown && <PageTabs project={project} current="map" />}
      </Drag>
      {shown && <DockToggle files={result?.files.length} />}
    </>
  );
}

/** The project a new session starts in. */
function NewSessionPart() {
  const projects = useProjects().data;
  const current = useCurrentProject();
  const name =
    [...(projects?.projects ?? []), ...(projects?.clones ?? [])].find((p) => p.path === current)?.name ?? null;
  return (
    <Drag className="ml-3 gap-2">
      {name && (
        <span className="truncate text-body font-medium" title={current ?? undefined}>
          {name}
        </span>
      )}
    </Drag>
  );
}

/** The project name and its page tabs, on a page with no dock (the memory). */
function ProjectPages({ project, current }: { project?: string; current: 'map' | 'memory' }) {
  const projects = useProjects();
  const listed = projects.data?.projects.find((p) => p.path === project);
  const name = project && (listed?.name ?? project.split('/').pop());
  return (
    <Drag className="ml-3 gap-2">
      {name && (
        <span className="truncate text-body font-medium" title={project}>
          {name}
        </span>
      )}
      {!!listed && !listed.archived && <PageTabs project={project} current={current} />}
    </Drag>
  );
}

/** Map | Memory of one project. They navigate, so they are links (the current one aria-current), not tabs. */
function PageTabs({ project, current }: { project?: string; current: 'map' | 'memory' }) {
  const t = useMessages(messages);
  const tab =
    'rounded-md px-2 py-0.5 text-meta text-fg-muted hover:text-fg aria-[current=page]:bg-canvas-raised aria-[current=page]:font-medium aria-[current=page]:text-fg aria-[current=page]:shadow-sm';
  return (
    <nav aria-label={t.pages} className="ml-1 flex shrink-0 items-center gap-0.5 rounded-lg bg-hover p-0.5">
      <Link to="/board" search={{ project }} className={tab} aria-current={current === 'map' ? 'page' : undefined}>
        {t.pageMap}
      </Link>
      <Link to="/memory" search={{ project }} className={tab} aria-current={current === 'memory' ? 'page' : undefined}>
        {t.pageMemory}
      </Link>
    </nav>
  );
}

function Drag({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div data-tauri-drag-region="deep" className={`flex min-w-0 grow items-center self-stretch ${className}`}>
      {children}
    </div>
  );
}
