import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { cloudKey } from './cloud';
import { useServer } from './context';

/** What each plan gives, for the trial sheet (`cloud/plans`). It changes rarely, so it is read once a minute at most. */
export function useCloudPlans(enabled = true) {
  const server = useServer();
  return useQuery({
    queryKey: ['cloud', 'plans'],
    queryFn: () => server.request('cloud/plans', {}),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Starts the free week of Pro, once per account and without a card. The status that comes back is the new one, so every
 * screen that follows `cloud/changed` shows Pro at once.
 */
export function useStartTrial() {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => server.request('cloud/startTrial', {}),
    onSuccess: (status) => client.setQueryData(cloudKey, status),
  });
}

/**
 * Asks for the payment page. Resolves with its address; the caller opens it in the browser. Paying happens there, and
 * the new plan arrives as `cloud/changed` when the person comes back.
 */
export function useCheckout() {
  const server = useServer();
  return useMutation({ mutationFn: () => server.request('cloud/checkout', { plan: 'pro' }) });
}

/** The page where a subscription is changed or ended. Resolves with its address. */
export function usePortal() {
  const server = useServer();
  return useMutation({ mutationFn: () => server.request('cloud/portal', {}) });
}
