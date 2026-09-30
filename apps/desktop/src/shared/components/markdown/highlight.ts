import type { HighlightResult } from '@streamdown/code';

/** The coloured lines of a block of code: each line a list of pieces with their colour. */
export type Tokens = HighlightResult['tokens'];

export interface HighlightQuestion {
  key: string;
  code: string;
  language: string;
}

/** `tokens` is `null` when the language is unknown: the code stays plain. */
export interface HighlightAnswer {
  key: string;
  tokens: Tokens | null;
}

/** How many coloured blocks are kept, so a block drawn again (another session, a new window) is coloured at once. */
const KEEP = 200;

/**
 * Colouring runs in a worker. Preparing a language's grammar takes about 150 ms the first time (TypeScript), and on
 * the page it would freeze the screen right when a code block closes in a streaming reply.
 */
let worker: Worker | null | undefined;
const done = new Map<string, Tokens | null>();
const waiting = new Map<string, Set<(tokens: Tokens | null) => void>>();

const keyOf = (code: string, language: string) => `${language}\n${code}`;

function highlighter(): Worker | null {
  if (worker !== undefined) return worker;
  // No workers in tests (jsdom): code stays plain.
  if (typeof Worker === 'undefined') return (worker = null);
  worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: { key, tokens } }: MessageEvent<HighlightAnswer>) => {
    done.set(key, tokens);
    if (done.size > KEEP) done.delete(done.keys().next().value!);
    waiting.get(key)?.forEach((listener) => listener(tokens));
    waiting.delete(key);
  };
  return worker;
}

/** The coloured lines, if this code was coloured before; `undefined` if not yet, `null` if it stays plain. */
export function colouredBefore(code: string, language: string): Tokens | null | undefined {
  return done.get(keyOf(code, language));
}

/** Asks for the code coloured; `listener` gets the lines when they are ready. Returns a function to stop listening. */
export function colour(code: string, language: string, listener: (tokens: Tokens | null) => void): () => void {
  const key = keyOf(code, language);
  const target = highlighter();
  if (!target) return () => {};
  let listeners = waiting.get(key);
  if (!listeners) {
    listeners = new Set();
    waiting.set(key, listeners);
    target.postMessage({ key, code, language } satisfies HighlightQuestion);
  }
  listeners.add(listener);
  return () => void waiting.get(key)?.delete(listener);
}
