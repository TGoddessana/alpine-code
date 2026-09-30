import { PanelResizer, usePanelWidth } from '@alpine/ui/primitives';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';

/** The session's state, always in this order: plan, verification, changes, out of the ordinary. Empty says 'none'. */
export function StatusPanel() {
  const t = useMessages(messages);
  const width = usePanelWidth({ storageKey: 'alpine.status-panel.width', initial: 380, min: 280, max: 560 });
  return (
    <aside
      aria-label={t.title}
      style={{ width: width.width }}
      // Shrinks first when the window gets narrow, so the conversation keeps its room.
      className="relative flex min-w-70 shrink-[1000] flex-col border-l border-line bg-canvas-sunken"
    >
      <PanelResizer panel={width} edge="left" label={t.resize} />
      <div className="flex min-h-14 items-center border-b border-line px-5">
        <span className="text-lead">{t.title}</span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        {[t.plan, t.verification, t.changes, t.unusual].map((title) => (
          <section key={title} className="flex flex-col gap-1">
            <h2 className="flex min-h-7 items-center text-lead">{title}</h2>
            <p className="flex min-h-7 items-center text-body text-fg-muted">{t.none}</p>
          </section>
        ))}
      </div>
    </aside>
  );
}
