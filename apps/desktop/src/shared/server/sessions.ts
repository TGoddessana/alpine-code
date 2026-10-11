import type {
  SessionAnswerParams,
  SessionInfo,
  SessionNewParams,
  SessionSendParams,
  SessionSetAgentParams,
  SessionSetModelParams,
  SessionSetModeParams,
} from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer, useSessionStore } from './context';
import { removeSession, sessionKey, sessionsKey, upsertSession } from './sessionStore';
import type { SessionState } from './sessionState';

/**
 * Every session of every project, most recently updated first. Kept fresh by `info_changed` and `deleted` events, so
 * it is fetched once.
 */
export function useSessions() {
  const server = useServer();
  return useQuery({
    queryKey: sessionsKey,
    queryFn: async (): Promise<SessionInfo[]> => (await server.request('session/list', {})).sessions,
    staleTime: Infinity,
    retry: false,
  });
}

/**
 * One session: its info and items, live. Opens it (`session/open`) and applies the events that follow; `id` may be
 * `null` while there is nothing to show. Data is a `SessionState`.
 */
export function useSession(id: string | null) {
  const sessions = useSessionStore();
  return useQuery({
    queryKey: sessionKey(id ?? ''),
    queryFn: (): Promise<SessionState> => sessions.open(id!),
    enabled: id !== null,
    staleTime: Infinity, // Events keep it fresh; a gap in them opens the session again.
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Starts a session in a folder. Resolves with its `SessionInfo`. */
export function useNewSession() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (params: SessionNewParams) => (await server.request('session/new', params)).info,
    onSuccess: (info) => upsertSession(client, info),
  });
}

/** Sends a message and starts the run. Rejects with `ServerError` `-32002` if the session is already running. */
export function useSendMessage() {
  const server = useServer();
  return useMutation({ mutationFn: (params: SessionSendParams) => server.request('session/send', params) });
}

/** Stops the run of a session, or answers an approval with a stop. Does nothing if the session is idle. */
export function useCancelSession() {
  const server = useServer();
  return useMutation({ mutationFn: (sessionId: string) => server.request('session/cancel', { sessionId }) });
}

/** Answers an approval. The first answer wins: `data.accepted` is `false` if it was already answered. */
export function useAnswerApproval() {
  const server = useServer();
  return useMutation({ mutationFn: (params: SessionAnswerParams) => server.request('session/answer', params) });
}

export function useSetSessionMode() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (params: SessionSetModeParams) => (await server.request('session/setMode', params)).info,
    onSuccess: (info) => upsertSession(client, info),
  });
}

/** Switches a session's model from its next message on; the conversation goes on. Not while it runs. */
export function useSetSessionModel() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (params: SessionSetModelParams) => (await server.request('session/setModel', params)).info,
    onSuccess: (info) => upsertSession(client, info),
  });
}

/** Goes on with another agent from the next message on; the conversation goes on. Not while it runs. */
export function useSetSessionAgent() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (params: SessionSetAgentParams) => (await server.request('session/setAgent', params)).info,
    onSuccess: (info) => upsertSession(client, info),
  });
}

/** Deletes the session and its record. A running session is cancelled first. */
export function useDeleteSession() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => server.request('session/delete', { sessionId }),
    onSuccess: (_, sessionId) => {
      removeSession(client, sessionId);
      client.removeQueries({ queryKey: sessionKey(sessionId) });
    },
  });
}
