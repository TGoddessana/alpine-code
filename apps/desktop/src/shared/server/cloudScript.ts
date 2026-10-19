import type { CloudStatus } from '@alpine/protocol';

import { ServerError } from './connection';
import { publishResults, type PublishScriptOptions } from './publishScript';
import type { Script } from './scripted';

export interface CloudScriptOptions extends PublishScriptOptions {
  /** Starts signed in. Signing in and out changes it, and announces `cloud/changed`. */
  signedIn?: boolean;
  /** The plan the account is on; `trial` is Pro on its free week. */
  plan?: 'free' | 'trial' | 'pro';
  /** Credits left; defaults to the free month's 300. */
  balance?: number;
  /** The API does not answer: the last known status comes with `reachable: false`. */
  unreachable?: boolean;
  /** Milliseconds until a browser sign-in "finishes"; defaults to 2200. `null`: it never does (until cancelled). */
  signInMs?: number | null;
  /** How a browser sign-in ends: signed in (the default), or one of the failures. */
  signInEnds?: 'connected' | 'timed_out' | 'failed';
  /** Milliseconds `cloud/sendCode` and `cloud/verifyCode` take; defaults to 600. */
  codeMs?: number;
  /** Node.js is not here yet; installing it takes `installMs` (default 2000) and then it is. */
  node?: 'ready' | 'missing';
  installMs?: number;
  /** The Node.js download fails. */
  installFails?: boolean;
}

const FREE_LIMITS = {
  apps: 3,
  mailsPerDay: 100,
  d1Mb: 500,
  monthlyCredits: 300,
  restoreDays: 7,
  customDomains: false,
  badge: true,
  webPro: false,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The first of next month, 00:00 UTC: when free credits are filled up again. */
const refillDate = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
};

/**
 * Alpine Cloud as the app sees it through the server (docs/alpine-cloud-api.md 6.2): the account, its plan and
 * credits, a browser sign-in that finishes by itself, an email code (`000000` is a wrong one), plans and trial, and
 * the Node.js install, and `publish/*` (see `publishScript`). It remembers who is signed in, so a story can sign in and see the settings change. A scripted
 * stand-in for the server, like `statefulScript`; no cloud runs behind it.
 */
export function cloudScript(options: CloudScriptOptions = {}): Script {
  let signedIn = options.signedIn ?? false;
  let plan: 'free' | 'trial' | 'pro' = options.plan ?? 'free';
  let trialUsed = plan !== 'free';
  let node = options.node ?? 'ready';
  const balance = options.balance ?? 300;
  const attempts = new Map<string, ReturnType<typeof setTimeout>>();
  let counter = 0;

  const status = (): CloudStatus => ({
    signedIn,
    apiUrl: 'https://api.alpinecode.app',
    appDomain: 'alpinesite.app',
    account: signedIn
      ? { id: 'acc_1', email: 'haneul@example.com', name: '하늘', avatarUrl: null, status: 'active' }
      : null,
    plan: signedIn
      ? {
          id: plan === 'free' ? 'free' : 'pro',
          status: plan === 'trial' ? 'trialing' : 'active',
          trialEndsAt: plan === 'trial' ? new Date(Date.now() + 7 * 86_400_000).toISOString() : null,
          trialUsed,
        }
      : null,
    limits: signedIn ? { ...FREE_LIMITS, ...(plan === 'free' ? {} : { webPro: true, customDomains: true }) } : null,
    credits: signedIn ? { balance, monthly: 300, refillsAt: refillDate() } : null,
    reachable: !options.unreachable,
  });

  return {
    results: {
      ...publishResults(options, { signedIn: () => signedIn, nodeReady: () => node === 'ready' }),
      'cloud/status': () => status(),
      'cloud/signIn': ({ method }, context) => {
        const attemptId = `attempt-${++counter}`;
        const ms = options.signInMs === undefined ? 2200 : options.signInMs;
        if (ms !== null)
          attempts.set(
            attemptId,
            setTimeout(() => {
              attempts.delete(attemptId);
              const result = options.signInEnds ?? 'connected';
              if (result === 'connected') signedIn = true;
              context.emit({
                method: 'cloud/signInFinished',
                params: {
                  attemptId,
                  result,
                  status: result === 'connected' ? status() : null,
                  message: result === 'failed' ? 'access_denied' : null,
                },
              });
            }, ms),
          );
        return { attemptId, url: `https://api.alpinecode.app/v1/auth/authorize?provider=${method}&state=${attemptId}` };
      },
      'cloud/cancelSignIn': ({ attemptId }, context) => {
        const timer = attempts.get(attemptId);
        if (timer) {
          clearTimeout(timer);
          attempts.delete(attemptId);
          context.emit({ method: 'cloud/signInFinished', params: { attemptId, result: 'cancelled' } });
        }
        return {};
      },
      'cloud/sendCode': async () => {
        await sleep(options.codeMs ?? 600);
        return {};
      },
      'cloud/verifyCode': async ({ code }, context) => {
        await sleep(options.codeMs ?? 600);
        if (code === '000000') throw new ServerError(-32000, 'The code is wrong', { reason: 'invalid_code' });
        signedIn = true;
        context.emit({ method: 'cloud/changed', params: { status: status() } });
        return status();
      },
      'cloud/signOut': (_params, context) => {
        signedIn = false;
        context.emit({ method: 'cloud/changed', params: { status: status() } });
        return {};
      },
      'cloud/plans': () => ({
        plans: [
          { id: 'free', limits: FREE_LIMITS, price: null, trialDays: null },
          {
            id: 'pro',
            limits: { ...FREE_LIMITS, monthlyCredits: 2000, customDomains: true, badge: false, webPro: true },
            price: null,
            trialDays: 7,
          },
        ],
      }),
      'cloud/startTrial': (_params, context) => {
        plan = 'trial';
        trialUsed = true;
        context.emit({ method: 'cloud/changed', params: { status: status() } });
        return status();
      },
      'cloud/checkout': () => ({ url: 'http://127.0.0.1:8787/v1/billing/fake/checkout' }),
      'cloud/portal': () => ({ url: 'http://127.0.0.1:8787/v1/billing/fake/portal' }),
      'projects/nodeTools': () =>
        node === 'ready'
          ? { ready: true, version: '22.14.0', required: '22.12', alpineManaged: false }
          : { ready: false, version: null, required: '22.12', alpineManaged: false },
      'projects/installNodeTools': async (_params, context) => {
        const total = options.installMs ?? 2000;
        const announce = (state: 'downloading' | 'done' | 'failed', progress: number | null, message?: string) =>
          context.emit({
            method: 'projects/nodeToolsChanged',
            params: { state, progress, message: message ?? null },
          });
        // Answers at once, like the server; the download goes on behind.
        void (async () => {
          for (const progress of [0.1, 0.4, 0.7, 0.95]) {
            await sleep(total / 5);
            announce('downloading', progress);
          }
          await sleep(total / 5);
          if (options.installFails) return announce('failed', null, 'The download stopped');
          node = 'ready';
          announce('done', 1);
        })();
        return {};
      },
    },
  };
}
