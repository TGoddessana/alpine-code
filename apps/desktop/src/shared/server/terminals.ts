import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

export function useTerminals(cwd: string) {
  const server = useServer();
  return useQuery({
    queryKey: ['terminals', cwd],
    queryFn: () => server.request('terminals/list', { cwd }),
    refetchInterval: 1000,
    retry: false,
  });
}

export function useTerminalOutput(processId: string | null) {
  const server = useServer();
  const client = useQueryClient();
  const key = ['terminal-output', processId];
  return useQuery({
    queryKey: key,
    enabled: processId !== null,
    queryFn: async () => {
      const previous = client.getQueryData<{ text: string; offset: number; omitted: boolean }>(key);
      const result = await server.request('terminals/read', { processId: processId!, offset: previous?.offset ?? 0 });
      const text = (previous?.text ?? '') + result.text;
      return {
        text: text.slice(-1_000_000),
        offset: result.nextOffset,
        omitted: previous?.omitted || text.length > 1_000_000,
        process: result.process,
      };
    },
    refetchInterval: 250,
    retry: false,
  });
}

export function useStartTerminal(cwd: string, sessionId?: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ command, title }: { command: string; title?: string }) =>
      server.request('terminals/start', { cwd, command, title, sessionId }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['terminals', cwd] }),
  });
}
