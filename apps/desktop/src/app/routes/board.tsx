import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { ProductMap } from '@/features/product-map/ProductMap';
import { Session } from '@/features/session/Session';
import { useProjects, useSession } from '@/shared/server';

export const Route = createFileRoute('/board')({
  validateSearch: (search: Record<string, unknown>): { project?: string; session?: string } => ({
    ...(typeof search.project === 'string' ? { project: search.project } : {}),
    ...(typeof search.session === 'string' ? { session: search.session } : {}),
  }),
  component: BoardRoute,
});

function BoardRoute() {
  const { project: chosen, session } = Route.useSearch();
  const projects = useProjects();
  const navigate = useNavigate();
  const attached = useSession(session ?? null);
  const project = projects.data?.projects.find((p) => p.path === chosen && !p.archived);
  if (!project) return <div className="p-8 text-body text-fg-muted">{projects.isLoading ? '…' : (chosen ?? '—')}</div>;
  return (
    <ProductMap
      key={project.path}
      cwd={project.path}
      sessionId={session ?? null}
      demo={!('__TAURI_INTERNALS__' in window)}
      onSession={(id) => void navigate({ to: '/board', search: { project: project.path, session: id }, replace: true })}
      conversation={
        session && attached.data?.info.cwd === project.path && !attached.data.deleted ? (
          <Session key={session} sessionId={session} />
        ) : undefined
      }
    />
  );
}
