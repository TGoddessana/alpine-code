import type { MemoryForgetParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useServer } from './context';

/**
 * A project's memories and the suggestions waiting for me. Fetched again whenever the server says the project's
 * memory changed (the agent suggested something, another window approved it).
 */
export function useMemory(cwd: string | null) {
  const server = useServer();
  const client = useQueryClient();
  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method === 'memory/changed') void client.invalidateQueries({ queryKey: ['memory'] });
      }),
    [server, client],
  );
  return useQuery({
    queryKey: ['memory', cwd],
    queryFn: () => server.request('memory/list', { cwd: cwd! }),
    enabled: cwd !== null,
    retry: false,
  });
}

/** Keeps a suggestion. Open sessions hear of it from their next step. */
export function useApproveMemory() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ cwd, suggestionId }: { cwd: string; suggestionId: string }) =>
      server.request('memory/approve', { cwd, suggestionId }),
    onSettled: () => client.invalidateQueries({ queryKey: ['memory'] }),
  });
}

/** Declines a suggestion; it is not suggested again for the same reason. */
export function useRejectMemory() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ cwd, suggestionId }: { cwd: string; suggestionId: string }) =>
      server.request('memory/reject', { cwd, suggestionId }),
    onSettled: () => client.invalidateQueries({ queryKey: ['memory'] }),
  });
}

export function useForgetMemory() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: MemoryForgetParams) => server.request('memory/forget', params),
    onSettled: () => client.invalidateQueries({ queryKey: ['memory'] }),
  });
}
