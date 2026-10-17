import { FitAddon } from '@xterm/addon-fit';
import { Terminal as Emulator } from '@xterm/xterm';

import type { ServerConnection } from '@/shared/server';

import { installWebKitIme } from './webkitIme';

const MAX_CACHED = 6;
const caches = new WeakMap<ServerConnection, Map<string, TerminalRuntime>>();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** An emulator owns its buffer; React never stores or reconciles the output stream. */
export class TerminalRuntime {
  readonly element = document.createElement('div');
  readonly terminal: Emulator;
  private readonly fit = new FitAddon();
  private offset = 0;
  private generation = 0;
  private attached = false;
  private input = '';
  private inputTimer: ReturnType<typeof setTimeout> | undefined;
  private writing: Promise<void> = Promise.resolve();
  private reading: Promise<void> = Promise.resolve();
  private error: (message: string) => void = () => {};
  private ended: () => void = () => {};
  private gpu: { dispose(): void } | null = null;
  private disposed = false;
  private readonly disposeIme: () => void;

  constructor(
    private server: ServerConnection,
    readonly id: string,
  ) {
    const style = getComputedStyle(document.documentElement);
    const color = (token: string) => style.getPropertyValue(`--color-${token}`).trim();
    this.element.className = 'h-full w-full';
    this.terminal = new Emulator({
      allowProposedApi: false,
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.2,
      fontFamily: style.getPropertyValue('--font-terminal').trim() || 'monospace',
      customGlyphs: true,
      scrollback: 5000,
      theme: {
        background: color('canvas'),
        foreground: color('fg'),
        cursor: color('fg'),
        selectionBackground: color('selected'),
      },
    });
    this.terminal.loadAddon(this.fit);
    this.terminal.open(this.element);
    this.terminal.onData((data) => this.queueInput(data));
    this.disposeIme = installWebKitIme(this.terminal, (data) => this.queueInput(data));
    this.terminal.onResize(({ cols, rows }) => {
      void this.server
        .request('terminals/resize', { processId: this.id, cols, rows })
        .catch((cause: unknown) => this.report(cause));
    });
  }

  get mounted() {
    return this.attached;
  }

  private report(cause: unknown) {
    if (!this.disposed) this.error(cause instanceof Error ? cause.message : String(cause));
  }

  private queueInput(data: string) {
    this.input += data;
    this.inputTimer ??= setTimeout(() => {
      this.inputTimer = undefined;
      this.flushInput();
    }, 8);
  }

  private flushInput() {
    const data = this.input;
    this.input = '';
    if (!data) return;
    // Preserve ordering, including paste -> Enter -> Ctrl+C, with bounded RPC payloads.
    this.writing = this.writing
      .then(async () => {
        for (let start = 0; start < data.length;) {
          let end = Math.min(start + 16384, data.length);
          if (end < data.length && /[\uD800-\uDBFF]/.test(data[end - 1]!)) end--;
          await this.server.request('terminals/write', { processId: this.id, data: data.slice(start, end) });
          start = end;
        }
      })
      .catch((cause: unknown) => this.report(cause));
  }

  attach(host: HTMLElement, label: string, onError: (message: string) => void, onExit: () => void = () => {}) {
    this.error = onError;
    this.ended = onExit;
    this.attached = true;
    const generation = ++this.generation;
    host.append(this.element);
    this.element.querySelector('textarea')?.setAttribute('aria-label', label);
    this.terminal.options.cursorBlink = !document.hidden;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0 && this.attached) this.fit.fit();
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    void document.fonts?.ready.then(fit);
    this.terminal.focus();
    // Only visible emulators hold a GPU context. DOM rendering remains the fallback.
    void import('@xterm/addon-webgl').then(({ WebglAddon }) => {
      if (generation !== this.generation || !this.attached) return;
      try {
        const gpu = new WebglAddon();
        gpu.onContextLoss(() => {
          gpu.dispose();
          if (this.gpu === gpu) this.gpu = null;
        });
        this.terminal.loadAddon(gpu);
        this.gpu = gpu;
      } catch {
        /* WebGL unavailable: retain xterm's standard renderer. */
      }
    });
    this.reading = this.reading.then(() => this.read(generation));
    const visibility = () => {
      const next = ++this.generation;
      this.terminal.options.cursorBlink = !document.hidden;
      if (!document.hidden) {
        fit();
        this.reading = this.reading.then(() => this.read(next));
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      this.attached = false;
      ++this.generation;
      observer.disconnect();
      cancelAnimationFrame(frame);
      if (this.disposed) return;
      this.terminal.blur();
      this.flushInput();
      this.terminal.options.cursorBlink = false;
      this.gpu?.dispose();
      this.gpu = null;
      this.element.remove();
    };
  }

  private async read(generation: number) {
    try {
      while (this.attached && !document.hidden && generation === this.generation) {
        const page = await this.server.request('terminals/read', {
          processId: this.id,
          offset: this.offset,
          limit: 65536,
          waitMs: 1000,
        });
        if (!this.attached || generation !== this.generation) return;
        this.terminal.options.convertEol = !page.process.pty;
        if (page.text) {
          // Do not request the next chunk until xterm has parsed this one. This bounds
          // frontend memory even when a producer floods the disk-backed server log.
          await new Promise<void>((resolve) => this.terminal.write(page.text, resolve));
          this.offset = page.nextOffset;
        }
        this.terminal.options.disableStdin = page.process.status !== 'running' || !page.process.pty;
        if (page.nextOffset >= page.total && !['running', 'stopping'].includes(page.process.status)) {
          this.ended();
          return;
        }
        // A real server waits for output. Also avoid spinning with immediate test/demo responses.
        if (!page.text) await pause(32);
      }
    } catch (cause) {
      if (generation === this.generation && this.attached) this.report(cause);
    }
  }

  clear() {
    this.terminal.clear();
  }
  dispose() {
    this.disposed = true;
    this.attached = false;
    ++this.generation;
    clearTimeout(this.inputTimer);
    this.gpu?.dispose();
    this.disposeIme();
    this.terminal.dispose();
    this.element.remove();
  }
}

export function terminalRuntime(server: ServerConnection, id: string) {
  let cache = caches.get(server);
  if (!cache) {
    cache = new Map();
    caches.set(server, cache);
  }
  let runtime = cache.get(id);
  if (!runtime) runtime = new TerminalRuntime(server, id);
  cache.delete(id);
  cache.set(id, runtime);
  for (const [key, value] of cache) {
    if (cache.size <= MAX_CACHED) break;
    if (!value.mounted && key !== id) {
      value.dispose();
      cache.delete(key);
    }
  }
  return runtime;
}

export function disposeTerminal(server: ServerConnection, id: string) {
  const cache = caches.get(server);
  cache?.get(id)?.dispose();
  cache?.delete(id);
}
