import { useState } from 'react';

import { useConnectPrompt } from '@/shared/components/connect';
import { useMessages } from '@/shared/i18n';
import { useConnections } from '@/shared/server';

import { messages } from './messages';

/**
 * The message box under a new session. Sessions do not run yet (they wait on the session protocol), so sending
 * only does what the first run promised: with nothing connected, it asks to connect a model again.
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
    <div className="flex items-center gap-2 rounded-xl border border-line bg-canvas-raised py-2 pr-2 pl-3 focus-within:border-interactive focus-within:ring-1 focus-within:ring-interactive">
      <label htmlFor="composer" className="sr-only">
        {t.message}
      </label>
      <input
        id="composer"
        disabled={locked}
        value={text}
        placeholder={t.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) send();
        }}
        className="min-h-8 min-w-0 grow bg-transparent text-body text-fg outline-none placeholder:text-fg-muted disabled:text-fg-muted"
      />
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
  );
}
