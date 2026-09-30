import type { ProjectInfo } from '@alpine/protocol';
import { ContextMenu, PanelResizer, usePanelWidth } from '@alpine/ui/primitives';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

import { useFormat, useMessages } from '@/shared/i18n';
import { revealInFinder, useOpenFolder } from '@/shared/platform';
import { useHideProject, useProjects } from '@/shared/server';

import { messages } from './messages';

const item =
  'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-body text-fg hover:bg-hover';
const active = { className: 'bg-canvas-raised' };

/** Where you are: my turn, projects and their sessions. Holds no session content. */
export function Rail() {
  const t = useMessages(messages);
  const projects = useProjects();
  const navigate = useNavigate();
  const openFolder = useOpenFolder((path) => void navigate({ to: '/', search: { project: path } }));
  const shown = projects.data?.projects.filter((project) => !project.hidden) ?? [];
  const none = projects.isSuccess && shown.length === 0;
  const width = usePanelWidth({ storageKey: 'alpine.rail.width', initial: 260, min: 200, max: 360 });

  return (
    <nav
      aria-label={t.label}
      style={{ width: width.width }}
      className="relative flex min-w-50 shrink flex-col gap-3 border-r border-line bg-canvas-sunken px-3 py-4"
    >
      <PanelResizer panel={width} edge="right" label={t.resize} />
      <div className="flex min-h-8 items-center gap-2 pr-1 pl-2">
        <HareMark />
        <span className="font-display text-title">Alpine</span>
      </div>
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
          shown.map((project) => <ProjectRow key={project.path} project={project} />)
        )}
      </section>
      <div className="grow" />
      <div className="flex flex-col gap-0.5 border-t border-line pt-3">
        <Link to="/settings" className={item} activeProps={active}>
          {t.settings}
        </Link>
      </div>
    </nav>
  );
}

/** A project: opens a new session in it. Right-click for the rest. */
function ProjectRow({ project }: { project: ProjectInfo }) {
  const t = useMessages(messages);
  const format = useFormat();
  const navigate = useNavigate();
  const hide = useHideProject();
  const chosen = useSearch({ strict: false, select: (search: { project?: string }) => search.project });
  const newSession = () => void navigate({ to: '/', search: { project: project.path } });
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        render={<Link to="/" search={{ project: project.path }} />}
        className={item + (chosen === project.path ? ' bg-hover' : '')}
        title={project.path}
      >
        <span className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm bg-line-subtle text-meta text-fg-muted">
          {project.name.charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 grow truncate">{project.name}</span>
        <span className="text-meta whitespace-nowrap text-fg-muted">{format.since(new Date(project.lastUsedAt))}</span>
      </ContextMenu.Trigger>
      <ContextMenu.Popup aria-label={t.projectMenu(project.name)}>
        <ContextMenu.Item onClick={newSession}>{t.newSession}</ContextMenu.Item>
        <ContextMenu.Item onClick={() => void revealInFinder(project.path)}>{t.revealInFinder}</ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item onClick={() => hide.mutate(project.path)}>{t.hide}</ContextMenu.Item>
      </ContextMenu.Popup>
    </ContextMenu.Root>
  );
}

/** The snow hare: two long ears over a round head. */
function HareMark() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 30 30"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 14C9 9 9 4 11 2.5C13 4 13.5 9 12.8 14" />
      <path d="M17.2 14C16.5 9 17 4 19 2.5C21 4 21 9 19 14" />
      <ellipse cx="15" cy="19.5" rx="7.5" ry="6.5" />
      <circle cx="17.6" cy="18.5" r="0.9" fill="currentColor" stroke="none" />
      <path d="M14 22.5h2" />
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
