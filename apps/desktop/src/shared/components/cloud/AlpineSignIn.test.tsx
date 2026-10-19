import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import {
  cloudScript,
  scriptedConnection,
  ServerProvider,
  type CloudScriptOptions,
  type ServerConnection,
} from '@/shared/server';

import { AlpineSignIn, type AlpineSignInProps } from './AlpineSignIn';

function mount(options: CloudScriptOptions = {}, props: Partial<AlpineSignInProps> = {}, locale: Locale = 'ko') {
  const base = scriptedConnection(cloudScript({ signInMs: 0, codeMs: 0, ...options }));
  const requests: { method: string; params: unknown }[] = [];
  const connection: ServerConnection = {
    request: (method, params) => {
      requests.push({ method, params });
      return base.request(method, params);
    },
    subscribe: base.subscribe,
  };
  const onDone = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={connection}>
        <LocaleProvider locale={locale}>
          <AlpineSignIn onDone={onDone} {...props} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  return { onDone, sent: (method: string) => requests.filter((r) => r.method === method).map((r) => r.params) };
}

beforeEach(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AlpineSignIn', () => {
  it('signs in with Google through the server, opens the page it gave, and goes on', async () => {
    const { onDone, sent } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(sent('cloud/signIn')).toEqual([{ method: 'google' }]);
    expect(window.open).toHaveBeenCalledWith(expect.stringContaining('provider=google'), '_blank', 'noopener');
  });

  it('shows the free credits once after the first sign-in, then starts', async () => {
    const { onDone } = mount({}, { welcome: true });
    fireEvent.click(screen.getByRole('button', { name: 'GitHub로 계속하기' }));
    expect(await screen.findByText('반가워요, 하늘님')).toBeTruthy();
    expect(screen.getByText('무료 크레딧 300을 드렸어요.')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '시작하기' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says so when the browser sign-in times out or fails, and tries again', async () => {
    mount({ signInEnds: 'timed_out' });
    fireEvent.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
    expect((await screen.findByRole('alert')).textContent).toBe('로그인 시간이 지났어요. 다시 해 주세요.');
    expect(screen.getByRole('button', { name: '다시 하기' })).toBeTruthy();
  });

  it('cancels the waiting sign-in when going back', async () => {
    const { sent } = mount({ signInMs: null });
    fireEvent.click(screen.getByRole('button', { name: 'Google로 계속하기' }));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('button', { name: '브라우저 다시 열기' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '‹ 뒤로' }));
    await waitFor(() => expect(sent('cloud/cancelSignIn')).toEqual([{ attemptId: 'attempt-1' }]));
    expect(screen.getByRole('button', { name: 'Google로 계속하기' })).toBeTruthy();
  });

  it('asks for a code by email with the language, rejects a wrong one and signs in on the right one', async () => {
    const { onDone, sent } = mount({}, {}, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'Get a code by email' }));
    fireEvent.input(await screen.findByLabelText('Email'), { target: { value: 'haneul@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    const code = await screen.findByLabelText('6-digit code');
    expect(sent('cloud/sendCode')).toEqual([{ email: 'haneul@example.com', locale: 'en' }]);

    fireEvent.input(code, { target: { value: '000000' } });
    expect((await screen.findByRole('alert')).textContent).toBe(
      'That code does not match. Check the numbers in the email.',
    );
    fireEvent.input(code, { target: { value: '123456' } });
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(sent('cloud/verifyCode')).toEqual([
      { email: 'haneul@example.com', code: '000000' },
      { email: 'haneul@example.com', code: '123456' },
    ]);
  });

  it('leads with the reason when something asked for the sign-in', () => {
    mount({}, { reason: '인터넷에 올리려면 Alpine 계정이 필요해요 (무료)' });
    expect(screen.getByText('인터넷에 올리려면 Alpine 계정이 필요해요 (무료)')).toBeTruthy();
  });
});
