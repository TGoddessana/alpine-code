import clsx from 'clsx';
import { useCallback, useState, type KeyboardEvent, type PointerEvent } from 'react';

export interface PanelWidthOptions {
  /** Where the width is remembered, so it survives restarts. */
  storageKey: string;
  initial: number;
  min: number;
  max: number;
}

export interface PanelWidth extends PanelWidthOptions {
  width: number;
  setWidth: (width: number) => void;
}

const clamp = (width: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, width)));

function stored({ storageKey, initial, min, max }: PanelWidthOptions) {
  try {
    const saved = Number(localStorage.getItem(storageKey));
    return saved ? clamp(saved, min, max) : initial;
  } catch {
    return initial;
  }
}

/** A side panel's width: clamped to its range and remembered in localStorage. */
export function usePanelWidth(options: PanelWidthOptions): PanelWidth {
  const [width, setState] = useState(() => stored(options));
  const { storageKey, min, max } = options;
  const setWidth = useCallback(
    (next: number) => {
      const value = clamp(next, min, max);
      setState(value);
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // Nowhere to remember it; the width still applies until the window closes.
      }
    },
    [storageKey, min, max],
  );
  return { ...options, width, setWidth };
}

export interface PanelResizerProps {
  panel: PanelWidth;
  /** The panel's edge this sits on: `right` for a panel on the left of the window, `left` for one on the right. */
  edge: 'left' | 'right';
  /** Names the panel being resized, e.g. "Main menu width". */
  label: string;
}

const STEP = 16;

/**
 * Drag handle on a panel's edge. Drag or use ← → to resize, double-click to go back to the initial width.
 * The panel must be `position: relative`; the handle straddles its border.
 */
export function PanelResizer({ panel, edge, label }: PanelResizerProps) {
  const [dragging, setDragging] = useState(false);
  // Moving the pointer right widens a left-side panel and narrows a right-side one.
  const sign = edge === 'right' ? 1 : -1;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    // Start from the width on screen: the window may have squeezed the panel below its saved width.
    const start = handle.parentElement?.getBoundingClientRect().width ?? panel.width;
    const x = event.clientX;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);
    // Keep the resize cursor while the pointer runs ahead of the handle.
    document.body.style.cursor = 'col-resize';
    const move = (e: globalThis.PointerEvent) => panel.setWidth(start + sign * (e.clientX - x));
    const up = () => {
      setDragging(false);
      document.body.style.cursor = '';
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    panel.setWidth(panel.width + sign * direction * STEP);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={panel.width}
      aria-valuemin={panel.min}
      aria-valuemax={panel.max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => panel.setWidth(panel.initial)}
      className={clsx(
        'group absolute inset-y-0 z-10 flex w-2 cursor-col-resize justify-center focus-visible:outline-none',
        edge === 'right' ? '-right-1' : '-left-1',
      )}
    >
      <div
        className={clsx(
          'h-full w-0.5 transition-colors',
          dragging ? 'bg-interactive' : 'group-hover:bg-interactive/50 group-focus-visible:bg-interactive',
        )}
      />
    </div>
  );
}
