import type {
  FlowActorParams,
  FlowDeleteParams,
  FlowEditParams,
  FlowGetResult,
  FlowPrepareParams,
  FlowPromiseParams,
  FlowReviewParams,
  FlowScheduleParams,
  FlowScopeParams,
  FlowSetParams,
} from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useServer } from './context';

const mapKey = (cwd: string) => ['product-map', cwd] as const;

export function useProductMap(cwd: string) {
  const server = useServer();
  const client = useQueryClient();
  return useQuery({
    queryKey: mapKey(cwd),
    queryFn: async () => {
      const sent = client.getQueryData<FlowGetResult>(mapKey(cwd));
      const result = await server.request('flow/get', { cwd, since: sent?.etag || null });
      if (!result.unchanged) return result;
      // Nothing changed: keep what is on screen, but only if it is still the map the server means.
      const current = client.getQueryData<FlowGetResult>(mapKey(cwd));
      return current && current.etag === result.etag ? current : server.request('flow/get', { cwd });
    },
    // Agents edit the map files with ordinary tools, and edits outside Alpine land there too; an unchanged
    // answer is tiny, so polling stays cheap.
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Images of one card's checks. They stay out of the polled map and load when the card opens. */
export function useFlowNode(cwd: string, nodeId: string | null, revision = '') {
  const server = useServer();
  return useQuery({
    queryKey: ['product-map-node', cwd, nodeId, revision],
    queryFn: () => server.request('flow/node', { cwd, nodeId: nodeId! }),
    enabled: !!nodeId,
    // Keep the last pictures while a refresh runs, but never show another card's.
    placeholderData: (previous, query) => (query?.queryKey[2] === nodeId ? previous : undefined),
    retry: false,
  });
}

export function usePrepareFlow() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: FlowPrepareParams) => server.request('flow/prepare', params),
    onSuccess: (result, params) => client.setQueryData(mapKey(params.cwd), result.board),
    onError: (_, params) => void client.invalidateQueries({ queryKey: mapKey(params.cwd) }),
  });
}

/** Runs a mutation whose answer is the whole map and puts that answer on screen. */
function useBoardMutation<Params extends { cwd: string }>(
  method:
    | 'flow/set'
    | 'flow/actor'
    | 'flow/promise'
    | 'flow/edit'
    | 'flow/review'
    | 'flow/scope'
    | 'flow/schedule'
    | 'flow/delete',
) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: Params) => server.request(method, params as never) as Promise<FlowGetResult>,
    onSuccess: (board, params) => client.setQueryData(mapKey(params.cwd), board),
    // Also after a failure, reload so the screen shows what is really saved.
    onSettled: (_, __, params) => void client.invalidateQueries({ queryKey: mapKey(params.cwd) }),
  });
}

/** Writes one of the user's own decisions (priority, scope, memo, area) on a feature. */
export function useSetFlow() {
  return useBoardMutation<FlowSetParams>('flow/set');
}

/** Moves journeys to who walks them, or renames that group; the AI may change it again later (worked out together). */
export function useSetActor() {
  return useBoardMutation<FlowActorParams>('flow/actor');
}

/** The user's decision on one promise: confirm it, put it off, stop caring, or allow an automatic replay. */
export function usePromiseAction() {
  return useBoardMutation<FlowPromiseParams>('flow/promise');
}

/** The user rewrites a card's title, a promise or "직접 해 보려면"; it becomes theirs. */
export function useEditFlow() {
  return useBoardMutation<FlowEditParams>('flow/edit');
}

/** The user's answer to an AI change of what they decided, or to a "지도에서 고치기" result. */
export function useReviewFlow() {
  return useBoardMutation<FlowReviewParams>('flow/review');
}

/** Which folders the map covers. */
export function useSetScope() {
  return useBoardMutation<FlowScopeParams>('flow/scope');
}

/** Deletes the project's map; the answer is the empty map. */
export function useDeleteMap() {
  return useBoardMutation<FlowDeleteParams>('flow/delete');
}

/** The daily map check setting, and the note that it just ran. */
export function useSetSchedule() {
  return useBoardMutation<FlowScheduleParams>('flow/schedule');
}
