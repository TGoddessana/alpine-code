import { Button } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';

import { CloneDialog } from './CloneDialog';
import { Composer } from './Composer';
import { messages } from './messages';

/** A new session with no project yet: the centre asks for a folder, and the input waits until there is one. */
export function NoProject({ onProjectChange }: { onProjectChange?: (path: string) => void }) {
  const t = useMessages(messages);
  const openFolder = useOpenFolder(onProjectChange);
  const [cloning, setCloning] = useState(false);
  return (
    <main className="flex min-w-120 grow flex-col bg-canvas">
      <header className="flex min-h-14 shrink-0 items-center border-b border-line px-6">
        <h1 className="text-title">{t.start}</h1>
      </header>
      <section aria-labelledby="np-title" className="flex min-h-0 grow flex-col items-center justify-center px-6 pt-4">
        <div className="flex w-full max-w-100 flex-col gap-4">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-fg-muted"
          >
            <path d="M3 6.5a1.5 1.5 0 0 1 1.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
          </svg>
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
      <div className="px-6 pt-3 pb-4">
        <Composer locked />
      </div>
      <CloneDialog open={cloning} onOpenChange={setCloning} onCloned={(path) => onProjectChange?.(path)} />
    </main>
  );
}
