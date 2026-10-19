import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { taskForceAt } from '@/shared/components/taskforce/fixtures';
import { scriptedConnection, ServerProvider, sessionInfo, type Script, type ScriptContext } from '@/shared/server';

import { SessionChanges } from './SessionChanges';

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
function mount(changes: NonNullable<Script['results']>['session/changes']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ServerProvider
        connection={scriptedConnection({
          results: {
            'session/open': { info: sessionInfo({ id: 'work', cwd: '/project' }), seq: 0, items: [], active: [] },
            'session/changes': changes,
          },
        })}
      >
        <LocaleProvider locale="en">
          <SessionChanges
            sessionId="work"
            result={{ files: [], commands: [], legacyFiles: [{ path: 'old.txt', added: 0, removed: 0, diff: null }] }}
          />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
}
it('switches between stored request and cumulative diffs and keeps legacy filenames separate', async () => {
  const requests: (string | null | undefined)[] = [];
  mount(({ checkpointId }) => {
    requests.push(checkpointId);
    return {
      available: true,
      checkpoints: [{ id: 'first', label: 'First request', createdAt: '2026-10-17T00:00:00Z', status: 'idle' }],
      files: [
        {
          path: 'a.txt',
          added: 1,
          removed: 1,
          diff: ['@@ -1 +1 @@', '-original', checkpointId ? '+request result' : '+session result'],
        },
      ],
    };
  });
  const select = await screen.findByRole('combobox', { name: 'Compare' });
  fireEvent.click(await screen.findByRole('button', { name: /a\.txt/ }));
  expect(await screen.findByText('+session result')).toBeTruthy();
  fireEvent.change(select, { target: { value: 'first' } });
  await waitFor(() => expect(requests).toContain('first'));
  fireEvent.click(await screen.findByRole('button', { name: /a\.txt/ }));
  expect(await screen.findByText('+request result')).toBeTruthy();
  expect(screen.queryByText('+session result')).toBeNull();
  fireEvent.click(screen.getByText('Earlier file edit history (1)'));
  expect(screen.getByText('old.txt')).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Changes to old.txt' })).toBeNull();
});
it('does not pretend that an older session has saved checkpoints', async () => {
  mount(() => ({ available: false, checkpoints: [], files: [] }));
  expect(await screen.findByText('No checkpoints have been saved yet.')).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getByText('Earlier file edit history (1)')).toBeTruthy();
});
it('lets the user retry a checkpoint read failure', async () => {
  let failed = false;
  mount(() => {
    if (!failed) {
      failed = true;
      throw new Error('unavailable');
    }
    return { available: false, checkpoints: [], files: [] };
  });
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No checkpoints have been saved yet.')).toBeTruthy();
});
it("reads the changes again as a TF's agents work between the session's turns", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  let reads = 0;
  let context: ScriptContext | null = null;
  render(
    <QueryClientProvider client={client}>
      <ServerProvider
        connection={scriptedConnection({
          results: {
            'session/open': {
              info: sessionInfo({ id: 'work', cwd: '/project' }),
              seq: 0,
              items: [],
              active: [taskForceAt(3)],
            },
            'session/changes': (_, scripted) => {
              reads += 1;
              context = scripted;
              return { available: false, checkpoints: [], files: [] };
            },
          },
        })}
      >
        <LocaleProvider locale="en">
          <SessionChanges sessionId="work" result={{ files: [], commands: [] }} />
        </LocaleProvider>
      </ServerProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(reads).toBe(1));
  context!.emit({
    method: 'session/event',
    params: { sessionId: 'work', seq: 1, event: { type: 'item_started', item: taskForceAt(10) } },
  });
  await waitFor(() => expect(reads).toBe(2));
});
