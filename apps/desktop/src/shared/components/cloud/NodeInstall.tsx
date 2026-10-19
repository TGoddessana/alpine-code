import { AutoHeight, Button, Dialog } from '@alpine/ui/primitives';
import { useEffect } from 'react';

import { useMessages } from '@/shared/i18n';
import { useInstallNodeTools } from '@/shared/server';

import { ProgressBar } from '../project-add';
import { messages } from './messages';

export interface NodeInstallProps {
  open: boolean;
  /** Node.js is installed: whatever needed it can go on. */
  onReady: () => void;
  /** 나중에: the person does not want it now. */
  onClose: () => void;
}

/**
 * Making or publishing a web app needs Node.js 22.12 or newer, and most people have none (docs/alpine-cloud-api.md
 * 6.3). This offers Alpine's own copy before 만들기: about 50 MB from nodejs.org, kept in Alpine's folder, no
 * password asked. The download shows how far it got, and `onReady` fires when it is in place.
 */
export function NodeInstall({ open, onReady, onClose }: NodeInstallProps) {
  const t = useMessages(messages);
  const { state, install, reset } = useInstallNodeTools();
  const working = state.status === 'downloading';

  useEffect(() => {
    if (open && state.status === 'done') onReady();
  }, [open, state.status, onReady]);

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && !working && close()} disablePointerDismissal>
      <Dialog.Popup size="sm">
        <AutoHeight>
          <div key={state.status} className="motion-step flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Dialog.Title>{t.nodeTitle}</Dialog.Title>
              <Dialog.Description>{working ? t.nodeDownloading : t.nodeLead}</Dialog.Description>
            </div>
            {working && (
              <div role="status" className="flex flex-col gap-2">
                <ProgressBar percent={Math.round((state.progress ?? 0) * 100)} className="w-full" />
                <p className="text-meta text-fg-muted">{t.nodeKeepOpen}</p>
              </div>
            )}
            {state.status === 'failed' && (
              <p role="alert" className="text-meta text-danger">
                {t.nodeFailed(state.message ?? '')}
              </p>
            )}
            {!working && (
              <>
                {state.status !== 'failed' && <p className="text-meta text-fg-muted">{t.nodeNote}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button onClick={close}>{t.later}</Button>
                  <Button variant="primary" autoFocus onClick={() => void install()}>
                    {state.status === 'failed' ? t.tryAgain : t.nodeInstall}
                  </Button>
                </div>
              </>
            )}
          </div>
        </AutoHeight>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
