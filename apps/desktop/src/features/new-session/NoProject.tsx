import { Button } from '@alpine/ui/primitives';
import { useState } from 'react';

import { BrandMark } from '@/shared/components/brand';

import { Composer } from '@/shared/components/composer';
import { CloneDialog, projectAddMessages } from '@/shared/components/project-add';
import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';

import { messages } from './messages';

/** A new session with no project yet: the centre offers the two ways in, and the input waits where it will be. */
export function NoProject({ onProjectChange }: { onProjectChange?: (path: string) => void }) {
  const t = useMessages(messages);
  const added = useMessages(projectAddMessages);
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);
  return (
    <main aria-label={t.start} className="flex min-w-120 grow flex-col bg-canvas">
      <section aria-labelledby="np-title" className="flex min-h-0 grow flex-col items-center justify-center px-6 pt-4">
        <div className="flex w-full max-w-100 flex-col gap-4">
          <BrandMark size={80} />
          <div className="flex flex-col gap-2">
            <h2 id="np-title" className="text-lead">
              {t.whichProject}
            </h2>
            <p className="text-body text-fg-muted">{t.dropHint}</p>
          </div>
          <div className="flex flex-col items-start gap-2">
            <Button onClick={() => setCloning(true)}>{added.getProjectButton}</Button>
            <Button onClick={openFolder}>{added.openProjectButton} · ⌘O</Button>
          </div>
        </div>
      </section>
      <div className="mx-auto w-full max-w-202 px-6 pt-3 pb-6">
        <Composer locked />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onDone={(path) => onProjectChange?.(path)} />
    </main>
  );
}
