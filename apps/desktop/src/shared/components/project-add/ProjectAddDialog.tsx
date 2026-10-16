import { Dialog } from '@alpine/ui/primitives';
import { useState } from 'react';

import { useMessages } from '@/shared/i18n';
import { useOpenFolder } from '@/shared/platform';

import { CloneForm } from './CloneDialog';
import { messages } from './messages';
import { ProjectChoices } from './ProjectChoices';

/**
 * 프로젝트 추가: every way in opens this one dialog (the rail's +, the project menu over the input). It lists the ways a
 * project comes in; getting one from a repository goes on in the same dialog, opening a folder hands over to Finder.
 * `onDone` gets the project's folder, or the clone's on its way there.
 */
export function ProjectAddDialog({
  open,
  onOpenChange,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: (path: string) => void;
}) {
  // Here, not in the dialog's content: Finder answers after the dialog has closed.
  const openFolder = useOpenFolder(onDone);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup size="sm">
        {open && (
          <AddFlow
            onOpen={() => {
              onOpenChange(false);
              void openFolder();
            }}
            onDone={(path) => {
              onOpenChange(false);
              onDone(path);
            }}
          />
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function AddFlow({ onDone, onOpen }: { onDone: (path: string) => void; onOpen: () => void }) {
  const t = useMessages(messages);
  const [getting, setGetting] = useState(false);
  if (getting) return <CloneForm onDone={onDone} onBack={() => setGetting(false)} />;
  return (
    <>
      <Dialog.Title>{t.addProject}</Dialog.Title>
      <ProjectChoices onGet={() => setGetting(true)} onOpen={onOpen} />
    </>
  );
}
