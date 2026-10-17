import type { TerminalProcess } from '@alpine/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/i18n';
import { scriptedConnection, ServerProvider, type Script } from '@/shared/server';

import { Terminal } from './Terminal';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = { cursorBlink: true, disableStdin: false, convertEol: false };
    private input = document.createElement('textarea');
    private output = document.createElement('pre');
    private listener: (data: string) => void = () => {};
    open(host: HTMLElement) {
      host.append(this.input, this.output);
      this.input.addEventListener('input', () => {
        this.listener(this.input.value.replace(/\n/g, '\r'));
        this.input.value = '';
      });
    }
    loadAddon() {}
    onData(listener: (data: string) => void) {
      this.listener = listener;
    }
    onResize() {}
    write(text: string, done: () => void) {
      this.output.textContent += text;
      done();
    }
    focus() {
      this.input.focus();
    }
    blur() {
      this.input.blur();
    }
    clear() {
      this.output.textContent = '';
    }
    dispose() {
      this.input.remove();
      this.output.remove();
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));
const clients: QueryClient[] = [];
beforeEach(() => {
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
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});
function setup(delayStart = false, inspectId?: string) {
  let releaseStart = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  const launchRequests: string[] = [];
  const processes = new Map<string, TerminalProcess>();
  const starts: string[] = [];
  const inputs: { processId: string; data: string }[] = [];
  const reads: { processId: string; offset?: number }[] = [];
  const script: Script = {
    results: {
      'terminals/list': () => ({ processes: [...processes.values()] }),
      'terminals/start': ({ command, title, sessionId, kind }) => {
        starts.push(command);
        const process: TerminalProcess = {
          id: `shell-${starts.length}`,
          command,
          kind,
          title: title ?? 'Shell',
          cwd: '/project',
          sessionId,
          pty: true,
          pid: 1234,
          status: 'running',
          exitCode: null,
          cancelled: false,
          createdAt: 1,
          outputSize: 2,
        };
        processes.set(process.id, process);
        return { process };
      },
      'terminals/read': ({ processId, offset = 0 }) => {
        reads.push({ processId, offset });
        return { text: offset ? '' : '$ ', nextOffset: 2, total: 2, process: processes.get(processId)! };
      },
      'terminals/write': ({ processId, data }) => {
        inputs.push({ processId, data });
        if (data === 'exit\r') {
          const process = processes.get(processId)!;
          processes.set(processId, { ...process, status: 'exited', exitCode: 0 });
        }
        return { process: processes.get(processId)! };
      },
      'terminals/resize': ({ processId }) => ({ process: processes.get(processId)! }),
      'terminals/close': ({ processId }) => {
        processes.delete(processId);
        return { closed: true };
      },
    },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const connection = scriptedConnection(script);
  const request = connection.request;
  connection.request = async (method, params) => {
    if (method === 'terminals/start') {
      launchRequests.push(method);
      if (delayStart) await gate;
    }
    return request(method, params);
  };
  const mount = () =>
    render(
      <LocaleProvider locale="en">
        <QueryClientProvider client={client}>
          <ServerProvider connection={connection}>
            <Terminal cwd="/project" sessionId="chat-1" processId={inspectId} />
          </ServerProvider>
        </QueryClientProvider>
      </LocaleProvider>,
    );
  return { mount, starts, inputs, reads, processes, launchRequests, releaseStart };
}
it('automatically opens one shell, types directly into the same PTY across navigation and resumes from its previous output offset', async () => {
  const app = setup();
  const first = app.mount();
  const input = await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.input(input, { target: { value: 'cd src; export VALUE=kept\r' } });
  await waitFor(() => expect(app.inputs).toHaveLength(1));
  expect(app.processes.get('shell-1')?.sessionId).toBe('chat-1');
  first.unmount();
  const readCount = app.reads.length;
  app.mount();
  const resumed = await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.input(resumed, { target: { value: 'pwd; echo "$VALUE"\r' } });
  await waitFor(() => expect(app.inputs).toHaveLength(2));
  await waitFor(() => expect(app.reads.length).toBeGreaterThan(readCount));
  expect(app.reads.slice(readCount).every((read) => read.offset === 2)).toBe(true);
  expect(app.starts).toEqual(['exec "${SHELL:-/bin/sh}" -i']);
  expect(app.inputs.map((item) => item.processId)).toEqual(['shell-1', 'shell-1']);
  expect(screen.queryByPlaceholderText('Enter a command')).toBeNull();
});
it('splits independent terminal instances, routes their input separately, and closes only the chosen terminal', async () => {
  const app = setup();
  app.mount();
  await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Split terminal' }));
  const second = await screen.findByRole('textbox', { name: 'Terminal input: Shell 2' });
  const first = screen.getByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.input(first, { target: { value: 'first\r' } });
  fireEvent.input(second, { target: { value: 'second\r' } });
  await waitFor(() => expect(app.inputs).toHaveLength(2));
  expect(app.inputs).toEqual([
    { processId: 'shell-1', data: 'first\r' },
    { processId: 'shell-2', data: 'second\r' },
  ]);
  expect(screen.queryByRole('button', { name: 'Other terminals' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Shell 1' }));
  await waitFor(() => expect(document.activeElement).toBe(first));
  expect(screen.getAllByRole('textbox')).toEqual([first, second]);
  fireEvent.click(screen.getByRole('button', { name: 'Shell 2' }));
  await waitFor(() => expect(document.activeElement).toBe(second));
  expect(screen.getAllByRole('textbox')).toEqual([first, second]);
  fireEvent.click(screen.getByRole('button', { name: 'Kill terminal' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Terminal input: Shell 2' })).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Terminal input: Shell 1' })).toBeTruthy();
  expect(app.processes.size).toBe(1);
});

it('removes a shell on exit, promotes its split, and removes the final shell without retaining a completed pane', async () => {
  const app = setup();
  app.mount();
  const first = await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Split terminal' }));
  const second = await screen.findByRole('textbox', { name: 'Terminal input: Shell 2' });
  fireEvent.input(first, { target: { value: 'exit\r' } });
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Terminal input: Shell 1' })).toBeNull());
  expect(app.processes.has('shell-1')).toBe(false);
  expect(screen.getByRole('textbox', { name: 'Terminal input: Shell 2' })).toBe(second);
  await waitFor(() => expect(document.activeElement).toBe(second));
  fireEvent.input(second, { target: { value: 'exit\r' } });
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(app.processes.size).toBe(0);
  expect(screen.getAllByRole('button', { name: 'New terminal' })).toHaveLength(2);
});

it('retains completed ordinary commands for reviewing their output', async () => {
  const app = setup();
  app.mount();
  const input = await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  app.processes.set('shell-1', { ...app.processes.get('shell-1')!, kind: 'command' });
  fireEvent.input(input, { target: { value: 'exit\r' } });
  await screen.findByText('Finished (0)');
  expect(app.processes.has('shell-1')).toBe(true);
  expect(screen.getByRole('textbox')).toBe(input);
});

it('offers switching only when another terminal is hidden and preserves the other split', async () => {
  const app = setup();
  app.mount();
  const first = await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Split terminal' }));
  const second = await screen.findByRole('textbox', { name: 'Terminal input: Shell 2' });
  await waitFor(() => expect(document.activeElement).toBe(second));
  expect(screen.queryByRole('button', { name: 'Other terminals' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
  await screen.findByRole('textbox', { name: 'Terminal input: Shell 3' });
  fireEvent.click(screen.getByRole('button', { name: 'Other terminals' }));
  expect(await screen.findByRole('menuitem', { name: 'Shell 2' })).toBeTruthy();
  expect(screen.queryByRole('menuitem', { name: 'Shell 1' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Shell 2' }));
  await screen.findByRole('textbox', { name: 'Terminal input: Shell 2' });
  expect(screen.getByRole('textbox', { name: 'Terminal input: Shell 1' })).toBe(first);
  expect(app.processes.size).toBe(3);
});

it('shares an in-flight default launch when the terminal tab is reopened before startup finishes', async () => {
  const app = setup(true);
  const first = app.mount();
  await waitFor(() => expect(app.launchRequests).toHaveLength(1));
  first.unmount();
  app.mount();
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'New terminal' }).every((button) => button.hasAttribute('disabled')),
    ).toBe(true),
  );
  expect(app.launchRequests).toHaveLength(1);
  app.releaseStart();
  await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  expect(app.starts).toHaveLength(1);
});

it('creates a usable default shell when the registry contains only agent command logs', async () => {
  const app = setup();
  app.processes.set('agent', {
    id: 'agent',
    command: 'pnpm test',
    title: 'Agent tests',
    kind: 'command',
    cwd: '/project',
    pty: false,
    pid: 42,
    status: 'exited',
    exitCode: 0,
    cancelled: false,
    createdAt: 1,
    outputSize: 0,
  });
  app.mount();
  await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  expect(app.starts).toHaveLength(1);
});

it('creates a new default shell on a later tab opening after the last shell was exited', async () => {
  const app = setup();
  const first = app.mount();
  const input = await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  fireEvent.input(input, { target: { value: 'exit\r' } });
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(app.starts).toHaveLength(1);
  first.unmount();
  app.mount();
  await screen.findByRole('textbox', { name: 'Terminal input: Shell 1' });
  expect(app.starts).toHaveLength(2);
});

it('keeps explicitly requested command output without creating a shell over it', async () => {
  const app = setup(false, 'agent');
  app.processes.set('agent', {
    id: 'agent',
    command: 'pnpm test',
    title: 'Agent tests',
    kind: 'command',
    cwd: '/project',
    pty: false,
    pid: 42,
    status: 'exited',
    exitCode: 0,
    cancelled: false,
    createdAt: 1,
    outputSize: 0,
  });
  app.mount();
  await screen.findByRole('textbox', { name: 'Terminal input: Agent tests' });
  await screen.findByText('Finished (0)');
  expect(app.launchRequests).toHaveLength(0);
});
