import type { AppInfo, Check, PublishPlan, PublishShape } from '@alpine/protocol';

import { ServerError } from './connection';
import type { Script } from './scripted';

/** What `publish/prepare` and `publish/run` come to in a story or a test. */
export type PublishScenario =
  /** Every check passes; one table is added. */
  | 'clean'
  /** The open-API check finds a route anyone can read. Publishing is still allowed. */
  | 'warning'
  /** A finding the app has no sentence for (an advisor lint), shown with the server's `fallback`. */
  | 'advisor'
  /** A secret key in the page code: the one thing that blocks. */
  | 'blocked'
  /** A column goes away. */
  | 'drop'
  /** One confirm of every kind: drop, rename, data change and a statement nobody understood. */
  | 'confirms'
  /** The build command fails; its last lines come with the error. */
  | 'build_failed'
  /** The checks pass, then the database change fails and the old version keeps serving. */
  | 'run_failed';

export interface PublishScriptOptions {
  publish?: PublishScenario;
  /** Milliseconds each phase takes; defaults to 450. Tests pass 0. */
  publishMs?: number;
  /** Why `publish/status` says the project cannot be published; `null` (default) means it can. */
  publishReason?: 'no_description' | 'not_web' | null;
  /** Starts with this many changes since the last publish; defaults to 3. */
  changes?: number;
  /** Starts never published. */
  firstTime?: boolean;
}

interface Env {
  signedIn: () => boolean;
  nodeReady: () => boolean;
  /** Whether the app shows the Alpine badge now. */
  badge: () => boolean;
  /** How many days back the plan lets a person go. */
  restoreDays: () => number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const APP: AppInfo = {
  id: 'app_1',
  name: 'craft-booking',
  address: 'craft-booking.alpinesite.app',
  url: 'https://craft-booking.alpinesite.app',
  status: 'live',
  kind: 'web-lite',
  badge: true,
};

const SECRET_FIX =
  'A Stripe secret key (sk_live_…4f2a) is in the frontend bundle (assets/index-4f2a.js). Move the call that uses it into the Worker, read the key from a Worker secret, and rotate the key.';

const CHECKS: Record<PublishScenario, Check[]> = {
  clean: [
    { id: 'secret', state: 'ok', findings: [] },
    { id: 'open-api', state: 'ok', findings: [] },
  ],
  warning: [
    { id: 'secret', state: 'ok', findings: [] },
    {
      id: 'open-api',
      state: 'attention',
      findings: [
        {
          check: 'open-api',
          code: 'open_api.readable',
          severity: 'warn',
          params: { method: 'GET', path: '/api/bookings' },
          fallback: 'GET /api/bookings는 로그인하지 않아도 데이터를 돌려줘요.',
          fix: 'GET /api/bookings answers with data to anyone who is not signed in. If that data is private, require a signed-in user in this route (and only return that user’s own rows).',
        },
      ],
    },
  ],
  advisor: [
    { id: 'secret', state: 'ok', findings: [] },
    { id: 'open-api', state: 'skipped', findings: [] },
    {
      id: 'advisor',
      state: 'attention',
      findings: [
        {
          check: 'advisor',
          code: 'advisor.rls_disabled_in_public',
          severity: 'warn',
          params: { table: 'bookings' },
          fallback: '"bookings" 표에 행 단위 보안이 꺼져 있어요.',
          fix: 'Table public.bookings has row level security disabled. Enable it and add a policy so a signed-in user can read and write only their own rows.',
        },
      ],
    },
  ],
  blocked: [
    {
      id: 'secret',
      state: 'blocked',
      findings: [
        {
          check: 'secret',
          code: 'secret.stripe_live',
          severity: 'block',
          file: 'assets/index-4f2a.js',
          line: 1,
          params: { kind: 'Stripe secret key', redacted: 'sk_live_…4f2a' },
          fallback: '결제 비밀 열쇠가 화면 코드에 들어 있어요.',
          fix: SECRET_FIX,
        },
      ],
    },
    { id: 'open-api', state: 'ok', findings: [] },
  ],
  drop: [
    { id: 'secret', state: 'ok', findings: [] },
    { id: 'open-api', state: 'ok', findings: [] },
  ],
  confirms: [
    { id: 'secret', state: 'ok', findings: [] },
    { id: 'open-api', state: 'ok', findings: [] },
  ],
  build_failed: [],
  run_failed: [
    { id: 'secret', state: 'ok', findings: [] },
    { id: 'open-api', state: 'ok', findings: [] },
  ],
};

const DROP = {
  id: 'drop_column:bookings.memo',
  kind: 'drop_column',
  table: 'bookings',
  column: 'memo',
  rowsAffected: 12,
};

const SHAPES: Partial<Record<PublishScenario, PublishShape>> = {
  drop: { pending: ['0002_waitlist.sql'], added: { tables: ['waitlist'], columns: [] }, confirms: [DROP] },
  confirms: {
    pending: ['0002_cleanup.sql'],
    added: {},
    confirms: [
      DROP,
      { id: 'drop_table:old_notes', kind: 'drop_table', table: 'old_notes', rowsAffected: 0 },
      { id: 'rename_column:bookings.nm', kind: 'rename_column', table: 'bookings', column: 'nm' },
      {
        id: 'data_change:bookings',
        kind: 'data_change',
        table: 'bookings',
        statement: "UPDATE bookings SET status = 'new'",
      },
      { id: 'unknown:0002_cleanup.sql', kind: 'unknown', statement: 'PRAGMA writable_schema = 1' },
    ],
  },
};

const BUILD_TAIL = [
  'vite v7.1.4 building for production...',
  'src/App.tsx(41,18): error TS2322: Type "string" is not assignable to type "number".',
  'error during build: Build failed with 1 error',
].join('\n');

/**
 * `publish/*` as the app sees it (docs/alpine-cloud-api.md 6.2): status, a prepare that walks build, checks and
 * upload with `publish/changed`, a run that walks the four steps, and restore points. Merged into `cloudScript`, which
 * owns who is signed in. A scripted stand-in; nothing is built or sent anywhere.
 */
export function publishResults(options: PublishScriptOptions, env: Env): NonNullable<Script['results']> {
  const scenario = options.publish ?? 'clean';
  const ms = options.publishMs ?? 450;
  let changes = options.changes ?? 3;
  let lastPublishedAt: string | null = options.firstTime ? null : new Date(Date.now() - 2 * 3_600_000).toISOString();
  const cancelled = new Set<string>();

  return {
    'publish/status': () => ({
      publishable: !options.publishReason && env.signedIn() && env.nodeReady(),
      reason: options.publishReason ?? (!env.signedIn() ? 'signed_out' : !env.nodeReady() ? 'no_node' : null),
      app: lastPublishedAt ? { ...APP, badge: env.badge() } : null,
      lastPublishedAt,
      changes,
    }),
    'publish/prepare': async ({ id }, context) => {
      const say = (phase: string, progress: number, checks: Check[] | null = null) =>
        context.emit({ method: 'publish/changed', params: { id, phase, progress, checks, message: null } });
      say('build', 0);
      await sleep(ms);
      if (scenario === 'build_failed')
        throw new ServerError(-32000, `Build failed.\n${BUILD_TAIL}`, { reason: 'build_failed' });
      say('build', 1);
      const checks = CHECKS[scenario];
      say(
        'checks',
        0,
        checks.map((check) => ({ ...check, state: 'running', findings: [] })),
      );
      await sleep(ms);
      if (cancelled.delete(id)) throw new ServerError(-32000, 'Publishing was cancelled.', { reason: 'other' });
      say('checks', 1, checks);
      say('upload', 0.5);
      await sleep(ms);
      const plan: PublishPlan = {
        deployId: 'dep_4',
        checks,
        blocked: checks.some((check) => check.state === 'blocked'),
        shape: SHAPES[scenario] ?? {
          pending: ['0002_waitlist.sql'],
          added: { tables: ['waitlist'], columns: [{ table: 'bookings', column: 'note' }] },
          confirms: [],
        },
        app: APP,
      };
      return plan;
    },
    'publish/run': async ({ id, confirm }, context) => {
      const needed = (SHAPES[scenario]?.confirms ?? []).map((item) => item.id);
      if (needed.some((item) => !confirm?.includes(item)))
        throw new ServerError(-32000, 'Some changes were not confirmed.', { reason: 'needs_confirm' });
      for (const step of ['restore', 'files', 'shape', 'live']) {
        context.emit({ method: 'publish/changed', params: { id, phase: step, progress: 0 } });
        await sleep(ms);
        if (scenario === 'run_failed' && step === 'shape')
          throw new ServerError(
            -32000,
            'The database change failed. Your data went back to how it was, and the old version stays online.',
            {
              reason: 'other',
            },
          );
        context.emit({ method: 'publish/changed', params: { id, phase: step, progress: 1 } });
      }
      changes = 0;
      lastPublishedAt = new Date().toISOString();
      return { app: { ...APP, badge: env.badge() }, publishedAt: lastPublishedAt };
    },
    'publish/cancel': ({ id }) => {
      cancelled.add(id);
      return {};
    },
    'publish/restorePoints': () => ({
      points: [
        { id: 'rp_9', at: new Date(Date.now() - 2 * 3_600_000).toISOString(), reason: 'publish' },
        { id: 'rp_8', at: new Date(Date.now() - 26 * 3_600_000).toISOString(), reason: 'data_write' },
        { id: 'rp_7', at: new Date(Date.now() - 3 * 86_400_000).toISOString(), reason: 'publish' },
      ],
      windowDays: env.restoreDays(),
    }),
    'publish/restore': async () => {
      await sleep(ms);
      return {};
    },
  };
}
