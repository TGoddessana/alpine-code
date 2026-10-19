import type { TaskForceAgentParams, TaskForceParams, TaskForceResumeParams } from '@alpine/protocol';
import { useMutation, useQuery } from '@tanstack/react-query';

import { useServer } from './context';

/** What the user can do to a TF; each answers through the TF's item in the session's events. */
export type TaskForceAction = 'start' | 'decline' | 'stop' | 'allowMore' | 'takeResults';

export function useTaskForceAction() {
  const server = useServer();
  return useMutation({
    mutationFn: ({ action, ...params }: TaskForceParams & { action: TaskForceAction }) =>
      server.request(`taskforce/${action}`, params),
  });
}

/** 이어 하기 (or 처음부터, `fresh`) after the app closed mid-run. */
export function useResumeTaskForce() {
  const server = useServer();
  return useMutation({ mutationFn: (params: TaskForceResumeParams) => server.request('taskforce/resume', params) });
}

export function useStopTaskForceAgent() {
  const server = useServer();
  return useMutation({ mutationFn: (params: TaskForceAgentParams) => server.request('taskforce/stopAgent', params) });
}

/** What one agent of a TF did, read-only. `version` refetches it as the agent goes on (its turn). */
export function useTaskForceRecord(params: TaskForceAgentParams | null, version: number) {
  const server = useServer();
  return useQuery({
    queryKey: ['taskforce-record', params?.sessionId, params?.runId, params?.memberId, version],
    queryFn: async () => (await server.request('taskforce/record', params!)).items,
    enabled: params !== null,
    placeholderData: (previous) => previous,
  });
}
