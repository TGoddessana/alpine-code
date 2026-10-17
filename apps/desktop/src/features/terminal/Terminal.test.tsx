import type { TerminalProcess } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { type Script, scriptedConnection, ServerProvider } from '@/shared/server';

import { Terminal } from './Terminal';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('persistent terminal', () => {
  it('opens an interactive shell and sends subsequent input to the same process after navigation', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    let process: TerminalProcess | null = null;
    const commands: string[] = [];
    const sessions: Array<string | null | undefined> = [];
    const inputs: Array<{ processId: string; data: string }> = [];
    const script: Script = {
      results: {
        'terminals/list': () => ({ processes: process ? [process] : [] }),
        'terminals/start': ({ command, title, sessionId }) => {
          commands.push(command);
          sessions.push(sessionId);
          process = {
            id: 'persistent-shell',
            command,
            title: title ?? 'Shell',
            sessionId,
            cwd: '/project',
            pty: true,
            pid: 1234,
            status: 'running',
            exitCode: null,
            cancelled: false,
            createdAt: 1,
            outputSize: 0,
          };
          return { process };
        },
        'terminals/read': () => ({ text: '', total: 0, nextOffset: 0, process: process! }),
        'terminals/resize': () => ({ process: process! }),
        'terminals/write': ({ processId, data }) => {
          inputs.push({ processId, data });
          return { process: process! };
        },
      },
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const connection = scriptedConnection(script);
    const mount = () =>
      render(
        <LocaleProvider locale="en">
          <QueryClientProvider client={client}>
            <ServerProvider connection={connection}>
              <Terminal cwd="/project" sessionId="chat-1" />
            </ServerProvider>
          </QueryClientProvider>
        </LocaleProvider>,
      );
    const first = mount();
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    await waitFor(() => expect(screen.getByLabelText('Terminal input').hasAttribute('disabled')).toBe(false));
    expect(commands).toEqual(['exec "${SHELL:-/bin/sh}" -i']);
    expect(sessions).toEqual(['chat-1']);
    fireEvent.change(screen.getByLabelText('Terminal input'), { target: { value: 'cd src; export VALUE=kept' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(inputs).toHaveLength(1));
    first.unmount();
    mount();
    await waitFor(() => expect(screen.getByLabelText('Terminal input').hasAttribute('disabled')).toBe(false));
    fireEvent.change(screen.getByLabelText('Terminal input'), { target: { value: 'pwd; echo "$VALUE"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(inputs).toEqual([
      { processId: 'persistent-shell', data: 'cd src; export VALUE=kept\n' },
      { processId: 'persistent-shell', data: 'pwd; echo "$VALUE"\n' },
    ]);
    expect(commands).toHaveLength(1);
    client.clear();
  });
});
