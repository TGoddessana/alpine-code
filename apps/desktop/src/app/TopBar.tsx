import { useMatch, useRouter } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, GitBranch, PanelLeft } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { PanelToggle, useWorkResultOpen } from '@/features/work-result/PanelToggle';
import { workResult } from '@/features/work-result/results';
import { StatusWord } from '@/shared/components/status';
import { useMessages } from '@/shared/i18n';
import { useProjectGit, useProjects, useSession } from '@/shared/server';

import { messages } from './messages';

const iconButton =
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg';

/**
 * The one line over the whole window: room for the traffic lights, the sidebar button, back and forward, then for a
 * session where it runs (project, branch) and its state, and at the far end the work result button. The bar and its
 * empty parts drag the window; the buttons never do.
 */
export function TopBar({ railOpen, onToggleRail }: { railOpen: boolean; onToggleRail: () => void }) {
  const t = useMessages(messages);
  const router = useRouter();
  const match = useMatch({ from: '/session/$sessionId', shouldThrow: false });
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
      ) : (
        <span data-tauri-drag-region className="grow self-stretch" />
      )}
    </div>
  );
}

/** Project, branch and state of the open session, and the work result button at the end. */
function SessionPart({ sessionId }: { sessionId: string }) {
  const t = useMessages(messages);
  const session = useSession(sessionId);
  const projects = useProjects();
  const info = session.data && !session.data.deleted ? session.data.info : undefined;
  const git = useProjectGit(info?.cwd ?? '');
  const [open, setOpen] = useWorkResultOpen();
  const items = session.data?.items;
  const result = useMemo(() => workResult(items ?? []), [items]);
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
      <PanelToggle open={open} files={result.files.length} onToggle={() => setOpen(!open)} />
    </>
  );
}

function Drag({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div data-tauri-drag-region className={`flex min-w-0 grow items-center self-stretch ${className}`}>
      {children}
    </div>
  );
}
