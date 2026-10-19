import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, type Locale } from '@/shared/i18n';
import { chatScript, cloudScript, mergeScripts, scriptedConnection, ServerProvider, type Item } from '@/shared/server';

import { Chat } from './Chat';

vi.mock('@tanstack/react-router', () => ({ Link: () => null }));

const STOPPED: Item = {
  id: 'r1',
  kind: 'run_stopped',
  reason: 'credits_exhausted',
  message: 'Credits are used up. They refill on 2026-11-01.',
};

function mount(locale: Locale, signedIn: boolean, items: Item[] = [STOPPED]) {
  const script = mergeScripts(chatScript(), cloudScript({ signedIn, balance: 0 }));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ServerProvider connection={scriptedConnection(script)}>
        <LocaleProvider locale={locale}>
          <Chat sessionId="s-1" cwd="/Users/me/alpine-code" activeIds={[]} items={items} />
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

  it("words the AI's first read of the live data in the app's own language, whatever English the core sent", async () => {
    const first: Item = {
      id: 'n1',
      kind: 'status_line',
      text: 'The AI read the live data of this app for the first time.',
      code: 'live_data_first_read',
    };
    mount('ko', true, [first]);
    expect(await screen.findByText(/^AI가 앱의 실제 데이터를 처음 읽었어요\./)).toBeTruthy();
    expect(screen.queryByText(/for the first time/)).toBeNull();
    cleanup();
    mount('en', true, [first]);
    expect(await screen.findByText(/^The AI read the live data of your app for the first time\./)).toBeTruthy();
  });

  it('shows the core text of a status line with a code it has no words for', async () => {
    mount('ko', true, [{ id: 'n2', kind: 'status_line', text: 'Something new.', code: 'from_the_future' }]);
    expect(await screen.findByText('Something new.')).toBeTruthy();
  });
});
