import { PanelResizer, Tabs, usePanelWidth } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

const PARTS = ['plan', 'verification', 'changes', 'unusual'] as const;
type Tab = 'all' | (typeof PARTS)[number];

/**
 * The session's state as tabs, with no title. 'All' stacks the four parts, always in this order: plan,
 * verification, changes, out of the ordinary; the other tabs show one part. Switching tabs never changes the
 * panel's width: only dragging its edge does. Empty says 'none'.
 */
export function StatusPanel() {
  const t = useMessages(messages);
  const [tab, setTab] = useState<Tab>('all');
  const width = usePanelWidth({ storageKey: 'alpine.status-panel.width', initial: 380, min: 280, max: 900 });

  return (
    <aside
      aria-label={t.title}
      style={{ width: width.width }}
      // Shrinks first when the window gets narrow, so the conversation keeps its room.
      className="relative flex min-w-70 shrink-[1000] flex-col border-l border-line bg-canvas-sunken"
    >
      <PanelResizer panel={width} edge="left" label={t.resize} />
      <Tabs.Root value={tab} onValueChange={(value: Tab) => setTab(value)} className="min-h-0 grow">
        <Tabs.List className="min-h-14 shrink-0 gap-3 overflow-x-auto px-5 [scrollbar-width:none]">
          <Tabs.Tab value="all" className="min-h-14">
            {t.all}
          </Tabs.Tab>
          {PARTS.map((part) => (
            <Tabs.Tab key={part} value={part} className="min-h-14 whitespace-nowrap">
              {t[part]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="all" className="flex flex-col gap-4 px-5 py-4">
          {PARTS.map((part) => (
            <section key={part} className="flex flex-col gap-1">
              <h2 className="flex min-h-7 items-center text-lead">{t[part]}</h2>
              <p className="flex min-h-7 items-center text-body text-fg-muted">{t.none}</p>
            </section>
          ))}
        </Tabs.Panel>
        {PARTS.map((part) => (
          <Tabs.Panel key={part} value={part} className="px-5 py-4">
            <p className="flex min-h-7 items-center text-body text-fg-muted">{t.none}</p>
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </aside>
  );
}
