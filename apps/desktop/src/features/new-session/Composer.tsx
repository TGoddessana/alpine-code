import { useState } from 'react';

import { useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnections } from '@/shared/server';

import { messages } from './messages';
import { ModelPicker } from './ModelPicker';

/**
 * The input, the same on every screen: a box of a few lines with its bar underneath (the model for now; attaching,
 * the safety rules and thinking effort join it when the core has them). Sessions do not run yet (they wait on the
 * session protocol), so sending only does what the first run promised: with nothing connected, it asks to connect
 * a model again.
 */
export function Composer({ locked = false }: { locked?: boolean }) {
  const t = useMessages(messages);
  const [text, setText] = useState('');
  const connections = useConnections();
  const ask = useConnectPrompt((state) => state.ask);
  const connected =
    !!connections.data && (connections.data.connections.length > 0 || connections.data.defaultModel !== null);

  const send = () => {
    if (!text.trim()) return;
    if (!connected) ask();
  };

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-canvas-raised pt-3 pr-3 pb-2 pl-4 focus-within:border-interactive focus-within:ring-1 focus-within:ring-interactive">
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
            send();
          }
        }}
        className="max-h-60 min-h-11 w-full resize-none bg-transparent text-body text-fg outline-none placeholder:text-fg-muted disabled:text-fg-muted"
      />
      <div className="-ml-2 flex items-center gap-1">
        <span className="grow" />
        <ModelPicker disabled={locked} />
        <button
          type="button"
          disabled={locked || connected}
          onClick={send}
          aria-label={t.send}
          title={connected ? t.sendSoon : t.send}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-faint enabled:hover:bg-canvas-sunken enabled:hover:text-fg-muted disabled:cursor-default"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13 3v5a2 2 0 0 1-2 2H3" />
            <path d="M6 7L3 10l3 3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
