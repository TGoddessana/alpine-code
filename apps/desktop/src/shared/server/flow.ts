import type { FlowPrepareParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

export function useProductMap(cwd: string) {
  const server = useServer();
  return useQuery({
    queryKey: ['product-map', cwd],
    queryFn: () => server.request('flow/get', { cwd }),
    // Agents edit the project document using ordinary tools. Poll also catches edits made outside Alpine.
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function usePrepareFlow() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: FlowPrepareParams) => server.request('flow/prepare', params),
    onSuccess: (result, params) => client.setQueryData(['product-map', params.cwd], result.board),
    onError: (_, params) => void client.invalidateQueries({ queryKey: ['product-map', params.cwd] }),
  });
}
