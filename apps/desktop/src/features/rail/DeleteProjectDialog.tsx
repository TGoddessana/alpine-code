import type { ProjectInfo } from '@alpine/protocol';
import { Button, Dialog } from '@alpine/ui/primitives';
import type { KeyboardEvent } from 'react';

import { useMessages } from '@/shared/i18n';
import { useDeleteProject } from '@/shared/server';

import { messages } from './messages';

/**
 * Board ProjectDelete: what goes and what stays, before anything is removed.
 * It cannot be undone, so Enter never confirms: focus starts on Cancel, and only a click or ⌘Enter deletes.
 */
export function DeleteProjectDialog({ project, onClose }: { project: ProjectInfo | null; onClose: () => void }) {
  const t = useMessages(messages);
  const remove = useDeleteProject();

  const confirm = () => {
    if (project) remove.mutate(project.path, { onSuccess: onClose });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <Dialog.Root open={project !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Popup size="sm" role="alertdialog" onKeyDown={onKeyDown}>
        {project && (
          <>
            <div className="flex flex-col gap-2">
              <Dialog.Title>{t.deleteTitle(project.name)}</Dialog.Title>
              <Dialog.Description>{t.deleteLead}</Dialog.Description>
            </div>
            <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 rounded-lg border border-line-subtle p-3 text-body">
              <dt className="text-meta text-fg-muted">{t.removed}</dt>
              <dd>{t.removedWhat}</dd>
              <div className="col-span-2 my-2 border-t border-line-subtle" />
              <dt className="text-meta text-fg-muted">{t.kept}</dt>
              <dd>{t.keptWhat}</dd>
            </dl>
            {remove.error && (
              <p role="alert" className="text-meta text-danger">
                {remove.error.message}
              </p>
            )}
            <div className="flex items-center gap-2 pt-2">
              <span className="grow text-meta text-fg-muted">{t.cannotUndo}</span>
              <Dialog.Close render={<Button />}>{t.cancel}</Dialog.Close>
              <Button variant="danger" disabled={remove.isPending} onClick={confirm}>
                {t.confirmDelete}
                <kbd className="rounded-sm border border-on-fill/50 px-1 font-sans text-meta">⌘↩</kbd>
              </Button>
            </div>
          </>
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}
