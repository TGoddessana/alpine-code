import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { NewSession } from '@/features/new-session/NewSession';
import { NoProject } from '@/features/new-session/NoProject';
import { useProjects } from '@/shared/server';

/** `?project=` picks the project; without it, the most recently used one. */
export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search.project === 'string' ? { project: search.project } : {},
  component: NewSessionRoute,
});

function NewSessionRoute() {
  const { project: chosen } = Route.useSearch();
  const navigate = useNavigate();
  const projects = useProjects();
  const shown = projects.data?.projects.filter((p) => !p.archived) ?? [];
  const project = shown.find((p) => p.path === chosen) ?? shown[0];
  const choose = (path: string) => void navigate({ to: '/', search: { project: path } });

  return (
    <>
      {project ? (
        <NewSession projects={shown} project={project} onProjectChange={choose} />
      ) : projects.isSuccess ? (
        <NoProject onProjectChange={choose} />
      ) : (
        <main className="flex min-w-120 grow flex-col bg-canvas" />
      )}
    </>
  );
}
