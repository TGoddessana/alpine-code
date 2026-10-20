import type { CloneInfo, ProjectInfo } from '@alpine/protocol';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { NewSession } from '@/features/new-session/NewSession';
import { NoProject } from '@/features/new-session/NoProject';
import { useCurrentProject } from '@/features/rail/currentProject';
import { useCloudEnabled, useProjects } from '@/shared/server';

/**
 * `?project=` picks the project; without it, the one the rail shows (the one shown last, else the most recently used).
 * `?agent=` is the agent to start with. `?new=1` is 새로 만들기: no project, the agent only picks a setup for the idea
 * (the screen shows even when there are no projects at all). A project still being cloned (or whose clone failed) is
 * shown from its clone until it arrives.
 */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { project?: string; agent?: string; new?: 1 } => ({
    ...(typeof search.project === 'string' ? { project: search.project } : {}),
    ...(typeof search.agent === 'string' ? { agent: search.agent } : {}),
    ...(isOn(search.new) ? { new: 1 as const } : {}),
  }),
  component: NewSessionRoute,
});

/** `?new=1` parses as the number 1; `true` and the text spellings are taken too. */
const isOn = (value: unknown) => value === 1 || value === '1' || value === true || value === 'true';

function NewSessionRoute() {
  const { agent, new: wanted } = Route.useSearch();
  const cloud = useCloudEnabled();
  const making = wanted && cloud; // a stale `?new=1` means nothing without Alpine Cloud
  const chosen = useCurrentProject() ?? undefined;
  const navigate = useNavigate();
  const projects = useProjects();
  const shown = projects.data?.projects.filter((p) => !p.archived) ?? [];
  const clone = shown.some((p) => p.path === chosen) ? undefined : cloneAt(projects.data?.clones ?? [], chosen);
  const project = clone ? fromClone(clone) : (shown.find((p) => p.path === chosen) ?? shown[0]);
  const choose = (path: string | null) =>
    void navigate({ to: '/', search: { ...(path ? { project: path } : {}), ...(agent ? { agent } : {}) } });
  const makeNew = () => void navigate({ to: '/', search: { new: 1, ...(agent ? { agent } : {}) } });

  return (
    <>
      {making || project ? (
        <NewSession
          project={making ? null : (project ?? null)}
          clone={making ? undefined : clone}
          agent={agent}
          onProjectChange={choose}
          onNewProject={makeNew}
          onStarted={(sessionId) => void navigate({ to: '/session/$sessionId', params: { sessionId } })}
        />
      ) : projects.isSuccess ? (
        <NoProject onProjectChange={choose} onNewProject={makeNew} />
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
