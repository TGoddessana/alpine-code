import { ArrowUp } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * The map's own input, floating at the bottom of the canvas: what I ask the map (draw it, add a side of the product,
 * regroup) goes from here. With no map yet an empty message just draws it.
 */
export function MapAsk({
  empty,
  disabled,
  onSend,
  agent,
}: {
  /** No map yet: the placeholder invites drawing one, and sending with no words draws it. */
  empty: boolean;
  disabled: boolean;
  /** Resolves true once the AI has the request; the words fly off as a bubble then. */
  onSend: (text: string, from: DOMRect | null) => Promise<boolean>;
  /** Who does the map's work (an agent chip), under the words as in every input. */
  agent?: ReactNode;
}) {
  const t = useMessages(messages);
  const [text, setText] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const canSend = !disabled && (empty || !!text.trim());
  const send = async () => {
    if (!canSend) return;
    const words = text.trim();
    if (await onSend(words, form.current?.getBoundingClientRect() ?? null)) setText('');
  };
  return (
    <form
      ref={form}
      aria-label={t.mapAskLabel}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="pointer-events-auto flex w-full flex-col gap-1 rounded-2xl border border-line bg-canvas-raised p-2 pl-4 shadow-overlay"
    >
      <textarea
        value={text}
        rows={1}
        aria-label={t.mapAskLabel}
        placeholder={empty ? t.mapAskFirst : t.mapAskMore}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
        className="max-h-32 min-h-8 resize-none bg-transparent py-1.5 text-reading outline-none"
      />
      <div className="flex items-center gap-2">
        <span className="-ml-2 flex min-w-0 grow items-center gap-1">{agent}</span>
        <button
          type="submit"
          disabled={!canSend}
          aria-label={empty && !text.trim() ? t.discover : t.askSend}
          title={empty && !text.trim() ? t.discover : t.askSend}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-interactive text-on-fill disabled:cursor-default disabled:opacity-40"
        >
          <ArrowUp size={16} aria-hidden />
        </button>
      </div>
    </form>
  );
}

/**
 * What I just asked, flying from the input to where the map begins and becoming its first card: a dark start card
 * holding my words until the first real journey lands there. On a map that already exists it flies to the middle
 * and is taken in.
 */
export function AskFlight({
  text,
  from,
  toFirst,
  landed,
}: {
  text: string;
  /** Where the input was, in the window. */
  from: DOMRect | null;
  /** The map is empty: the bubble becomes the first card; otherwise it fades into the map. */
  toFirst: boolean;
  /** The first real card is on the map: the stand-in gives way. */
  landed: boolean;
}) {
  const t = useMessages(messages);
  const card = useRef<HTMLDivElement>(null);
  const [morphed, setMorphed] = useState(false);
  useLayoutEffect(() => {
    const el = card.current;
    const area = el?.offsetParent?.getBoundingClientRect();
    if (!el || !area || !from || reducedMotion()) {
      setMorphed(true);
      return;
    }
    const end = el.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (end.left + end.width / 2);
    const dy = from.top + from.height / 2 - (end.top + end.height / 2);
    const flight = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.9)`, opacity: 0 },
        { transform: `translate(${dx}px, ${dy - 24}px) scale(1)`, opacity: 1, offset: 0.15 },
        toFirst
          ? { transform: 'translate(0, 0) scale(1)', opacity: 1 }
          : { transform: 'translate(0, 0) scale(0.6)', opacity: 0 },
      ],
      { duration: 700, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' },
    );
    flight.onfinish = () => setMorphed(true);
    return () => flight.cancel();
  }, [from, toFirst]);
  if (!toFirst && morphed) return null;
  return (
    <div
      ref={card}
      aria-hidden
      className="pointer-events-none absolute z-10 transition-[opacity,border-radius,background-color,color,padding,width] duration-(--motion-normal)"
      style={
        toFirst ? { left: 48, top: '38%', opacity: landed ? 0 : 1 } : { left: '50%', top: '45%', marginLeft: -110 }
      }
    >
      {morphed && toFirst ? (
        <div className="flex w-54 flex-col gap-2 rounded-xl bg-fg px-4 py-3 text-canvas-raised shadow-overlay">
          <span className="flex items-center gap-1.5 text-meta opacity-70">
            <span className="size-1.5 animate-pulse rounded-full bg-canvas-raised" />
            {t.flightStart}
          </span>
          <span className="line-clamp-3 text-body">{text}</span>
        </div>
      ) : (
        <div className="max-w-80 rounded-2xl bg-hover px-3.5 py-2 text-reading text-fg">{text}</div>
      )}
    </div>
  );
}
