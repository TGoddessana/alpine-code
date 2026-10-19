import { useState } from 'react';

import { BrandMark } from '@/shared/components/brand';

import { Composer } from '@/shared/components/composer';
import { CloneDialog, ProjectChoices } from '@/shared/components/project-add';
import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';

import { messages } from './messages';

/**
 * A new session with no project yet: the centre lists the ways a project comes in (making one from an idea first), and
 * the input waits below. 새로 만들기 goes to `onNewProject`.
 */
export function NoProject({
  onProjectChange,
  onNewProject,
}: {
  onProjectChange?: (path: string) => void;
  onNewProject?: () => void;
}) {
  const t = useMessages(messages);
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
          <ProjectChoices
            onNew={() => onNewProject?.()}
            onGet={() => setCloning(true)}
            onOpen={() => void openFolder()}
          />
        </div>
      </section>
      <div className="mx-auto w-full max-w-202 px-6 pt-3 pb-6">
        <Composer locked />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onDone={(path) => onProjectChange?.(path)} />
    </main>
  );
}
