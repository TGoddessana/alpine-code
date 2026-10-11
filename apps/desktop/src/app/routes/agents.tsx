import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { Agents } from '@/features/agents/Agents';

/** `?agent=` opens that agent, `?create` opens the new-agent dialog. */
export const Route = createFileRoute('/agents')({
  validateSearch: (search: Record<string, unknown>): { agent?: string; create?: true } => ({
    ...(typeof search.agent === 'string' ? { agent: search.agent } : {}),
    ...(search.create === true || search.create === 'true' ? { create: true as const } : {}),
  }),
  component: AgentsRoute,
});

function AgentsRoute() {
  const { agent, create } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <main className="flex min-w-120 grow flex-col overflow-hidden bg-canvas">
      <Agents
        agentId={agent}
        creating={!!create}
        onChange={(search) => void navigate({ to: '/agents', search, replace: true })}
      />
    </main>
  );
}
