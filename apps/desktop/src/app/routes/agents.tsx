import { createFileRoute } from '@tanstack/react-router';

/** `?agent=` opens that agent, `?create` opens the new-agent dialog. */
export const Route = createFileRoute('/agents')({
  validateSearch: (search: Record<string, unknown>): { agent?: string; create?: true } => ({
    ...(typeof search.agent === 'string' ? { agent: search.agent } : {}),
    ...(search.create === true || search.create === 'true' ? { create: true as const } : {}),
  }),
  component: AgentsRoute,
});

function AgentsRoute() {
  // Stage 4 fills this with features/agents.
  return <main className="flex min-w-120 grow flex-col bg-canvas" />;
}
