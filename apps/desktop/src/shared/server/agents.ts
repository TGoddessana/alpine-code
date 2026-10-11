import type { AgentInfo, AgentsListResult } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

const agentsKey = ['agents'];

/** Every agent, the default one first. */
export function useAgents() {
  const server = useServer();
  return useQuery({ queryKey: agentsKey, queryFn: () => server.request('agents/list', {}), retry: false });
}

/**
 * Saves an agent; an empty `id` adds one and the server picks its character if the asked one is taken. Resolves with
 * the saved agent. The list shows the change at once and goes back if the save fails.
 */
export function useSaveAgent() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (agent: AgentInfo) => (await server.request('agents/save', { agent })).agent,
    onMutate: async (agent) => {
      await client.cancelQueries({ queryKey: agentsKey });
      const before = client.getQueryData<AgentsListResult>(agentsKey);
      if (before && agent.id)
        client.setQueryData<AgentsListResult>(agentsKey, {
          agents: before.agents.map((a) => (a.id === agent.id ? agent : a)),
        });
      return { before };
    },
    onError: (_error, _agent, context) => {
      if (context?.before) client.setQueryData(agentsKey, context.before);
    },
    onSettled: () => client.invalidateQueries({ queryKey: agentsKey }),
  });
}

/** Deletes an agent; the default one stays. Projects that last used it fall back to the default. */
export function useDeleteAgent() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => server.request('agents/delete', { id }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: agentsKey });
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}
