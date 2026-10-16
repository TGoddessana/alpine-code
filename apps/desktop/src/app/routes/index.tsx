import type { CloneInfo, ProjectInfo } from '@alpine/protocol';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { NewSession } from '@/features/new-session/NewSession';
import { NoProject } from '@/features/new-session/NoProject';
import { useCurrentProject } from '@/features/rail/currentProject';
import { useProjects } from '@/shared/server';

/**
 * `?project=` picks the project; without it, the one the rail shows (the one shown last, else the most recently used).
 * `?agent=` is the agent to start with. A project still being cloned (or whose clone failed) is shown from its clone
 * until it arrives.
 */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { project?: string; agent?: string } => ({
    ...(typeof search.project === 'string' ? { project: search.project } : {}),
    ...(typeof search.agent === 'string' ? { agent: search.agent } : {}),
  }),
  component: NewSessionRoute,
});

function NewSessionRoute() {
  const { agent } = Route.useSearch();
  const chosen = useCurrentProject() ?? undefined;
  const navigate = useNavigate();
  const projects = useProjects();
  const shown = projects.data?.projects.filter((p) => !p.archived) ?? [];
  const clone = shown.some((p) => p.path === chosen) ? undefined : cloneAt(projects.data?.clones ?? [], chosen);
  const project = clone ? fromClone(clone) : (shown.find((p) => p.path === chosen) ?? shown[0]);
  const choose = (path: string | null) =>
    void navigate({ to: '/', search: { ...(path ? { project: path } : {}), ...(agent ? { agent } : {}) } });

  return (
    <>
      {project ? (
        <NewSession
          project={project}
          clone={clone}
          agent={agent}
          onProjectChange={choose}
          onStarted={(sessionId) => void navigate({ to: '/session/$sessionId', params: { sessionId } })}
        />
      ) : projects.isSuccess ? (
        <NoProject onProjectChange={choose} />
      ) : (
        <main className="flex min-w-120 grow flex-col bg-canvas" />
      )}
    </>
  );
}

/** The clone going to `path`; one still receiving wins over a failed one being tried again. */
function cloneAt(clones: CloneInfo[], path: string | undefined): CloneInfo | undefined {
  const at = clones.filter((c) => c.path === path);
  return at.find((c) => c.state === 'receiving') ?? at[0];
}

/** The project a clone becomes, to show before it is there. */
function fromClone(clone: CloneInfo): ProjectInfo {
  return { path: clone.path, name: clone.name, branch: null, lastUsedAt: '', archived: false, lastAgent: null };
}
