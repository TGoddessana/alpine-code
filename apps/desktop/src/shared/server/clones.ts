import type {
  CloneInfo,
  ProjectsCloneChangedParams,
  ProjectsCloneParams,
  ProjectsListResult,
  SettingsGetResult,
} from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useServer } from './context';

/**
 * Keeps `projects/list`'s clones current from `projects/cloneChanged`: progress replaces the clone, a finished one
 * leaves the list (and its project joins the projects), a cancelled one leaves. Mounted once, at the app's root.
 */
export function useCloneUpdates() {
  const server = useServer();
  const client = useQueryClient();
  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'projects/cloneChanged') return;
        const { clone } = notification.params as ProjectsCloneChangedParams;
        client.setQueryData(['projects'], (old: ProjectsListResult | undefined) => old && withClone(old, clone));
        if (clone.state === 'done') void client.invalidateQueries({ queryKey: ['projects'] });
      }),
    [server, client],
  );
}

function withClone(list: ProjectsListResult, clone: CloneInfo): ProjectsListResult {
  const others = list.clones.filter((c) => c.id !== clone.id);
  const stays = clone.state === 'receiving' || clone.state === 'failed';
  const at = list.clones.findIndex((c) => c.id === clone.id);
  const clones = stays
    ? at < 0
      ? [...others, clone]
      : list.clones.map((c) => (c.id === clone.id ? clone : c))
    : others;
  return { ...list, clones };
}

/**
 * Brings a repository into the clone folder. Answers once the host has answered: with `project` when it is already
 * here or done, else with `clone`, which goes on in the background (`useCloneUpdates`).
 */
export function useCloneProject() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: ProjectsCloneParams) => server.request('projects/clone', params),
    onSuccess: ({ clone }) => {
      if (clone)
        client.setQueryData(['projects'], (old: ProjectsListResult | undefined) => old && withClone(old, clone));
      void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/** Stops a clone and removes what it wrote, or dismisses a failed one. */
export function useCancelClone() {
  const server = useServer();
  return useMutation({ mutationFn: (id: string) => server.request('projects/cancelClone', { id }) });
}

/** Whether git can run, and whether this computer has an installer for it (macOS). */
export function useGitTools() {
  const server = useServer();
  return useQuery({
    queryKey: ['projects', 'gitTools'],
    queryFn: () => server.request('projects/gitTools', {}),
    retry: false,
  });
}

/** Opens Apple's installer for the command line developer tools. */
export function useInstallGitTools() {
  const server = useServer();
  return useMutation({ mutationFn: () => server.request('projects/installGitTools', {}) });
}

/** Where cloned repositories go; `null` goes back to ~/AlpineCode. */
export function useSetCloneFolder() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (cloneFolder: string | null) => server.request('settings/setCloneFolder', { cloneFolder }),
    onSuccess: (result) =>
      client.setQueryData(['settings'], (old: SettingsGetResult | undefined) => ({ ...old!, ...result })),
  });
}
