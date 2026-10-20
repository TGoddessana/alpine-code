import type {
  AppInfo,
  Check,
  ErrorData,
  PublishChangedParams,
  PublishPlan,
  PublishRunResult,
  PublishStatus,
} from '@alpine/protocol';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cloudKey } from './cloud';
import { ServerError } from './connection';
import { useServer } from './context';

export const publishStatusKey = (cwd: string) => ['publish', 'status', cwd] as const;
const restoreKey = (cwd: string) => ['publish', 'restore-points', cwd] as const;

/**
 * Whether the project can go online, and what is waiting (`publish/status`). It builds nothing and asks the API for
 * little, so it is polled slowly to keep the top bar's dot true while the AI changes files.
 */
export function usePublishStatus(cwd: string) {
  const server = useServer();
  return useQuery({
    queryKey: publishStatusKey(cwd),
    queryFn: () => server.request('publish/status', { cwd }),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** The points the app can go back to (`publish/restorePoints`), newest first as the server lists them. */
export function useRestorePoints(cwd: string, enabled = true) {
  const server = useServer();
  return useQuery({
    queryKey: restoreKey(cwd),
    queryFn: () => server.request('publish/restorePoints', { cwd }),
    enabled,
    retry: false,
  });
}

/** Puts data and code back to a point together; resolves when it is done. */
export function useRestore(cwd: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (point: string) => server.request('publish/restore', { cwd, point }),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: restoreKey(cwd) });
      void client.invalidateQueries({ queryKey: publishStatusKey(cwd) });
    },
  });
}

const domainsKey = (cwd: string) => ['publish', 'domains', cwd] as const;

/**
 * The custom domains of the project's app (`publish/domains`). While one is waiting for the person's DNS it is asked
 * again every 10 seconds, so it turns active by itself once the records are in.
 */
export function useDomains(cwd: string, enabled = true) {
  const server = useServer();
  return useQuery({
    queryKey: domainsKey(cwd),
    queryFn: () => server.request('publish/domains', { cwd }),
    enabled,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.domains.some((domain) => domain.status === 'pending') ? 10_000 : false,
  });
}

/** Adds a domain (and, with `mail`, the records for sending mail from it); the list is read again. */
export function useAddDomain(cwd: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (params: { domain: string; mail: boolean }) => server.request('publish/addDomain', { cwd, ...params }),
    onSuccess: () => client.invalidateQueries({ queryKey: domainsKey(cwd) }),
  });
}

/** Asks the API to look at the DNS records of a domain now. */
export function useCheckDomain(cwd: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => server.request('publish/checkDomain', { cwd, id }),
    onSuccess: () => client.invalidateQueries({ queryKey: domainsKey(cwd) }),
  });
}

export function useRemoveDomain(cwd: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => server.request('publish/removeDomain', { cwd, id }),
    onSuccess: () => client.invalidateQueries({ queryKey: domainsKey(cwd) }),
  });
}

/** Shows or hides the Alpine badge on the app (Pro only; the API answers `payment_required` on Free). */
export function useSetBadge(cwd: string) {
  const server = useServer();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (badge: boolean) => server.request('publish/setBadge', { cwd, badge }),
    onSuccess: () => client.invalidateQueries({ queryKey: publishStatusKey(cwd) }),
  });
}

/** Why a prepare or a run stopped. `reason` is the server's (`build_failed`, `signed_out`, `blocked`, ...). */
export interface PublishFailure {
  reason: ErrorData['reason'] | null;
  message: string;
}

export type PublishState =
  | { status: 'idle' }
  /** Building, checking, sending. `phase` is an open enum; `checks` are the ones that settled so far. */
  | { status: 'preparing'; phase: string; progress: number; checks: Check[] }
  | { status: 'ready'; plan: PublishPlan }
  /** The four steps of the server, in order; an unknown step is shown as it comes. */
  | { status: 'running'; plan: PublishPlan; step: string; done: string[] }
  | { status: 'done'; app: AppInfo; publishedAt: string }
  | { status: 'failed'; during: 'prepare' | 'run'; failure: PublishFailure };

export const PUBLISH_STEPS = ['restore', 'files', 'shape', 'live'] as const;

const failureOf = (reason: unknown): PublishFailure =>
  reason instanceof ServerError
    ? { reason: reason.data?.reason ?? null, message: reason.message }
    : { reason: null, message: reason instanceof Error ? reason.message : String(reason) };

export interface PublishFlow {
  state: PublishState;
  /** Builds, checks and uploads. */
  prepare: (locale: string) => void;
  /**
   * The sheet opened: keeps a run that is working, a plan built from the files on disk now, or a finished publish with
   * nothing new; otherwise prepares again. Asks `publish/status` afresh, because the polled one can be 15 s old.
   */
  open: (locale: string) => void;
  /** Publishes the prepared plan with the confirms the person said yes to. */
  run: (confirm: string[]) => void;
  cancel: () => void;
  reset: () => void;
}

/**
 * One publish at a time for a project: `publish/prepare`, then `publish/run`, following `publish/changed`. The state
 * lives with whoever calls this (the top bar's button), not in the sheet, so closing the sheet does not lose a run
 * that is still working.
 */
export function usePublish(cwd: string): PublishFlow {
  const server = useServer();
  const client = useQueryClient();
  const [state, setState] = useState<PublishState>({ status: 'idle' });
  const id = useRef<string | null>(null);
  const working = useRef(false);
  const latest = useRef(state);
  // `run` reads the plan from the latest committed state; it is called from a click, after that commit.
  useEffect(() => {
    latest.current = state;
  });

  useEffect(
    () =>
      server.subscribe((notification) => {
        if (notification.method !== 'publish/changed') return;
        const params = notification.params as PublishChangedParams;
        if (params.id !== id.current) return;
        setState((current) => {
          if (current.status === 'preparing')
            return {
              status: 'preparing',
              phase: params.phase,
              progress: params.progress ?? current.progress,
              checks: params.checks ?? current.checks,
            };
          if (current.status === 'running')
            return {
              ...current,
              step: params.phase,
              done:
                (params.progress ?? 0) >= 1 && !current.done.includes(params.phase)
                  ? [...current.done, params.phase]
                  : current.done,
            };
          return current;
        });
      }),
    [server],
  );

  // Leaving the screen stops a prepare nobody waits for. A run cannot be stopped once its files started.
  useEffect(
    () => () => {
      if (working.current && id.current) void server.request('publish/cancel', { id: id.current }).catch(() => {});
    },
    [server],
  );

  const prepare = useCallback(
    (locale: string) => {
      if (working.current) return;
      working.current = true;
      const mine = (id.current = crypto.randomUUID());
      setState({ status: 'preparing', phase: 'build', progress: 0, checks: [] });
      server
        .request('publish/prepare', { id: mine, cwd, locale })
        .then((plan) => {
          if (id.current === mine) setState({ status: 'ready', plan });
        })
        .catch((reason: unknown) => {
          if (id.current === mine) setState({ status: 'failed', during: 'prepare', failure: failureOf(reason) });
        })
        .finally(() => {
          if (id.current === mine) working.current = false;
        });
    },
    [server, cwd],
  );

  const run = useCallback(
    (confirm: string[]) => {
      const current = latest.current;
      const mine = id.current;
      if (current.status !== 'ready' || !mine || working.current) return;
      working.current = true;
      setState({ status: 'running', plan: current.plan, step: 'restore', done: [] });
      server
        .request('publish/run', { id: mine, cwd, deployId: current.plan.deployId, confirm })
        .then((result: PublishRunResult) => {
          setState({ status: 'done', app: result.app, publishedAt: result.publishedAt });
          void client.invalidateQueries({ queryKey: publishStatusKey(cwd) });
          void client.invalidateQueries({ queryKey: restoreKey(cwd) });
          void client.invalidateQueries({ queryKey: cloudKey });
        })
        .catch((reason: unknown) => setState({ status: 'failed', during: 'run', failure: failureOf(reason) }))
        .finally(() => {
          working.current = false;
        });
    },
    [server, client, cwd],
  );

  const open = useCallback(
    (locale: string) => {
      const current = latest.current;
      if (current.status === 'preparing' || current.status === 'running') return;
      if (current.status !== 'ready' && current.status !== 'done') return prepare(locale);
      // The same file changed twice keeps the count, so a ready plan is compared by the tree it was built from.
      void server
        .request('publish/status', { cwd })
        .then((now) => {
          const fresh =
            current.status === 'ready'
              ? current.plan.source != null && current.plan.source === now.source
              : (now.changes ?? 0) === 0;
          if (!fresh && latest.current === current) prepare(locale);
        })
        .catch(() => {
          if (latest.current === current) prepare(locale);
        });
    },
    [server, cwd, prepare],
  );

  const cancel = useCallback(() => {
    if (working.current && id.current) void server.request('publish/cancel', { id: id.current }).catch(() => {});
  }, [server]);

  const reset = useCallback(() => {
    if (working.current) return;
    id.current = null;
    setState({ status: 'idle' });
  }, []);

  return { state, prepare, open, run, cancel, reset };
}

export type { PublishStatus };
