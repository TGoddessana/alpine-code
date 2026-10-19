import clsx from 'clsx';
import { useEffect, useRef } from 'react';

import { paintSnowscape, pixelSizeFor } from './paint';
import { createSnowfall, type Snowfall } from './snowfall';

/** The picture changes at this many frames a second: pixel art moves in steps, and it is cheap. */
const FRAME_MS = 1000 / 24;

/**
 * A pixel-art snow landscape that fills its parent (put it first in a `relative` parent, content after it): sun,
 * mountains, pines and a cabin painted once for the parent's size, with snow falling in front of it. It is only
 * decoration, so it is hidden from assistive tech and takes no clicks; under reduced motion the snow stands still.
 */
export function Snowscape({ className }: { className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLCanvasElement>(null);
  const snow = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = host.current;
    const back = scene.current;
    const front = snow.current;
    if (!element || !back || !front || typeof ResizeObserver === 'undefined') return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let loop = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const paint = () => {
      cancelAnimationFrame(loop);
      const { clientWidth, clientHeight } = element;
      const backContext = back.getContext('2d');
      const frontContext = front.getContext('2d');
      if (!clientWidth || !clientHeight || !backContext || !frontContext) return;
      const size = pixelSizeFor(clientWidth, clientHeight);
      const width = Math.ceil(clientWidth / size);
      const height = Math.ceil(clientHeight / size);
      for (const canvas of [back, front]) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${width * size}px`;
        canvas.style.height = `${height * size}px`;
      }
      const { data, chimney } = paintSnowscape(width, height);
      backContext.putImageData(new ImageData(data, width, height), 0, 0);
      const snowfall: Snowfall = createSnowfall(width, height, chimney);
      if (still) {
        snowfall.step(0);
        snowfall.draw(frontContext);
        return;
      }
      for (let warm = 0; warm < 40; warm++) snowfall.step(0.25); // so the smoke is already rising on the first frame
      let last = performance.now();
      const frame = (now: number) => {
        loop = requestAnimationFrame(frame);
        if (now - last < FRAME_MS) return;
        snowfall.step(Math.min(0.1, (now - last) / 1000));
        last = now;
        snowfall.draw(frontContext);
      };
      loop = requestAnimationFrame(frame);
    };

    // Painting again on every pixel of a window drag would repaint the picture over and over; wait for a pause.
    let first = true;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      if (first) {
        first = false;
        return paint();
      }
      timer = setTimeout(paint, 120);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(loop);
    };
  }, []);

  return (
    <div
      ref={host}
      aria-hidden="true"
      className={clsx('pointer-events-none absolute inset-0 overflow-hidden', className)}
    >
      <canvas ref={scene} className="absolute top-0 left-0" style={{ imageRendering: 'pixelated' }} />
      <canvas ref={snow} className="absolute top-0 left-0" style={{ imageRendering: 'pixelated' }} />
    </div>
  );
}
