import { Popover } from '@alpine/ui/primitives';
import { Upload } from 'lucide-react';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';

import { messages } from './messages';
import { PublishPanel, type PublishProject } from './PublishPanel';
import type { Scenario } from './preview';

/**
 * The top bar's 올리기 (decision 14): a dot while there are changes not online yet; it opens the sheet beside it.
 */
export function PublishButton({
  project,
  scenario,
  signedIn,
  defaultOpen = false,
  onFix,
}: {
  project: PublishProject;
  scenario?: Scenario;
  signedIn?: boolean;
  defaultOpen?: boolean;
  onFix?: () => void;
}) {
  const t = useMessages(messages);
  // Once it is online, nothing is waiting to go up until the next change.
  const [published, setPublished] = useState(false);
  const waiting = project.changes > 0 && !published;
  return (
    <Popover.Root defaultOpen={defaultOpen}>
      <Popover.Trigger
        aria-label={waiting ? `${t.publish} · ${t.unpublished}` : t.publish}
        className="relative inline-flex min-h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-canvas-raised px-2.5 text-body font-medium text-fg hover:bg-hover data-popup-open:bg-hover"
      >
        <Upload size={14} strokeWidth={1.75} aria-hidden="true" className="text-fg-muted" />
        {t.publish}
        {waiting && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-canvas-sunken bg-interactive"
          />
        )}
      </Popover.Trigger>
      <Popover.Popup align="end">
        <PublishPanel
          project={project}
          scenario={scenario}
          signedIn={signedIn}
          onFix={onFix}
          onPublished={() => setPublished(true)}
        />
      </Popover.Popup>
    </Popover.Root>
  );
}
