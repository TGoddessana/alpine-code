import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { Agents } from '@/features/agents/Agents';

/** `?agent=` opens that agent, `?create` opens the new-agent dialog, `?library=skill` opens the library's skills. */
export const Route = createFileRoute('/agents')({
  validateSearch: (search: Record<string, unknown>): { agent?: string; create?: true; library?: 'skill' } => ({
    ...(typeof search.agent === 'string' ? { agent: search.agent } : {}),
    ...(search.create === true || search.create === 'true' ? { create: true as const } : {}),
    ...(search.library === 'skill' ? { library: 'skill' as const } : {}),
  }),
  component: AgentsRoute,
});

function AgentsRoute() {
  const { agent, create, library } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <main className="flex min-w-120 grow flex-col overflow-hidden bg-canvas">
      <Agents
        agentId={agent}
        creating={!!create}
        library={library}
        onChange={(search) => void navigate({ to: '/agents', search, replace: true })}
      />
    </main>
  );
}
