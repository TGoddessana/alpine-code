import type { TerminalProcess } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { type Script, scriptedConnection, ServerProvider } from '@/shared/server';

import { ProcessControl } from './ProcessControl';

afterEach(cleanup);

it('stops the agent before session processes and leaves uncooperative work visible until force stop', async () => {
  const requests: string[] = [];
  let process: TerminalProcess = {
    id: 'build',
    command: 'build',
    cwd: '/project',
    sessionId: 'chat',
    title: 'Build',
    pty: false,
    pid: 42,
    status: 'running',
    exitCode: null,
    cancelled: false,
    createdAt: 1,
    outputSize: 20,
  };
  const script: Script = {
    results: {
      'processes/list': () => ({ processes: [process], tools: [] }),
      'session/cancel': ({ sessionId }) => {
        requests.push(`agent:${sessionId}`);
        return {};
      },
      'processes/stop': ({ sessionId }) => {
        requests.push(`processes:${sessionId}`);
        process = { ...process, status: 'stopping', cancelled: true };
        return { processes: [process], tools: [] };
      },
      'terminals/stop': ({ processId, force }) => {
        requests.push(`${processId}:${String(force)}`);
        process = { ...process, status: 'cancelled', exitCode: -9 };
        return { process };
      },
    },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="en">
      <QueryClientProvider client={client}>
        <ServerProvider connection={scriptedConnection(script)}>
          <ProcessControl cwd="/project" sessionId="chat" />
        </ServerProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Stop all' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Stop all' }));
  await screen.findByText('Waiting for exit · still running');
  expect(requests).toEqual(['agent:chat', 'processes:chat']);
  const force = screen.getByRole('button', { name: 'Force stop' });
  await waitFor(() => expect(force.hasAttribute('disabled')).toBe(false));
  fireEvent.click(force);
  await screen.findByText('Stopped');
  expect(requests).toEqual(['agent:chat', 'processes:chat', 'build:true']);
  expect(screen.queryByRole('button', { name: 'Force stop' })).toBeNull();
  client.clear();
});

it('shows residual user functions as still executing without offering an unsafe thread kill', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <LocaleProvider locale="en">
      <QueryClientProvider client={client}>
        <ServerProvider
          connection={scriptedConnection({
            results: {
              'processes/list': {
                processes: [],
                tools: [
                  {
                    id: 'thread',
                    sessionId: 'chat',
                    name: 'export',
                    createdAt: 1,
                    status: 'stopping',
                    cancellable: false,
                  },
                ],
              },
            },
          })}
        >
          <ProcessControl cwd="/project" sessionId="chat" />
        </ServerProvider>
      </QueryClientProvider>
    </LocaleProvider>,
  );
  await screen.findByText(/may continue until the function actually returns/);
  expect(screen.queryByRole('button', { name: 'Force stop' })).toBeNull();
  client.clear();
});
