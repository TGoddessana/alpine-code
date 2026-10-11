import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { SESSION_RUNNING, ServerError, useConnections } from '@/shared/server';

import { messages } from './messages';
import { ModeChip, nextMode, type Mode } from './ModeChip';

/**
 * The input, the same on every screen: a box of a few lines with its bar underneath: on the left the `agent` chip
 * and the permission `mode` (its own chip: safety belongs to the session, not the agent), on the right whatever `bar`
 * puts there; attaching and thinking effort join it when the core has them. Shift+Tab in the box goes to the next mode.
 *
 * Enter sends: `onSend` resolves once the server took the message, and the box empties; if it rejects, the text
 * stays and a quiet line says why. While `running` the send button becomes a stop button (`onStop`) and Enter
 * sends nothing, unless the run waits for an `answer`: then what I write goes to `answer.onSend`, and the button
 * sends while there is text. Esc stops the run too, from anywhere on the screen, unless a dialog, menu or list is
 * open (Esc closes that first). `prefill` puts text in the box and focuses it (not sent) each time its `key` changes. With no model connected, sending asks to connect one instead.
 */
export function Composer({
  locked = false,
  running = false,
  agent,
  bar,
  onSend,
  onStop,
  answer,
  prefill,
  mode,
}: {
  locked?: boolean;
  running?: boolean;
  /** The agent chip, first in the bar. */
  agent?: ReactNode;
  /** The right side of the bar, before the send button. */
  bar?: ReactNode;
  onSend?: (text: string) => Promise<unknown>;
  onStop?: () => void;
  /** The run waits for my answer, and what I write is it (e.g. what to do instead of a call). */
  answer?: { placeholder: string; onSend: (text: string) => Promise<unknown> };
  /** Fills the box and focuses it whenever `key` changes, e.g. a suggestion I picked. */
  prefill?: { text: string; key: number };
  /** The permission mode, shown and changed from the bar. */
  mode?: { value: Mode; onChange: (mode: Mode) => void };
}) {
  const t = useMessages(messages);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  // A new `prefill.key` refills the box (set while drawing, so there is no frame with the old text), then focuses.
  const [seenKey, setSeenKey] = useState(prefill?.key);
  const filled = prefill && prefill.key !== seenKey;
  if (filled) {
    setSeenKey(prefill.key);
    setText(prefill.text);
  }
  useEffect(() => {
    if (seenKey !== undefined) input.current?.focus();
  }, [seenKey]);
  const connections = useConnections();
  const ask = useConnectPrompt((state) => state.ask);
  const connected =
    !!connections.data && (connections.data.connections.length > 0 || connections.data.defaultModel !== null);

  // The screen draws again on every frame of a streaming reply, with a new `onStop` each time; the key listener
  // reads the latest one instead of being added again.
  const stop = useRef(onStop);
  useEffect(() => {
    stop.current = onStop;
  });
  const stoppable = running && !!onStop;
  useEffect(() => {
    if (!stoppable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      stop.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stoppable]);

  const send = async () => {
    if (!text.trim() || (running && !answer) || sending.current) return;
    if (!connected && !answer) return ask();
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await (answer ? answer.onSend(text.trim()) : onSend?.(text));
      setText('');
    } catch (reason) {
      setError(reason instanceof ServerError && reason.code === SESSION_RUNNING ? t.running : t.failed);
    } finally {
      sending.current = false;
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-col gap-1 rounded-2xl border border-line bg-canvas-raised pt-3 pr-3 pb-2 pl-4">
        <label htmlFor="composer" className="sr-only">
          {t.message}
        </label>
        <textarea
          id="composer"
          ref={input}
          rows={2}
          disabled={locked}
          value={text}
          placeholder={answer?.placeholder ?? t.placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line, and Enter while composing Hangul only commits the syllable.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
            if (event.key === 'Tab' && event.shiftKey && mode && !event.nativeEvent.isComposing) {
              event.preventDefault();
              mode.onChange(nextMode(mode.value));
            }
          }}
          className="max-h-60 min-h-11 w-full resize-none bg-transparent text-reading text-fg outline-none placeholder:text-fg-muted disabled:text-fg-muted"
        />
        <div className="-ml-2 flex items-center gap-1">
          {agent}
          {mode && <ModeChip mode={mode.value} onChange={mode.onChange} disabled={locked} />}
          <span className="grow" />
          {bar}
          {running && !(answer && text.trim()) ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t.stop}
              aria-keyshortcuts="Escape"
              title={t.stopTitle}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-interactive text-on-fill hover:bg-interactive-hover"
            >
              <Square size={14} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              disabled={locked || pending || !text.trim()}
              onClick={() => void send()}
              aria-label={t.send}
              title={t.send}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-full bg-interactive text-on-fill enabled:hover:bg-interactive-hover disabled:cursor-default disabled:opacity-40"
            >
              <ArrowUp size={18} strokeWidth={1.5} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {(error || (running && !answer)) && (
        <p role={error ? 'alert' : undefined} className="px-1 text-meta text-fg-muted">
          {error ?? t.working}
        </p>
      )}
    </div>
  );
}
