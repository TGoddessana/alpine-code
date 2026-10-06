import {
  PROTOCOL_VERSION,
  type ConnectionsAddParams,
  type ConnectionsModelsParams,
  type ConnectionsModelsResult,
  type ConnectionsShowModelParams,
  type SettingsGetResult,
} from '@alpine/protocol';
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

/**
 * The models the picker offers: all but the hidden ones (by default each family's newest; see `connections/showModel`),
 * plus `keep` (the model in use) so the current choice never disappears.
 */
export function shownModels(result: ConnectionsModelsResult | undefined, keep: (string | null | undefined)[] = []) {
  if (!result) return [];
  const hidden = new Set(result.hidden);
  return result.models.filter((model) => !hidden.has(model) || keep.includes(model));
}

/** Shows a model of a saved connection in the picker, or leaves it out. */
export function useShowModel() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: ConnectionsShowModelParams) => server.request('connections/showModel', params),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections', 'models'] }),
  });
}

/** Forgets a connection and its saved key; a default model on it is cleared. */
export function useRemoveConnection() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (connection: string) => server.request('connections/remove', { connection }),
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

/** What new sessions start with besides the model: the permission mode (shared with the terminal). */
export function useSettings() {
  const server = useServer();
  return useQuery({ queryKey: ['settings'], queryFn: () => server.request('settings/get', {}), retry: false });
}

export function useSetDefaultMode() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (mode: SettingsGetResult['mode']) => server.request('settings/setMode', { mode }),
    onSuccess: (result) => client.setQueryData(['settings'], result),
  });
}

export function useArchiveProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => server.request('projects/archive', { path }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
  });
}

/** Forgets the project in Alpine. The folder and its files stay. */
export function useDeleteProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => server.request('projects/delete', { path }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['projects'] }),
  });
}

/** The project's branch, what it changes and its pull request. Refreshed while the window is open. */
export function useProjectGit(path: string) {
  const server = useServer();
  return useQuery({
    queryKey: ['projects', 'git', path],
    queryFn: () => server.request('projects/git', { path }),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
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
