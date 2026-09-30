import type { ProfileInfo, ToolsSaveParams, ToolsTestParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

/** Built-in tools and the user's tool files, each with its state. */
export function useTools() {
  const server = useServer();
  return useQuery({ queryKey: ['tools'], queryFn: () => server.request('tools/list', {}), retry: false });
}

/** A tool file's text, for the editor. */
export function useToolSource(name: string | null) {
  const server = useServer();
  return useQuery({
    queryKey: ['tools', 'source', name],
    queryFn: () => server.request('tools/source', { name: name! }),
    enabled: name !== null,
    retry: false,
    staleTime: Infinity,
  });
}

/** Loads unsaved code on the server: what the model will see, or why it cannot load. Runs the code. */
export function useCheckTool() {
  const server = useServer();
  return useMutation({ mutationFn: (source: string) => server.request('tools/check', { source }) });
}

export function useSaveTool() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: ToolsSaveParams) => server.request('tools/save', params),
    onSuccess: (_, params) => {
      void client.invalidateQueries({ queryKey: ['tools'] });
      void client.invalidateQueries({ queryKey: ['profiles'] });
      client.removeQueries({ queryKey: ['tools', 'source', params.name] });
    },
  });
}

/** Accepts a file that changed outside the app, so it loads again. */
export function useConfirmTool() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => server.request('tools/confirm', { name }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['tools'] }),
  });
}

export function useDeleteTool() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => server.request('tools/delete', { name }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['tools'] });
      void client.invalidateQueries({ queryKey: ['profiles'] });
    },
  });
}

/** Approves and installs packages Alpine has not reviewed. */
export function useInstallPackages() {
  const server = useServer();
  return useMutation({ mutationFn: (packages: string[]) => server.request('tools/install', { packages }) });
}

export function useTestTool() {
  const server = useServer();
  return useMutation({ mutationFn: (params: ToolsTestParams) => server.request('tools/test', params) });
}

/** Asks the default model to write a tool file; nothing runs or is saved. */
export function useDraftTool() {
  const server = useServer();
  return useMutation({ mutationFn: (description: string) => server.request('tools/draft', { description }) });
}

/** Every profile, the default one first. */
export function useProfiles() {
  const server = useServer();
  return useQuery({ queryKey: ['profiles'], queryFn: () => server.request('profiles/list', {}), retry: false });
}

export function useSaveProfile() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (profile: ProfileInfo) => (await server.request('profiles/save', { profile })).profile,
    onSuccess: () => client.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

export function useDeleteProfile() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => server.request('profiles/delete', { id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

/** The profile a new session in `cwd` with `model` would take. */
export function useResolveProfile(cwd: string, model: string | null) {
  const server = useServer();
  return useQuery({
    queryKey: ['profiles', 'resolve', cwd, model],
    queryFn: async () => (await server.request('profiles/resolve', { cwd, model })).profile,
    retry: false,
  });
}
