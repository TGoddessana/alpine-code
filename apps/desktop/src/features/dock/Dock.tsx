import { Menu, PanelResizer, Tooltip, TooltipGroup, usePanelWidth } from '@alpine/ui/primitives';
import clsx from 'clsx';
import { EllipsisVertical, Maximize2, Minimize2, PanelRight, type LucideIcon } from 'lucide-react';
import { useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useFormat, useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { endExpanded, resetExpanded, useDockExpanded, useDockOpen, useDockTab } from './state';

export interface DockTab {
  id: string;
  label: string;
  /** Shown instead of the label in the row of icons; the label becomes its tooltip and accessible name. */
  icon?: LucideIcon;
  /** Listed under ⋮ (더보기) instead of in the row: places I open now and then. */
  more?: boolean;
  /** A thin line after this tab, setting it apart from the ones that follow. */
  divider?: boolean;
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
export function DockLayout({
  scope,
  tabs,
  top,
  children,
}: {
  scope: string;
  tabs: DockTab[];
  /** Stays above every tab (the small map), so it is in view whatever the dock shows. */
  top?: ReactNode;
  children: ReactNode;
}) {
  const [open] = useDockOpen();
  const [expanded] = useDockExpanded(scope);
  useLayoutEffect(() => {
    resetExpanded(scope);
    // Leaving this page (unmount or another scope) ends "크게 보기", so coming back shows the normal width.
    return () => endExpanded(scope);
  }, [scope]);
  return (
    <div className="relative flex min-w-0 grow">
      <div
        className={clsx('motion-dock-page flex min-w-0', open && expanded && 'motion-page-hidden')}
        aria-hidden={open && expanded}
        inert={open && expanded}
      >
        {children}
      </div>
      <Dock scope={scope} tabs={tabs} open={open} top={top} />
    </div>
  );
}

/**
 * One dock per window, scoped to the project: a row of icon tabs over the tab I am on, the rarer places and "크게
 * 보기" under ⋮. `top` stays above the tabs. Its width is only ever changed by dragging its edge, and it is remembered.
 * The top bar's button closes it, so it has no close button of its own.
 */
export function Dock({
  scope = '',
  tabs,
  open = true,
  top,
}: {
  scope?: string;
  tabs: DockTab[];
  open?: boolean;
  top?: ReactNode;
}) {
  const t = useMessages(messages);
  const [expanded, setExpanded] = useDockExpanded(scope);
  const width = usePanelWidth({ storageKey: 'alpine.work-result.width', initial: 360, min: 280, max: 900 });
  const [chosen, choose] = useDockTab();
  const [visited, setVisited] = useState(open);
  if (open && !visited) setVisited(true);
  const active = tabs.find((tab) => tab.id === chosen) ?? tabs[0];
  const row = tabs.filter((tab) => !tab.more);
  const more = tabs.filter((tab) => tab.more);
  // With a ⋮ place shown, the row still takes the keyboard at its first tab.
  const focusable = active && row.includes(active) ? active : row[0];

  // Arrows wrap around; Home and End jump to the first and last tab, as the WAI-ARIA tabs pattern asks.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!active || !row.length) return;
    const index = Math.max(0, row.indexOf(active));
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = (index + 1) % row.length;
        break;
      case 'ArrowLeft':
        target = (index - 1 + row.length) % row.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = row.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = row[target];
    if (next) {
      choose(next.id);
      document.getElementById(`dock-tab-${next.id}`)?.focus();
    }
  };

  return (
    <aside
      aria-label={t.title}
      aria-hidden={!open}
      inert={!open}
      data-open={open}
      data-expanded={expanded}
      style={expanded ? undefined : { width: open ? width.width : 0 }}
      // Shrinks first when the window gets narrow, so the page keeps its room.
      className={clsx('motion-dock relative flex flex-col bg-canvas')}
    >
      {open && !expanded && <PanelResizer panel={width} edge="left" label={t.resize} />}
      {visited && (
        <div className="motion-dock-body flex min-h-0 grow flex-col">
          <header className="flex min-h-12 shrink-0 items-center gap-1 px-2">
            <TooltipGroup delay={300}>
              <div
                role="tablist"
                aria-label={t.title}
                onKeyDown={onKeyDown}
                className="flex min-w-0 items-center gap-0.5"
              >
                {row.map((tab) => {
                  const selected = tab.id === active?.id;
                  const Icon = tab.icon;
                  const button = (
                    <button
                      id={`dock-tab-${tab.id}`}
                      type="button"
                      role="tab"
                      aria-label={Icon ? tab.label : undefined}
                      aria-selected={selected}
                      // Only the selected tab's panel is rendered, so only it has something to point at.
                      aria-controls={selected ? `dock-panel-${tab.id}` : undefined}
                      tabIndex={tab === focusable ? 0 : -1}
                      onClick={() => choose(tab.id)}
                      className={clsx(
                        'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-lead whitespace-nowrap',
                        Icon ? 'w-8' : 'px-2.5',
                        selected ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
                      )}
                    >
                      {Icon ? <Icon size={17} strokeWidth={1.6} aria-hidden="true" /> : tab.label}
                    </button>
                  );
                  return (
                    <span key={tab.id} className="flex items-center">
                      {Icon ? <Tooltip label={tab.label}>{button}</Tooltip> : button}
                      {tab.divider && <span aria-hidden className="mx-1.5 h-4.5 w-px bg-line" />}
                    </span>
                  );
                })}
              </div>
              <Menu.Root>
                <Tooltip label={t.more}>
                  <Menu.Trigger
                    aria-label={t.more}
                    className={clsx(
                      'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg hover:bg-hover hover:text-fg',
                      active?.more ? 'bg-hover text-fg' : 'text-fg-muted',
                    )}
                  >
                    <EllipsisVertical size={17} strokeWidth={1.6} aria-hidden="true" />
                  </Menu.Trigger>
                </Tooltip>
                <Menu.Popup align="end">
                  {more.map((tab) => (
                    <Menu.Item
                      key={tab.id}
                      onClick={() => choose(tab.id)}
                      className={clsx(tab.id === active?.id && 'bg-selected')}
                    >
                      {tab.icon && <tab.icon size={15} strokeWidth={1.6} aria-hidden="true" />}
                      {tab.label}
                    </Menu.Item>
                  ))}
                  {more.length > 0 && <Menu.Separator />}
                  <Menu.Item onClick={() => setExpanded(!expanded)}>
                    {expanded ? (
                      <Minimize2 size={15} strokeWidth={1.6} aria-hidden="true" />
                    ) : (
                      <Maximize2 size={15} strokeWidth={1.6} aria-hidden="true" />
                    )}
                    {expanded ? t.shrink : t.expand}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Root>
            </TooltipGroup>
          </header>
          {top}
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
                  'motion-content min-h-0 grow flex-col',
                  tab.id === active?.id ? 'flex' : 'hidden',
                  !tab.bare && 'overflow-y-auto px-5 pb-5',
                )}
              >
                {tab.content}
              </div>
            ))}
        </div>
      )}
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
