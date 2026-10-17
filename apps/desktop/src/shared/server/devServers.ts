import type { DevServersStartParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

export function useDevelopmentServers(cwd: string) {
  const server = useServer();
  return useQuery({
    queryKey: ['devServers', cwd],
    queryFn: () => server.request('devServers/list', { cwd }),
    enabled: !!cwd,
    refetchInterval: 1500,
  });
}

export function useDevelopmentServerActions() {
  const server = useServer();
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['devServers'] });
  };
  return {
    start: useMutation({
      mutationFn: (params: DevServersStartParams) => server.request('devServers/start', params),
      onSuccess: refresh,
    }),
    stop: useMutation({
      mutationFn: (id: string) => server.request('devServers/stop', { id }),
      onSuccess: refresh,
    }),
    restart: useMutation({
      mutationFn: (id: string) => server.request('devServers/restart', { id }),
      onSuccess: refresh,
    }),
  };
}

export function useDevelopmentServerLogs(id: string | null) {
  const server = useServer();
  const client = useQueryClient();
  const queryKey = ['devServers', 'logs', id];
  return useQuery({
    queryKey,
    queryFn: async () => {
      const previous = client.getQueryData<{ text: string; nextOffset: number; total: number }>(queryKey);
      const page = await server.request('devServers/logs', {
        id: id!,
        offset: previous?.nextOffset ?? 0,
        limit: 262144,
      });
      return { ...page, text: (previous?.text ?? '') + page.text };
    },
    enabled: id !== null,
    refetchInterval: 1000,
  });
}
