import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import {
  appAddress,
  useAlpineSignIn,
  useCloudSignOut,
  useCloudStatus,
  useInstallNodeTools,
  useNodeTools,
  useVerifyCode,
} from './cloud';
import { cloudScript, type CloudScriptOptions } from './cloudScript';
import { ServerProvider } from './context';
import { scriptedConnection } from './scripted';
import type { Notification, ServerConnection } from './connection';

/** The scripted cloud behind a connection that records what the app asked, with the notifications it can send. */
function harness(options: CloudScriptOptions = {}) {
  const base = scriptedConnection(cloudScript(options));
  const sent: string[] = [];
  const listeners = new Set<(n: Notification) => void>();
  const connection: ServerConnection = {
    request: (method, params) => {
      sent.push(method);
      return base.request(method, params);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      const stop = base.subscribe(listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
  };
  const notify = (method: string, params: unknown) => listeners.forEach((listener) => listener({ method, params }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>{children}</ServerProvider>
    </QueryClientProvider>
  );
  return { wrapper, sent, notify, client };
}

const STATUS = {
  signedIn: true,
  apiUrl: 'https://api.alpinecode.app',
  appDomain: 'alpinesite.app',
  credits: { balance: 12, monthly: 300, refillsAt: '2026-11-01T00:00:00Z' },
};

describe('useCloudStatus', () => {
  it('reads cloud/status and follows cloud/changed', async () => {
    const { wrapper, notify } = harness();
    const { result } = renderHook(() => useCloudStatus(), { wrapper });
    await waitFor(() => expect(result.current.data?.signedIn).toBe(false));
    expect(result.current.data?.appDomain).toBe('alpinesite.app');

    act(() => notify('cloud/changed', { status: STATUS }));
    await waitFor(() => expect(result.current.data?.credits?.balance).toBe(12));
  });

  it("builds a web address from the server's domain, never from a constant", () => {
    expect(appAddress('craft-booking', 'alpinesite.app')).toBe('craft-booking.alpinesite.app');
    expect(appAddress('craft-booking', 'localhost')).toBe('craft-booking.localhost');
    expect(appAddress('craft-booking', null)).toBe('craft-booking');
  });
});

describe('useAlpineSignIn', () => {
  it('waits for the browser, then follows the end of its own attempt only, and signs the status in', async () => {
    const { wrapper, notify, client } = harness({ signInMs: null });
    const { result } = renderHook(() => useAlpineSignIn(), { wrapper });
    let url: string | null = null;
    await act(async () => void (url = await result.current.start('github')));
    expect(url).toContain('provider=github');
    expect(result.current.state).toMatchObject({ status: 'waiting', attemptId: 'attempt-1' });

    act(() => notify('cloud/signInFinished', { attemptId: 'someone-else', result: 'failed', message: 'x' }));
    expect(result.current.state.status).toBe('waiting');
    act(() => notify('cloud/signInFinished', { attemptId: 'attempt-1', result: 'connected', status: STATUS }));
    expect(result.current.state).toMatchObject({ status: 'connected' });
    expect(client.getQueryData(['cloud', 'status'])).toEqual(STATUS);
  });

  it('keeps an end that arrives before the answer to cloud/signIn', async () => {
    const { wrapper } = harness({ signInMs: 0 });
    const { result } = renderHook(() => useAlpineSignIn(), { wrapper });
    await act(async () => void (await result.current.start('google')));
    await waitFor(() => expect(result.current.state.status).toBe('connected'));
  });

  it("reports a timed out or failed sign-in with the server's words, and cancelling tells the server", async () => {
    const { wrapper, notify, sent } = harness({ signInMs: null });
    const { result } = renderHook(() => useAlpineSignIn(), { wrapper });
    await act(async () => void (await result.current.start('google')));
    act(() => notify('cloud/signInFinished', { attemptId: 'attempt-1', result: 'timed_out' }));
    expect(result.current.state).toEqual({ status: 'timed_out', message: null });

    await act(async () => void (await result.current.start('google')));
    act(() => result.current.cancel());
    expect(result.current.state.status).toBe('idle');
    expect(sent).toContain('cloud/cancelSignIn');
  });
});

describe('the email code and signing out', () => {
  it('rejects a wrong code with the reason invalid_code and signs in on the right one', async () => {
    const { wrapper } = harness({ codeMs: 0 });
    const { result } = renderHook(() => ({ verify: useVerifyCode(), status: useCloudStatus() }), { wrapper });
    await act(async () => {
      await result.current.verify.mutateAsync({ email: 'a@b.co', code: '000000' }).catch(() => {});
    });
    await waitFor(() => expect(result.current.verify.error).toMatchObject({ data: { reason: 'invalid_code' } }));

    await act(async () => void (await result.current.verify.mutateAsync({ email: 'a@b.co', code: '123456' })));
    await waitFor(() => expect(result.current.status.data?.signedIn).toBe(true));
  });

  it('signs out and refreshes the connections', async () => {
    const { wrapper, client } = harness({ signedIn: true });
    client.setQueryData(['connections'], { connections: [] });
    const { result } = renderHook(() => ({ out: useCloudSignOut(), status: useCloudStatus() }), { wrapper });
    await waitFor(() => expect(result.current.status.data?.signedIn).toBe(true));
    await act(async () => void (await result.current.out.mutateAsync()));
    await waitFor(() => expect(result.current.status.data?.signedIn).toBe(false));
    expect(client.getQueryState(['connections'])?.isInvalidated).toBe(true);
  });
});

describe('Node.js', () => {
  it('shows the download going and refreshes nodeTools when it is done', async () => {
    const { wrapper } = harness({ node: 'missing', installMs: 25 });
    const { result } = renderHook(() => ({ tools: useNodeTools(), install: useInstallNodeTools() }), { wrapper });
    await waitFor(() => expect(result.current.tools.data?.ready).toBe(false));

    await act(async () => void (await result.current.install.install()));
    expect(result.current.install.state.status).toMatch(/downloading|done/);
    await waitFor(() => expect(result.current.install.state.status).toBe('done'));
    await waitFor(() => expect(result.current.tools.data?.ready).toBe(true));
  });

  it('says it failed', async () => {
    const { wrapper } = harness({ node: 'missing', installMs: 25, installFails: true });
    const { result } = renderHook(() => useInstallNodeTools(), { wrapper });
    await act(async () => void (await result.current.install()));
    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed', message: 'The download stopped' }));
  });
});
