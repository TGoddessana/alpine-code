import { createFileRoute } from '@tanstack/react-router';

import { Memory } from '@/features/memory/Memory';

/** `?project=` is the project folder whose memory to show. */
export const Route = createFileRoute('/memory')({
  validateSearch: (search: Record<string, unknown>): { project?: string } =>
    typeof search.project === 'string' ? { project: search.project } : {},
  component: MemoryRoute,
});

function MemoryRoute() {
  const { project } = Route.useSearch();
  return (
    <main className="flex min-w-120 grow flex-col overflow-y-auto bg-canvas">
      <Memory project={project ?? null} />
    </main>
  );
}
