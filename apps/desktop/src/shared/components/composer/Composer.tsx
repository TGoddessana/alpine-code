import { useRef, useState, type ReactNode } from 'react';

import { useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { SESSION_RUNNING, ServerError, useConnections } from '@/shared/server';

import { messages } from './messages';
import { ModelPicker } from './ModelPicker';

const icon = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/**
 * The input, the same on every screen: a box of a few lines with its bar underneath (the model, or whatever `bar`
 * puts there; attaching, the safety rules and thinking effort join it when the core has them).
 *
 * Enter sends: `onSend` resolves once the server took the message, and the box empties; if it rejects, the text
 * stays and a quiet line says why. While `running` the send button becomes a stop button (`onStop`) and Enter
 * sends nothing. With no model connected, sending asks to connect one instead.
 */
export function Composer({
  locked = false,
  running = false,
  bar,
  onSend,
  onStop,
}: {
  locked?: boolean;
  running?: boolean;
  /** Replaces the model picker in the bar. */
  bar?: ReactNode;
  onSend?: (text: string) => Promise<unknown>;
  onStop?: () => void;
}) {
  const t = useMessages(messages);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);
  const connections = useConnections();
  const ask = useConnectPrompt((state) => state.ask);
  const connected =
    !!connections.data && (connections.data.connections.length > 0 || connections.data.defaultModel !== null);

  const send = async () => {
    if (!text.trim() || running || sending.current) return;
    if (!connected) return ask();
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await onSend?.(text);
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
      <div className="flex flex-col gap-1 rounded-xl border border-line bg-canvas-raised pt-3 pr-3 pb-2 pl-4">
        <label htmlFor="composer" className="sr-only">
          {t.message}
        </label>
        <textarea
          id="composer"
          rows={2}
          disabled={locked}
          value={text}
          placeholder={t.placeholder}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line, and Enter while composing Hangul only commits the syllable.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
          className="max-h-60 min-h-11 w-full resize-none bg-transparent text-body text-fg outline-none placeholder:text-fg-muted disabled:text-fg-muted"
        />
        <div className="-ml-2 flex items-center gap-1">
          <span className="grow" />
          {bar ?? <ModelPicker disabled={locked} />}
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t.stop}
              title={t.stop}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-canvas-sunken hover:text-fg"
            >
              <svg {...icon} fill="currentColor" stroke="none">
                <rect x="4" y="4" width="8" height="8" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              disabled={locked || pending || !text.trim()}
              onClick={() => void send()}
              aria-label={t.send}
              title={t.send}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted enabled:hover:bg-canvas-sunken enabled:hover:text-fg disabled:cursor-default disabled:text-fg-faint"
            >
              <svg {...icon}>
                <path d="M13 3v5a2 2 0 0 1-2 2H3" />
                <path d="M6 7L3 10l3 3" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {(error || running) && (
        <p role={error ? 'alert' : undefined} className="px-1 text-meta text-fg-muted">
          {error ?? t.working}
        </p>
      )}
    </div>
  );
}
