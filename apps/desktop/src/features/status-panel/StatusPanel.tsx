import type { SessionInfo } from '@alpine/protocol';
import { PanelResizer, Tabs, usePanelWidth } from '@alpine/ui/primitives';

import { useFormat, useMessages } from '@/shared/i18n';
import { PANEL_PARTS, usePanelTab, type PanelPart, type PanelTab } from '@/shared/panel';

import { messages } from './messages';
import { None, PlanPart, planCounts, UnusualPart, VerificationPart } from './PlanParts';
import { UsageSection } from './UsageSection';

/**
 * The session's state as tabs, with no title. 'All' stacks the five parts, always in this order: plan,
 * verification, changes, out of the ordinary, usage; the other tabs show one part. The plan and its checks, the
 * steps dropped from it (out of the ordinary) and the usage come from the session's `info`; changes are not
 * filled yet. A tab and its part title carry a quiet count (plan 1/5, verification 0/3, out of the ordinary 1).
 * Switching tabs, here or from the chat, never changes the panel's width: only dragging its edge does. Empty says
 * 'none'.
 */
export function StatusPanel({ info = null }: { info?: SessionInfo | null }) {
  const t = useMessages(messages);
  const format = useFormat();
  const { tab, show } = usePanelTab();
  const width = usePanelWidth({ storageKey: 'alpine.status-panel.width', initial: 380, min: 280, max: 900 });
  const counts = planCounts(info?.plan);
  const countOf = (part: PanelPart): string | null => {
    const pair = part === 'plan' ? counts.plan : part === 'verification' ? counts.verification : null;
    if (pair) return t.count(format.number(pair[0]), format.number(pair[1]));
    return part === 'unusual' && counts.unusual > 0 ? format.number(counts.unusual) : null;
  };

  return (
    <aside
      aria-label={t.title}
      style={{ width: width.width }}
      // Shrinks first when the window gets narrow, so the conversation keeps its room.
      className="relative flex min-w-70 shrink-[1000] flex-col border-l border-line bg-canvas-sunken"
    >
      <PanelResizer panel={width} edge="left" label={t.resize} />
      <Tabs.Root value={tab} onValueChange={(value: PanelTab) => show(value)} className="min-h-0 grow">
        <Tabs.List className="min-h-14 shrink-0 gap-3 overflow-x-auto px-5 [scrollbar-width:none]">
          <Tabs.Tab value="all" className="min-h-14 shrink-0 whitespace-nowrap">
            {t.all}
          </Tabs.Tab>
          {PANEL_PARTS.map((part) => (
            <Tabs.Tab key={part} value={part} className="min-h-14 shrink-0 gap-1 whitespace-nowrap">
              {t[part]}
              <Count value={countOf(part)} />
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="all" className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
          {PANEL_PARTS.map((part) => (
            <section key={part} aria-label={t[part]} className="flex flex-col gap-1">
              <h2 className="flex min-h-7 items-center gap-2 text-lead">
                <span className="grow">{t[part]}</span>
                <Count value={countOf(part)} />
              </h2>
              <Part part={part} info={info} />
            </section>
          ))}
        </Tabs.Panel>
        {PANEL_PARTS.map((part) => (
          <Tabs.Panel key={part} value={part} className="min-h-0 overflow-y-auto px-5 py-4">
            <Part part={part} info={info} />
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </aside>
  );
}

function Part({ part, info }: { part: PanelPart; info: SessionInfo | null }) {
  switch (part) {
    case 'plan':
      return <PlanPart info={info} />;
    case 'verification':
      return <VerificationPart info={info} />;
    case 'unusual':
      return <UnusualPart info={info} />;
    case 'usage':
      return <UsageSection info={info} />;
    case 'changes':
      return <None />;
  }
}

function Count({ value }: { value: string | null }) {
  return value ? <span className="text-meta text-fg-muted">{value}</span> : null;
}
