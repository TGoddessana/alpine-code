import type { ChatGPTSignInFinishedParams, ChatGPTSignInParams, ConnectionInfo } from '@alpine/protocol';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useServer } from './context';

/** Where OpenAI lets the user see and limit what apps use of their ChatGPT plan. */
export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage';

export type SignInState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'waiting'; attemptId: string; url: string }
  | { status: 'connected'; connection: ConnectionInfo }
  | { status: 'declined'; connection: ConnectionInfo | null }
  | { status: 'timed_out' | 'failed'; message: string | null };

/**
 * One browser sign-in with ChatGPT at a time. `start` asks the server for the sign-in page and resolves with its
 * address (the caller opens it); the end arrives as `chatgpt/signInFinished`, which moves `state` on. A sign-in that
 * ends signed in but without permission to use the plan is `declined` too, with its connection kept by the server.
 */
export function useChatGPTSignIn() {
  const server = useServer();
  const client = useQueryClient();
  const [state, setState] = useState<SignInState>({ status: 'idle' });
  const attempt = useRef<string | null>(null);
  // A notification can beat the answer to `chatgpt/signIn`; keep it until the attempt id is known.
  const early = useRef(new Map<string, ChatGPTSignInFinishedParams>());

  const finish = useCallback(
    (params: ChatGPTSignInFinishedParams) => {
      attempt.current = null;
      if (params.result === 'cancelled') return setState({ status: 'idle' });
      if (params.connection) void client.invalidateQueries({ queryKey: ['connections'] });
      if (params.result === 'connected' && params.connection) {
        const usable = params.connection.account?.planUsage ?? false;
        return setState(
          usable
            ? { status: 'connected', connection: params.connection }
            : { status: 'declined', connection: params.connection },
        );
      }
      if (params.result === 'declined') return setState({ status: 'declined', connection: null });
      setState({ status: params.result === 'connected' ? 'failed' : params.result, message: params.message ?? null });
    },
    [client],
  );

  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'chatgpt/signInFinished') return;
        const params = notification.params as ChatGPTSignInFinishedParams;
        if (params.attemptId === attempt.current) finish(params);
        else early.current.set(params.attemptId, params);
      }),
    [server, finish],
  );

  const start = useCallback(
    async (params: ChatGPTSignInParams = {}) => {
      setState({ status: 'starting' });
      try {
        const { attemptId, url } = await server.request('chatgpt/signIn', params);
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
    if (attemptId) void server.request('chatgpt/cancelSignIn', { attemptId });
  }, [server]);

  return { state, start, cancel };
}

/** Ends a ChatGPT connection's sign-in; the connection stays, signed out. */
export function useChatGPTSignOut() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (connection: string) => server.request('chatgpt/signOut', { connection }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['connections'] }),
  });
}
