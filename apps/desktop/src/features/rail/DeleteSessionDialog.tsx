import type { SessionInfo } from '@alpine/protocol';
import { Button, Dialog } from '@alpine/ui/primitives';
import { useNavigate, useParams } from '@tanstack/react-router';
import type { KeyboardEvent } from 'react';

import { useMessages } from '@/shared/i18n';
import { useDeleteSession } from '@/shared/server';

import { messages } from './messages';

/** Deleting a session removes its conversation for good, so Enter never confirms: only a click or ⌘Enter does. */
export function DeleteSessionDialog({ session, onClose }: { session: SessionInfo | null; onClose: () => void }) {
  const t = useMessages(messages);
  const remove = useDeleteSession();
  const navigate = useNavigate();
  const shown = useParams({ strict: false, select: (params: { sessionId?: string }) => params.sessionId });

  const confirm = () => {
    if (!session) return;
    remove.mutate(session.id, {
      onSuccess: () => {
        if (shown === session.id) void navigate({ to: '/' });
        onClose();
      },
    });
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.metaKey) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <Dialog.Root open={session !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Popup size="sm" role="alertdialog" onKeyDown={onKeyDown}>
        {session && (
          <>
            <div className="flex flex-col gap-2">
              <Dialog.Title>{t.deleteSessionTitle(session.title || t.untitledSession)}</Dialog.Title>
              <Dialog.Description>{t.deleteSessionLead}</Dialog.Description>
            </div>
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
