import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { scriptedConnection } from '@/shared/server';

import { disposeTerminal, terminalRuntime } from './runtime';

const fake = vi.hoisted(() => ({
  callbacks: [] as (() => void)[],
  writes: [] as string[],
  inputs: [] as ((data: string) => void)[],
  disposed: 0,
}));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = { cursorBlink: false, disableStdin: false, convertEol: false };
    open() {}
    loadAddon() {}
    onResize() {}
    focus() {}
    blur() {}
    clear() {}
    onData(listener: (data: string) => void) {
      fake.inputs.push(listener);
    }
    write(text: string, done: () => void) {
      fake.writes.push(text);
      fake.callbacks.push(done);
    }
    dispose() {
      fake.disposed++;
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
beforeEach(() => {
  fake.callbacks = [];
  fake.writes = [];
  fake.inputs = [];
  fake.disposed = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const process = {
  id: 'shell',
  command: 'sh',
  cwd: '/project',
  title: 'sh',
  pty: true,
  pid: 1234,
  status: 'running' as const,
  cancelled: false,
  exitCode: null,
  createdAt: 0,
  outputSize: 131072,
};

it('waits for the parser before reading another chunk, and resumes without replaying acknowledged output', async () => {
  const offsets: number[] = [];
  const server = scriptedConnection({
    results: {
      'terminals/read': ({ offset = 0 }) => {
        offsets.push(offset);
        return {
          process: { ...process, status: 'exited' },
          text: offset < 131072 ? 'x'.repeat(65536) : '',
          nextOffset: Math.min(offset + 65536, 131072),
          total: 131072,
        };
      },
      'terminals/resize': { process },
    },
  });
  const runtime = terminalRuntime(server, 'shell');
  const host = document.createElement('div');
  document.body.append(host);
  const detach = runtime.attach(host, 'terminal', () => {});
  await vi.waitFor(() => expect(fake.callbacks).toHaveLength(1));
  expect(offsets).toEqual([0]);
  fake.callbacks[0]!();
  await vi.waitFor(() => expect(fake.callbacks).toHaveLength(2));
  expect(offsets).toEqual([0, 65536]);
  // Detaching during a write and immediately attaching must not duplicate a chunk.
  detach();
  const detachAgain = runtime.attach(host, 'terminal', () => {});
  fake.callbacks[1]!();
  await vi.waitFor(() => expect(offsets).toContain(131072));
  expect(fake.writes.every((text) => text.length <= 65536)).toBe(true);
  detachAgain();
  fake.callbacks.at(-1)?.();
  disposeTerminal(server, 'shell');
  host.remove();
});

it('batches keyboard and paste input in order without splitting Unicode characters', async () => {
  const inputs: string[] = [];
  const server = scriptedConnection({
    results: {
      'terminals/write': ({ data }) => {
        inputs.push(data);
        return { process };
      },
    },
  });
  const runtime = terminalRuntime(server, 'shell');
  const input = fake.inputs[0]!;
  const pasted = 'a'.repeat(16383) + '🚀한글' + 'b'.repeat(20000);
  input(pasted);
  input('\r');
  input('\x03');
  await vi.waitFor(() => expect(inputs.join('')).toBe(pasted + '\r\x03'));
  expect(
    inputs.every((data) => data.length <= 16384 && new TextDecoder().decode(new TextEncoder().encode(data)) === data),
  ).toBe(true);
  runtime.dispose();
});

it('evicts detached emulator buffers after six cached terminals', () => {
  const server = scriptedConnection();
  for (let i = 0; i < 9; i++) terminalRuntime(server, String(i));
  expect(fake.disposed).toBe(3);
  for (let i = 3; i < 9; i++) disposeTerminal(server, String(i));
});
