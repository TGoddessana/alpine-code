import { PROTOCOL_VERSION, type ConnectionsAddParams, type ConnectionsModelsParams } from '@alpine/protocol';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

/** The handshake: which server answered and which protocol version it speaks. */
export function useServerInfo() {
  const server = useServer();
  return useQuery({
    queryKey: ['server', 'initialize'],
    queryFn: () => server.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientName: 'desktop' }),
    staleTime: Infinity,
    retry: false, // A local server that refused the handshake will refuse it again.
  });
}

/** Saved connections, the default model and the providers a key can belong to. */
export function useConnections() {
  const server = useServer();
  return useQuery({ queryKey: ['connections'], queryFn: () => server.request('connections/list', {}), retry: false });
}

/**
 * The models a connection offers, which also checks its key. Runs only when `params` is given; a failure is a
 * `ServerError` whose `data.reason` says why.
 */
export function useConnectionModels(params: ConnectionsModelsParams | null) {
  const server = useServer();
  return useQuery({
    queryKey: ['connections', 'models', params],
    queryFn: () => server.request('connections/models', params!),
    enabled: params !== null,
    retry: false,
    staleTime: 60_000,
  });
}

/** The models of several saved connections at once, each with its saved key; for choosing the default model. */
export function useModelsOf(params: ConnectionsModelsParams[]) {
  const server = useServer();
  return useQueries({
    queries: params.map((p) => ({
      queryKey: ['connections', 'models', p],
      queryFn: () => server.request('connections/models', p),
      retry: false,
      staleTime: 60_000,
    })),
  });
}

export function useAddConnection() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: ConnectionsAddParams) => server.request('connections/add', params),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });
}

/** Folders the user works in, the most recently used first. */
export function useProjects() {
  const server = useServer();
  return useQuery({ queryKey: ['projects'], queryFn: () => server.request('projects/list', {}), retry: false });
}

export function useOpenProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => server.request('projects/open', { path }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useSetDefaultModel() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (model: string) => server.request('connections/setDefault', { model }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });
}

export function useHideProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => server.request('projects/hide', { path }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
  });
}

/** Clones and opens the repository. The server answers when git is done. */
export function useCloneProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: { address: string; parent: string }) => server.request('projects/clone', params),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
  });
}
