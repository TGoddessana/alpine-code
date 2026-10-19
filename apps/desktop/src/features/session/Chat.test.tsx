import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import { chatScript, cloudScript, mergeScripts, scriptedConnection, ServerProvider } from '@/shared/server';

import { Chat } from './Chat';

vi.mock('@tanstack/react-router', () => ({ Link: () => null }));

function mount(locale: Locale, signedIn: boolean) {
  const script = mergeScripts(chatScript(), cloudScript({ signedIn, balance: 0 }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={scriptedConnection(script)}>
        <LocaleProvider locale={locale}>
          <Chat
            sessionId="s-1"
            cwd="/Users/me/alpine-code"
            activeIds={[]}
            items={[
              {
                id: 'r1',
                kind: 'run_stopped',
                reason: 'credits_exhausted',
                message: 'Credits are used up. They refill on 2026-11-01.',
              },
            ]}
          />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('Chat', () => {
  it("words a run stopped by used-up credits with the date they fill up again, not the core's English", async () => {
    mount('ko', true);
    expect(await screen.findByText(/^Alpine 크레딧을 다 써서 멈췄어요 · .+에 다시 채워져요\./)).toBeTruthy();
    expect(screen.queryByText(/Credits are used up/)).toBeNull();
  });

  it('still says it in English, and without a date when the account is not known', async () => {
    mount('en', false);
    expect(await screen.findByText(/^Stopped: Alpine credits ran out · to go on now/)).toBeTruthy();
  });
});
