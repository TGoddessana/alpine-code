import { PanelRight } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';

const STORAGE_KEY = 'alpine.work-result.open';

const listeners = new Set<() => void>();
let current: boolean | null = null;

function read(): boolean {
  if (current === null) {
    try {
      current = localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      current = false;
    }
  }
  return current;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Whether the work result panel is open: closed until I open it, then remembered across sessions and restarts. The
 * state is shared, so the top bar's button and the panel beside the chat always agree.
 */
export function useWorkResultOpen(): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, read);
  const set = useCallback((value: boolean) => {
    current = value;
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Not remembered, but it still opens and closes.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [open, set];
}

/**
 * The button in the top bar that opens and closes the work result panel. While the panel is closed it
 * says how many files the work changed, so a change is noticed without the panel opening by itself.
 */
export function PanelToggle({ open, files, onToggle }: { open: boolean; files: number; onToggle: () => void }) {
  const t = useMessages(messages);
  const format = useFormat();
  const count = !open && files > 0;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={open ? t.close : count ? t.openWithFiles(format.number(files)) : t.open}
      title={t.title}
      onClick={onToggle}
      className="inline-flex h-8 min-w-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-1.5 text-fg-muted hover:bg-hover hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg"
    >
      <PanelRight size={18} strokeWidth={1.5} aria-hidden="true" />
      {count && (
        <span className="min-w-4.5 rounded-full bg-interactive px-1.5 text-meta text-on-fill tabular-nums">
          {format.number(files)}
        </span>
      )}
    </button>
  );
}
