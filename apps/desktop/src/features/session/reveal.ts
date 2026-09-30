import { useEffect, useRef, useState } from 'react';

/** How far the text on screen may fall behind the text received: a backlog is shown within about this long. */
export const REVEAL_MS = 200;

/**
 * How much of `text` to show once `elapsedMs` has passed since `shown` characters were on screen. The backlog shrinks
 * by the share of `windowMs` that passed, so a big burst is shown quickly and a trickle slowly, at least one character
 * a frame. A character is never cut in half (a surrogate pair stays whole).
 */
export function revealStep(text: string, shown: number, elapsedMs: number, windowMs = REVEAL_MS): number {
  const backlog = text.length - shown;
  if (backlog <= 0) return text.length;
  let next = shown + Math.max(1, Math.ceil(backlog * Math.min(1, elapsedMs / windowMs)));
  const last = text.charCodeAt(next - 1);
  if (next < text.length && last >= 0xd800 && last <= 0xdbff) next += 1;
  return Math.min(next, text.length);
}

/** A frame at 60 Hz, for the first step after the text was all shown. */
const FRAME_MS = 16;

/**
 * `text` as it should be on screen while it streams in: the received text is let out at an even pace (`revealStep`)
 * instead of in the bursts the network delivers. Text already there when the component mounts is shown at once,
 * and so is everything once `streaming` ends.
 */
export function useRevealed(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(() => text.length);
  const lastFrame = useRef<number | null>(null);

  useEffect(() => {
    if (!streaming || shown >= text.length) {
      lastFrame.current = null;
      return;
    }
    const frame = requestAnimationFrame((now) => {
      const elapsed = lastFrame.current === null ? FRAME_MS : now - lastFrame.current;
      lastFrame.current = now;
      setShown(revealStep(text, shown, elapsed));
    });
    return () => cancelAnimationFrame(frame);
  }, [text, streaming, shown]);

  return streaming ? text.slice(0, shown) : text;
}
