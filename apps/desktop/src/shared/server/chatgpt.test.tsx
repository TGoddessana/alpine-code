import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { useChatGPTSignIn } from './chatgpt';
import type { Notification, ServerConnection } from './connection';
import { ServerProvider } from './context';
import { CHATGPT_CONNECTION } from './fixtures';

/** A server that answers `chatgpt/signIn` with attempt `a1` and lets the test send notifications. */
function harness({ finishFirst = false } = {}) {
  const listeners = new Set<(n: Notification) => void>();
  const sent: string[] = [];
  const notify = (params: unknown) =>
    listeners.forEach((listener) => listener({ method: 'chatgpt/signInFinished', params }));
  const connection = {
    async request(method: string) {
      sent.push(method);
      if (method === 'chatgpt/signIn' && finishFirst)
        notify({ attemptId: 'a1', result: 'connected', connection: CHATGPT_CONNECTION });
      return method === 'chatgpt/signIn' ? { attemptId: 'a1', url: 'https://auth.example/a1' } : {};
    },
    subscribe(listener: (n: Notification) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as ServerConnection;
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ServerProvider connection={connection}>{children}</ServerProvider>
    </QueryClientProvider>
  );
  return { wrapper, notify, sent };
}

describe('useChatGPTSignIn', () => {
  it('waits for the browser, then follows the notification of its own attempt only', async () => {
    const { wrapper, notify } = harness();
    const { result } = renderHook(() => useChatGPTSignIn(), { wrapper });
    await act(async () => expect(await result.current.start()).toBe('https://auth.example/a1'));
    expect(result.current.state).toMatchObject({ status: 'waiting', attemptId: 'a1' });

    act(() => notify({ attemptId: 'someone-else', result: 'failed', message: 'x' }));
    expect(result.current.state.status).toBe('waiting');
    act(() => notify({ attemptId: 'a1', result: 'connected', connection: CHATGPT_CONNECTION }));
    expect(result.current.state).toEqual({ status: 'connected', connection: CHATGPT_CONNECTION });
  });

  it('keeps an end that arrives before the answer to chatgpt/signIn', async () => {
    const { wrapper } = harness({ finishFirst: true });
    const { result } = renderHook(() => useChatGPTSignIn(), { wrapper });
    await act(async () => void (await result.current.start()));
    await waitFor(() => expect(result.current.state.status).toBe('connected'));
  });

  it('treats a sign-in without plan usage as declined, and cancelling tells the server', async () => {
    const { wrapper, notify, sent } = harness();
    const { result } = renderHook(() => useChatGPTSignIn(), { wrapper });
    await act(async () => void (await result.current.start()));
    const off = { ...CHATGPT_CONNECTION, account: { ...CHATGPT_CONNECTION.account!, planUsage: false } };
    act(() => notify({ attemptId: 'a1', result: 'connected', connection: off }));
    expect(result.current.state).toEqual({ status: 'declined', connection: off });

    await act(async () => void (await result.current.start()));
    act(() => result.current.cancel());
    expect(result.current.state.status).toBe('idle');
    expect(sent).toContain('chatgpt/cancelSignIn');
  });
});
