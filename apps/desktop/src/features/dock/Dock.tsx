import { PanelResizer, usePanelWidth } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { Maximize2, Minimize2, PanelRight, X } from 'lucide-react';
import { useLayoutEffect, type KeyboardEvent, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { endExpanded, resetExpanded, useDockExpanded, useDockOpen, useDockTab } from './state';

export interface DockTab {
  id: string;
  label: string;
  content: ReactNode;
  /** The content scrolls and pads itself (a conversation with its own composer). */
  bare?: boolean;
  keepMounted?: boolean;
}

/**
 * The page and, when the dock is open, the dock on its right. Under "크게 보기" the dock takes the whole width and the
 * page stays mounted but hidden, so what I was doing on it is still there when I shrink the dock back. The wrapper is
 * `relative` so a panel on the page can overlay the dock (see `ProductMap`).
 *
 * `scope` names the page (`session:<id>`, `board:<project>`). "크게 보기" belongs to one scope: when it changes, the
 * new page starts at the normal width.
 */
export function DockLayout({ scope, tabs, children }: { scope: string; tabs: DockTab[]; children: ReactNode }) {
  const [open] = useDockOpen();
  const [expanded] = useDockExpanded(scope);
  useLayoutEffect(() => {
    resetExpanded(scope);
    // Leaving this page (unmount or another scope) ends "크게 보기", so coming back shows the normal width.
    return () => endExpanded(scope);
  }, [scope]);
  return (
    <div className="relative flex min-w-0 grow">
      <div className={clsx('flex min-w-0 grow', open && expanded && 'hidden')}>{children}</div>
      {open && <Dock scope={scope} tabs={tabs} />}
    </div>
  );
}

/**
 * One dock per window, scoped to the project: a strip of tabs over the tab I am on. Today it has one tab (the work
 * result); a surface (web, terminal, phone) later is one more entry in `tabs`. Its width is only ever changed by
 * dragging its edge, and it is remembered.
 */
export function Dock({ scope = '', tabs }: { scope?: string; tabs: DockTab[] }) {
  const t = useMessages(messages);
  const [, setOpen] = useDockOpen();
  const [expanded, setExpanded] = useDockExpanded(scope);
  const width = usePanelWidth({ storageKey: 'alpine.work-result.width', initial: 360, min: 280, max: 900 });
  const [chosen, choose] = useDockTab();
  const active = tabs.find((tab) => tab.id === chosen) ?? tabs[0];

  // Arrows wrap around; Home and End jump to the first and last tab, as the WAI-ARIA tabs pattern asks.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!active) return;
    const index = tabs.indexOf(active);
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = (index + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        target = (index - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = tabs[target];
    if (next) {
      choose(next.id);
      document.getElementById(`dock-tab-${next.id}`)?.focus();
    }
  };

  return (
    <aside
      aria-label={t.title}
      style={expanded ? undefined : { width: width.width }}
      // Shrinks first when the window gets narrow, so the page keeps its room.
      className={clsx(
        'relative flex flex-col bg-canvas',
        expanded ? 'min-w-0 grow' : 'min-w-70 shrink-[1000] border-l border-line',
      )}
    >
      {!expanded && <PanelResizer panel={width} edge="left" label={t.resize} />}
      <header className="flex min-h-14 shrink-0 items-center gap-2 pr-3 pl-3">
        <div
          role="tablist"
          aria-label={t.title}
          onKeyDown={onKeyDown}
          className="flex min-w-0 grow items-center gap-1 overflow-x-auto"
        >
          {tabs.map((tab) => {
            const selected = tab.id === active?.id;
            return (
              <button
                key={tab.id}
                id={`dock-tab-${tab.id}`}
                type="button"
                title={tab.label}
                role="tab"
                aria-selected={selected}
                // Only the selected tab's panel is rendered, so only it has something to point at.
                aria-controls={selected ? `dock-panel-${tab.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => choose(tab.id)}
                className={clsx(
                  'shrink-0 cursor-pointer rounded-lg px-2.5 py-1 text-lead whitespace-nowrap',
                  selected ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={expanded}
          aria-label={expanded ? t.shrink : t.expand}
          title={expanded ? t.shrink : t.expand}
          onClick={() => setExpanded(!expanded)}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg aria-pressed:bg-hover aria-pressed:text-fg"
        >
          {expanded ? (
            <Minimize2 size={16} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Maximize2 size={16} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          aria-label={t.close}
          onClick={() => setOpen(false)}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-lg text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={16} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </header>
      {tabs
        .filter((tab) => tab.id === active?.id || tab.keepMounted)
        .map((tab) => (
          <div
            key={tab.id}
            hidden={tab.id !== active?.id}
            id={`dock-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`dock-tab-${tab.id}`}
            className={clsx(
              'min-h-0 grow flex-col',
              tab.id === active?.id ? 'flex' : 'hidden',
              !tab.bare && 'overflow-y-auto px-5 pb-5',
            )}
          >
            {tab.content}
          </div>
        ))}
    </aside>
  );
}

/**
 * The button in the top bar that opens and closes the dock. While the dock is closed it says how many files the work
 * changed, so a change is noticed without the dock opening by itself.
 */
export function DockToggle({ files = 0 }: { files?: number }) {
  const t = useMessages(messages);
  const format = useFormat();
  const [open, setOpen] = useDockOpen();
  const count = !open && files > 0;
  return (
    <button
      type="button"
      aria-pressed={open}
      aria-label={open ? t.close : count ? t.openWithFiles(format.number(files)) : t.open}
      title={t.title}
      onClick={() => setOpen(!open)}
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
