import type { CloudSignInFinishedParams, CloudStatus, ProjectsNodeToolsChangedParams } from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from './context';

export const cloudKey = ['cloud', 'status'] as const;

/**
 * Whether Alpine Cloud is on in this build ("Shipping hidden" in docs/alpine-cloud.md). Every cloud screen asks this
 * first and shows nothing of the cloud while it is `false`, which is also what it is while the answer is on its way
 * and when the server cannot answer: a normal install never flashes a cloud row. `cloud/enabled` needs no network.
 */
export function useCloudEnabled(): boolean {
  const server = useServer();
  const { data } = useQuery({
    queryKey: ['cloud', 'enabled'],
    queryFn: () => server.request('cloud/enabled', {}),
    staleTime: Infinity,
    retry: false,
  });
  return data?.enabled ?? false;
}

/** What the account, its plan and its credits are now. Follows `cloud/changed`, so every screen shows the same. */
export function useCloudStatus(enabled = true) {
  const server = useServer();
  const client = useQueryClient();
  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'cloud/changed') return;
        client.setQueryData(cloudKey, (notification.params as { status: CloudStatus }).status);
      }),
    [server, client],
  );
  return useQuery({
    queryKey: cloudKey,
    queryFn: () => server.request('cloud/status', {}),
    enabled,
    retry: false,
  });
}

/**
 * The ways to sign in on the server this app talks to (`google`, `github`, `email`), or `null` while it is asked.
 * A server that offers only the email code shows no Google or GitHub; one that cannot be asked offers all three.
 */
export function useSignInMethods(): string[] | null {
  const server = useServer();
  const { data, isError } = useQuery({
    queryKey: ['cloud', 'signInMethods'],
    queryFn: () => server.request('cloud/signInMethods', {}),
    retry: false,
  });
  if (isError) return ['google', 'github', 'email'];
  return data?.methods ?? null;
}

/** A web address under the apps' domain the server announced, e.g. `craft-booking.alpinesite.app`. */
export const appAddress = (name: string, appDomain: string | null | undefined) =>
  appDomain ? `${name}.${appDomain}` : name;

/** Signing in changes what is connected (the Alpine models appear), signing out takes them away. */
function signedInOrOut(client: QueryClient, status?: CloudStatus | null) {
  if (status) client.setQueryData(cloudKey, status);
  else void client.invalidateQueries({ queryKey: cloudKey });
  void client.invalidateQueries({ queryKey: ['connections'] });
}

export type AlpineSignInState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'waiting'; attemptId: string; url: string }
  | { status: 'connected'; cloud: CloudStatus | null }
  | { status: 'timed_out' | 'failed'; message: string | null };

/**
 * One browser sign-in (Google or GitHub) at a time, the way `useChatGPTSignIn` does it. `start` asks the server for
 * the sign-in page and resolves with its address (the caller opens it); the end arrives as `cloud/signInFinished`.
 */
export function useAlpineSignIn() {
  const server = useServer();
  const client = useQueryClient();
  const [state, setState] = useState<AlpineSignInState>({ status: 'idle' });
  const attempt = useRef<string | null>(null);
  // A notification can beat the answer to `cloud/signIn`; keep it until the attempt id is known.
  const early = useRef(new Map<string, CloudSignInFinishedParams>());

  const finish = useCallback(
    (params: CloudSignInFinishedParams) => {
      attempt.current = null;
      if (params.result === 'cancelled') return setState({ status: 'idle' });
      if (params.result === 'connected') {
        signedInOrOut(client, params.status);
        return setState({ status: 'connected', cloud: params.status ?? null });
      }
      setState({ status: params.result, message: params.message ?? null });
    },
    [client],
  );

  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'cloud/signInFinished') return;
        const params = notification.params as CloudSignInFinishedParams;
        if (params.attemptId === attempt.current) finish(params);
        else early.current.set(params.attemptId, params);
      }),
    [server, finish],
  );

  const start = useCallback(
    async (method: 'google' | 'github') => {
      setState({ status: 'starting' });
      try {
        const { attemptId, url } = await server.request('cloud/signIn', { method });
        attempt.current = attemptId;
        const ended = early.current.get(attemptId);
        if (ended) finish(ended);
        else setState({ status: 'waiting', attemptId, url });
        return url;
      } catch (reason) {
        setState({ status: 'failed', message: reason instanceof Error ? reason.message : String(reason) });
        return null;
      }
    },
    [server, finish],
  );

  const cancel = useCallback(() => {
    const attemptId = attempt.current;
    attempt.current = null;
    setState({ status: 'idle' });
    if (attemptId) void server.request('cloud/cancelSignIn', { attemptId });
  }, [server]);

  return { state, start, cancel };
}

/** Sends the six-digit code to an address. */
export function useSendCode() {
  const server = useServer();
  return useMutation({
    mutationFn: (params: { email: string; locale: string }) => server.request('cloud/sendCode', params),
  });
}

/** Signs in with the code from the mail. A wrong one rejects with the reason `invalid_code`. */
export function useVerifyCode() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: { email: string; code: string }) => server.request('cloud/verifyCode', params),
    onSuccess: (status) => signedInOrOut(client, status),
  });
}

/** Ends the Alpine sign-in on this computer; the Alpine models leave the connections. */
export function useCloudSignOut() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => server.request('cloud/signOut', {}),
    onSuccess: () => signedInOrOut(client),
  });
}

/** Whether a Node.js that can build web apps is here (`projects/nodeTools`). */
export function useNodeTools(enabled = true) {
  const server = useServer();
  return useQuery({
    queryKey: ['projects', 'nodeTools'],
    queryFn: () => server.request('projects/nodeTools', {}),
    enabled,
    retry: false,
  });
}

export type NodeInstallState =
  | { status: 'idle' }
  | { status: 'downloading'; progress: number | null }
  | { status: 'done' }
  | { status: 'failed'; message: string | null };

/** Installs Alpine's own Node.js; the download's progress comes as `projects/nodeToolsChanged`. */
export function useInstallNodeTools() {
  const server = useServer();
  const client = useQueryClient();
  const [state, setState] = useState<NodeInstallState>({ status: 'idle' });

  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'projects/nodeToolsChanged') return;
        const params = notification.params as ProjectsNodeToolsChangedParams;
        if (params.state === 'downloading') setState({ status: 'downloading', progress: params.progress ?? null });
        else if (params.state === 'failed') setState({ status: 'failed', message: params.message ?? null });
        else {
          setState({ status: 'done' });
          void client.invalidateQueries({ queryKey: ['projects', 'nodeTools'] });
        }
      }),
    [server, client],
  );

  const install = useCallback(async () => {
    setState({ status: 'downloading', progress: null });
    try {
      await server.request('projects/installNodeTools', {});
    } catch (reason) {
      setState({ status: 'failed', message: reason instanceof Error ? reason.message : String(reason) });
    }
  }, [server]);

  return { state, install, reset: () => setState({ status: 'idle' }) };
}
