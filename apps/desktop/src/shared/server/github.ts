import type { GitHubSignInFinishedParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from './context';

/** Whether GitHub sign-in is offered, who is signed in, and GitHub's page for AlpineCode's access. */
export function useGitHub() {
  const server = useServer();
  return useQuery({ queryKey: ['github'], queryFn: () => server.request('github/status', {}), retry: false });
}

/** The repositories the sign-in can see, the most recently pushed first. Asked only while `enabled`. */
export function useGitHubRepos(enabled: boolean) {
  const server = useServer();
  const client = useQueryClient();
  return useQuery({
    queryKey: ['github', 'repos'],
    queryFn: async () => {
      try {
        return await server.request('github/repos', {});
      } catch (reason) {
        // GitHub no longer accepts the sign-in, and the server forgot it: show signed out.
        void client.invalidateQueries({ queryKey: ['github'], exact: true });
        throw reason;
      }
    },
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export type GitHubSignInState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'waiting'; userCode: string; verificationUri: string }
  | { status: 'declined' | 'timed_out' | 'failed'; message: string | null };

/**
 * One GitHub sign-in at a time. `start` asks for a code and resolves with it and the page to enter it on (the caller
 * opens the page); the end arrives as `github/signInFinished`, which moves `state` on, back to `idle` once signed in.
 */
export function useGitHubSignIn() {
  const server = useServer();
  const client = useQueryClient();
  const [state, setState] = useState<GitHubSignInState>({ status: 'idle' });
  const attempt = useRef<string | null>(null);
  // A notification can beat the answer to `github/signIn`; keep it until the attempt id is known.
  const early = useRef(new Map<string, GitHubSignInFinishedParams>());

  const finish = useCallback(
    (params: GitHubSignInFinishedParams) => {
      attempt.current = null;
      if (params.result === 'connected') void client.invalidateQueries({ queryKey: ['github'] });
      if (params.result === 'connected' || params.result === 'cancelled') return setState({ status: 'idle' });
      setState({ status: params.result, message: params.message ?? null });
    },
    [client],
  );

  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'github/signInFinished') return;
        const params = notification.params as GitHubSignInFinishedParams;
        if (params.attemptId === attempt.current) finish(params);
        else early.current.set(params.attemptId, params);
      }),
    [server, finish],
  );

  // Leaving the screen stops the wait at the server too.
  useEffect(
    () => () => {
      if (attempt.current) void server.request('github/cancelSignIn', { attemptId: attempt.current });
    },
    [server],
  );

  const start = useCallback(async () => {
    setState({ status: 'starting' });
    try {
      const { attemptId, userCode, verificationUri } = await server.request('github/signIn', {});
      attempt.current = attemptId;
      const ended = early.current.get(attemptId);
      if (ended) finish(ended);
      else setState({ status: 'waiting', userCode, verificationUri });
      return { userCode, verificationUri };
    } catch (reason) {
      setState({ status: 'failed', message: reason instanceof Error ? reason.message : String(reason) });
      return null;
    }
  }, [server, finish]);

  const cancel = useCallback(() => {
    const attemptId = attempt.current;
    attempt.current = null;
    setState({ status: 'idle' });
    if (attemptId) void server.request('github/cancelSignIn', { attemptId });
  }, [server]);

  return { state, start, cancel };
}

/** Forgets the GitHub sign-in here. */
export function useGitHubSignOut() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => server.request('github/signOut', {}),
    onSuccess: () => client.invalidateQueries({ queryKey: ['github'] }),
  });
}
