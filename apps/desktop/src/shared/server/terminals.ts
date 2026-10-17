import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';
import type { ServerConnection } from './connection';
import type { TerminalsProcessResult } from '@alpine/protocol';

const defaultStarts = new WeakMap<ServerConnection, Map<string, Promise<TerminalsProcessResult>>>();

export function useTerminals(cwd: string) {
  const server = useServer();
  return useQuery({
    queryKey: ['terminals', cwd],
    queryFn: () => server.request('terminals/list', { cwd }),
    refetchInterval: 1000,
    retry: false,
  });
}

export function useStartTerminal(cwd: string, sessionId?: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      command,
      title,
      kind,
      defaultShell,
    }: {
      command: string;
      title?: string;
      kind?: 'shell' | 'command';
      defaultShell?: boolean;
    }) => {
      const launch = () => server.request('terminals/start', { cwd, command, title, sessionId, kind });
      if (!defaultShell) return launch();
      let pending = defaultStarts.get(server);
      if (!pending) {
        pending = new Map();
        defaultStarts.set(server, pending);
      }
      let request = pending.get(cwd);
      if (!request) {
        request = launch().finally(() => pending.delete(cwd));
        pending.set(cwd, request);
      }
      return request;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['terminals', cwd] }),
  });
}
