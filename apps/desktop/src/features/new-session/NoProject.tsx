import { Button } from '@alpine/ui/primitives';
import { Folder } from 'lucide-react';
import { useState } from 'react';

import { Composer } from '@/shared/components/composer';
import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';

import { CloneDialog } from './CloneDialog';
import { messages } from './messages';

/** A new session with no project yet: the centre asks for a folder, and the input waits where it will be. */
export function NoProject({ onProjectChange }: { onProjectChange?: (path: string) => void }) {
  const t = useMessages(messages);
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);
  return (
    <main aria-label={t.start} className="flex min-w-120 grow flex-col bg-canvas">
      <section aria-labelledby="np-title" className="flex min-h-0 grow flex-col items-center justify-center px-6 pt-4">
        <div className="flex w-full max-w-100 flex-col gap-4">
          <Folder size={18} strokeWidth={1.5} aria-hidden="true" className="text-fg-muted" />
          <div className="flex flex-col gap-2">
            <h2 id="np-title" className="text-lead">
              {t.whichFolder}
            </h2>
            <p className="text-body text-fg-muted">{t.dropHint}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" onClick={openFolder}>
              {t.openFolder}
            </Button>
            <Button onClick={() => setCloning(true)}>{t.clone}</Button>
          </div>
        </div>
      </section>
      <div className="mx-auto w-full max-w-202 px-6 pt-3 pb-6">
        <Composer locked />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onCloned={(path) => onProjectChange?.(path)} />
    </main>
  );
}
